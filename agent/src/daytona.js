// One sandbox per card. Clone → (optionally) let the model edit → test → report.
// Kept alive until the card is decided: approve pushes the branch from the same
// sandbox, anything else deletes it.
import { Daytona } from "@daytonaio/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { env } from "./env.js";
import { proposeEdits } from "./llm.js";

// Cheap liveness check for preflight: list is enough to prove the key works.
export async function ping() {
  // list() is an async iterator; pulling one item is what actually hits the API.
  for await (const _ of daytona().list()) break;
}
const REPO_DIR = "/home/daytona/repo";
const CACHE = new URL("../.cache/dryrun.json", import.meta.url);

let client;
const daytona = () => (client ||= new Daytona({ apiKey: env("DAYTONA_API_KEY") }));
const sandboxes = new Map(); // cardId → sandbox

async function sh(sandbox, cmd, timeout = 240) {
  const r = await sandbox.process.executeCommand(cmd, REPO_DIR, undefined, timeout);
  return { code: r.exitCode, out: String(r.result ?? "") };
}

function parseTests(out) {
  // jest / vitest / node --test all print something countable
  const passed = Number((out.match(/(\d+) (?:passed|passing)|^# pass (\d+)/m) || []).slice(1).find(Boolean) || 0);
  const failed = Number((out.match(/(\d+) (?:failed|failing)|^# fail (\d+)/m) || []).slice(1).find(Boolean) || 0);
  return { passed, failed, raw: out.split("\n").slice(-40).join("\n") };
}

function parseShortstat(out) {
  const m = out.match(/(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/);
  return { filesChanged: Number(m?.[1] || 0), insertions: Number(m?.[2] || 0), deletions: Number(m?.[3] || 0) };
}

function cacheGet(key) {
  if (env("DEMO_CACHE", "0") !== "1" || !existsSync(CACHE)) return null;
  return JSON.parse(readFileSync(CACHE, "utf8"))[key] || null;
}
function cachePut(key, value) {
  mkdirSync(new URL("../.cache/", import.meta.url), { recursive: true });
  const all = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  all[key] = value;
  writeFileSync(CACHE, JSON.stringify(all, null, 2));
}

/**
 * Dry-run a card's instruction in a fresh sandbox.
 * @returns evidence.dryRun (see docs/design.md, "Evidence on a card")
 */
export async function dryRun(card, { instruction = card.sourceInstruction || card.title, withEdits = true, log = console.log } = {}) {
  const key = `${env("TARGET_REPO")}::${instruction}`;
  const cached = cacheGet(key);
  if (cached) { log("dry-run: served from DEMO_CACHE"); return { ...cached, cached: true }; }

  const t0 = Date.now();
  const branch = `agent/card-${card.id.slice(-8)}`;
  const repo = env("TARGET_REPO");
  const sandbox = await daytona().create({ language: "typescript" });
  sandboxes.set(card.id, sandbox);
  log(`sandbox ${sandbox.id} up in ${Date.now() - t0}ms`);

  try {
    await sandbox.git.clone(`https://github.com/${repo}.git`, REPO_DIR, undefined, undefined, env("GITHUB_USER", ""), env("GITHUB_TOKEN", ""));
    await sh(sandbox, `git checkout -b ${branch} && git config user.email agent@tiktokforwork.dev && git config user.name "TikTok for Work Agent"`);

    let editSummary = "";
    if (withEdits) {
      // Pick up to 3 files the instruction seems to be about, let the model edit them.
      const words = instruction.split(/[\s、。,.]+/).filter((w) => w.length >= 2).slice(0, 6);
      const grep = await sh(sandbox, `git grep -il -e ${words.map((w) => JSON.stringify(w)).join(" -e ")} -- ':!*.lock' ':!package-lock.json' | head -3 || true`);
      const paths = grep.out.split("\n").map((s) => s.trim()).filter(Boolean);
      const files = [];
      for (const p of paths) files.push({ path: p, content: (await sh(sandbox, `head -c 12000 ${JSON.stringify(p)}`)).out });
      if (files.length) {
        const { edits, summary } = await proposeEdits(instruction, files);
        editSummary = summary;
        for (const e of edits) {
          const f = files.find((x) => x.path === e.path);
          if (!f || !f.content.includes(e.find)) continue;
          f.content = f.content.replace(e.find, e.replace);
          await sandbox.fs.uploadFile(Buffer.from(f.content), `${REPO_DIR}/${e.path}`);
        }
        await sh(sandbox, `git add -A && git commit -qm ${JSON.stringify(`Agent: ${instruction}`.slice(0, 72))} || true`);
      }
    }

    const install = await sh(sandbox, "([ -f package-lock.json ] && npm ci --silent) || npm install --silent || true", 300);
    const test = await sh(sandbox, "npm test --silent 2>&1 || true", 300);
    const stat = await sh(sandbox, "git diff --shortstat HEAD~1 2>/dev/null || echo '0 files changed'");
    const tests = parseTests(test.out);
    const result = {
      sandboxId: sandbox.id, branch, ...parseShortstat(stat.out), tests, editSummary,
      status: tests.failed > 0 ? "failed" : "passed",
      installOk: install.code === 0,
      durationMs: Date.now() - t0,
    };
    cachePut(key, result);
    return result;
  } catch (err) {
    log("dry-run error", err?.message || err);
    return { sandboxId: sandbox.id, branch, status: "error", error: String(err?.message || err), durationMs: Date.now() - t0 };
  }
}

// After approve: push the branch that already exists in the card's sandbox and open a PR.
export async function pushAndOpenPR(card, dryRunResult, { title, body }) {
  const sandbox = sandboxes.get(card.id);
  if (!sandbox) throw new Error("no live sandbox for this card (cached or expired run)");
  const repo = env("TARGET_REPO");
  const push = await sh(sandbox, `git push -u https://${env("GITHUB_USER")}:${env("GITHUB_TOKEN")}@github.com/${repo}.git ${dryRunResult.branch} 2>&1`);
  if (push.code !== 0) throw new Error(`push failed: ${push.out.slice(-300)}`);
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("GITHUB_TOKEN")}`, accept: "application/vnd.github+json", "user-agent": "tfw-agent" },
    body: JSON.stringify({ title, body, head: dryRunResult.branch, base: "main" }),
  });
  if (!r.ok) throw new Error(`PR create ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const pr = await r.json();
  return { prUrl: pr.html_url, number: pr.number, pushedAt: new Date().toISOString() };
}

export async function discard(cardId) {
  const sandbox = sandboxes.get(cardId);
  if (!sandbox) return;
  sandboxes.delete(cardId);
  try { await sandbox.delete(); } catch {}
}
