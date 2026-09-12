// Every teammate's AI has its own computer, and every decision gets its own.
//
//   desk   — one persistent sandbox per agent (`desk-<user>`), with the
//            repository cloned and dependencies installed. It is where the
//            agent lives (scripts/deploy-desk.js runs the runner inside it).
//   fork   — one sandbox per card, forked from the desk in well under a
//            second with the checkout and node_modules already in place, so
//            a dry-run is edit + test, not clone + install.
//   preview — the changed app served from the fork, reachable through
//            Daytona's preview link, so the approver can click and see it.
//
// The fork is kept alive until the card is decided: approve pushes the exact
// branch that was tested from the same machine; anything else deletes it.

import { Daytona } from "@daytonaio/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { env } from "./env.js";
import { proposeEdits } from "./llm.js";

const REPO_DIR = "/home/daytona/repo";
const CACHE = new URL("../.cache/dryrun.json", import.meta.url);

let client;
export const daytona = () => (client ||= new Daytona({ apiKey: env("DAYTONA_API_KEY") }));
const forks = new Map(); // cardId → { sandbox, branch }
const noop = () => {};

async function sh(sandbox, cmd, timeout = 240, cwd = REPO_DIR) {
  const r = await sandbox.process.executeCommand(cmd, cwd, undefined, timeout);
  return { code: r.exitCode, out: String(r.result ?? "") };
}

export async function ping() {
  for await (const _ of daytona().list()) break;
}

// ---------------------------------------------------------------- the desk

export const deskName = (user) => `desk-${String(user).replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;

/// The agent's own machine. Found by name, created once, never auto-stopped.
export async function ensureDesk(user, { log = noop, onStep = noop } = {}) {
  const name = deskName(user);
  const repo = env("TARGET_REPO");
  try {
    const existing = await daytona().get(name);
    if (existing.state === "stopped") { onStep("Waking the desk"); await daytona().start(existing); }
    log(`desk ${name} = ${existing.id} (${existing.state})`);
    return existing;
  } catch {
    // no desk yet
  }
  onStep("Creating a desk", "one persistent sandbox for this agent");
  const desk = await daytona().create({
    name, language: "typescript",
    labels: { app: "tiktok-for-work", role: "desk", agent: String(user) },
    autoStopInterval: 0, autoArchiveInterval: 0, autoDeleteInterval: -1,
    envVars: { GITHUB_TOKEN: env("GITHUB_TOKEN", ""), GIT_AUTHOR_NAME: "TikTok for Work Agent", GIT_AUTHOR_EMAIL: "agent@tiktokforwork.dev" },
  });
  onStep(`Cloning ${repo} onto the desk`);
  await desk.git.clone(`https://github.com/${repo}.git`, REPO_DIR, undefined, undefined, env("GITHUB_USER", ""), env("GITHUB_TOKEN", ""));
  await sh(desk, `git config user.email agent@tiktokforwork.dev && git config user.name "TikTok for Work Agent"`);
  onStep("Installing dependencies once", "every fork inherits them");
  await sh(desk, "([ -f package-lock.json ] && npm ci --silent) || npm install --silent || true", 600);
  log(`desk ${name} ready: ${desk.id}`);
  return desk;
}

// -------------------------------------------------------- one fork per card

async function workSandbox(desk, card, onStep) {
  const t0 = Date.now();
  try {
    const fork = await daytona().fork(desk, { name: `card-${card.id.slice(-8)}-${Date.now().toString(36)}` });
    await fork.setLabels({ app: "tiktok-for-work", role: "card", card: card.id, agent: desk.labels?.agent || "" }).catch(noop);
    onStep("Forked the desk", `${Date.now() - t0} ms · checkout and dependencies already there`, { bootMs: Date.now() - t0 });
    return { sandbox: fork, bootMs: Date.now() - t0, forked: true };
  } catch (err) {
    // A plan without forks: a fresh sandbox and a clone still work, just slower.
    const sandbox = await daytona().create({ language: "typescript", labels: { app: "tiktok-for-work", role: "card", card: card.id } });
    onStep("Created a sandbox", `${Date.now() - t0} ms (fork unavailable: ${String(err?.message || err).slice(0, 60)})`, { bootMs: Date.now() - t0 });
    await sandbox.git.clone(`https://github.com/${env("TARGET_REPO")}.git`, REPO_DIR, undefined, undefined, env("GITHUB_USER", ""), env("GITHUB_TOKEN", ""));
    await sh(sandbox, "([ -f package-lock.json ] && npm ci --silent) || npm install --silent || true", 600);
    return { sandbox, bootMs: Date.now() - t0, forked: false };
  }
}

function parseTests(out) {
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

async function applyEdits(sandbox, instruction, onStep) {
  const words = instruction.split(/[\s、。,.]+/).filter((w) => w.length >= 2).slice(0, 6);
  const grep = await sh(sandbox, `git grep -il -e ${words.map((w) => JSON.stringify(w)).join(" -e ")} -- ':!*.lock' ':!package-lock.json' | head -3 || true`);
  const paths = grep.out.split("\n").map((s) => s.trim()).filter(Boolean);
  const files = [];
  for (const p of paths) files.push({ path: p, content: (await sh(sandbox, `head -c 12000 ${JSON.stringify(p)}`)).out });
  if (!files.length) return { applied: [], summary: "" };
  const { edits, summary } = await proposeEdits(instruction, files);
  const applied = [];
  for (const e of edits) {
    const f = files.find((x) => x.path === e.path);
    if (!f || !f.content.includes(e.find)) continue;
    f.content = f.content.replace(e.find, e.replace);
    await sandbox.fs.uploadFile(Buffer.from(f.content), `${REPO_DIR}/${e.path}`);
    if (!applied.includes(e.path)) applied.push(e.path);
  }
  if (applied.length) {
    await sh(sandbox, `git add -A && git commit -qm ${JSON.stringify(`Agent: ${instruction}`.slice(0, 72))} || true`);
    onStep(`Applied ${applied.length} edit${applied.length === 1 ? "" : "s"}`, applied.join(", "));
  }
  return { applied, summary };
}

/// Serve the changed app from the fork and hand back Daytona's preview link.
async function preview(sandbox, onStep) {
  const port = Number(env("PREVIEW_PORT", "3000"));
  const cmd = env("PREVIEW_COMMAND", "");
  if (!cmd) return undefined;
  await sh(sandbox, `nohup sh -c ${JSON.stringify(cmd)} > /tmp/preview.log 2>&1 &`, 10);
  await new Promise((r) => setTimeout(r, Number(env("PREVIEW_WAIT_MS", "4000"))));
  const link = await sandbox.getPreviewLink(port);
  onStep("Started a preview of the change", link.url, { layer: "daytona" });
  return link.url;
}

/**
 * Dry-run a card's instruction on a fork of the agent's desk.
 * onStep(label, detail, extra) is called as it goes, so the card can show
 * the work while it happens.
 */
export async function dryRun(card, desk, { instruction = card.sourceInstruction || card.title, withEdits = true, onStep = noop, log = noop } = {}) {
  const key = `${env("TARGET_REPO")}::${instruction}`;
  const cached = cacheGet(key);
  if (cached) { log("dry-run: served from DEMO_CACHE"); onStep("Replayed a stored dry-run", key); return { ...cached, cached: true }; }

  const t0 = Date.now();
  const branch = `agent/card-${card.id.slice(-8)}`;
  const { sandbox, bootMs, forked } = await workSandbox(desk, card, onStep);
  forks.set(card.id, { sandbox, branch });

  try {
    await sh(sandbox, `git checkout -q -b ${branch}`);
    let editSummary = "", files = [];
    if (withEdits) ({ summary: editSummary, applied: files } = await applyEdits(sandbox, instruction, onStep));

    onStep("Running the test suite", "npm test");
    const test = await sh(sandbox, "npm test --silent 2>&1 || true", 300);
    const tests = parseTests(test.out);
    onStep("Ran the test suite", `npm test · ${tests.passed} passed, ${tests.failed} failed`);
    const stat = await sh(sandbox, "git diff --shortstat HEAD~1 2>/dev/null || echo '0 files changed'");
    const previewUrl = tests.failed === 0 ? await preview(sandbox, onStep).catch((e) => { log("preview failed", e.message); return undefined; }) : undefined;

    const result = {
      sandboxId: sandbox.id, deskId: desk.id, forked, bootMs, branch, ...parseShortstat(stat.out), tests, editSummary, files,
      previewUrl,
      status: tests.failed > 0 ? "failed" : "passed",
      durationMs: Date.now() - t0,
    };
    cachePut(key, result);
    return result;
  } catch (err) {
    log("dry-run error", err?.message || err);
    return { sandboxId: sandbox.id, deskId: desk.id, forked, bootMs, branch, status: "error", error: String(err?.message || err), durationMs: Date.now() - t0 };
  }
}

// After approve: push the branch that already exists in the card's fork and open a PR.
export async function pushAndOpenPR(card, dryRunResult, { title, body, onStep = noop }) {
  const live = forks.get(card.id);
  if (!live) throw new Error("no live sandbox for this card (cached or expired run)");
  const repo = env("TARGET_REPO");
  onStep("Pushing the tested branch", dryRunResult.branch);
  const push = await sh(live.sandbox, `git push -u https://${env("GITHUB_USER")}:${env("GITHUB_TOKEN")}@github.com/${repo}.git ${dryRunResult.branch} 2>&1`);
  if (push.code !== 0) throw new Error(`push failed: ${push.out.slice(-300)}`);
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("GITHUB_TOKEN")}`, accept: "application/vnd.github+json", "user-agent": "tfw-agent" },
    body: JSON.stringify({ title, body, head: dryRunResult.branch, base: env("TARGET_BASE", "main") }),
  });
  if (!r.ok) throw new Error(`PR create ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const pr = await r.json();
  onStep(`Opened pull request #${pr.number}`, pr.html_url, { layer: "github" });
  return { prUrl: pr.html_url, number: pr.number, branch: dryRunResult.branch, pushedAt: new Date().toISOString() };
}

export async function discard(cardId) {
  const live = forks.get(cardId);
  if (!live) return;
  forks.delete(cardId);
  try { await live.sandbox.delete(); } catch {}
}

/// What this agent's machines are doing right now, for the fleet view.
export function working() {
  return [...forks.entries()].map(([cardId, f]) => ({ cardId, sandboxId: f.sandbox.id, branch: f.branch }));
}

/// Every sandbox this app owns, across agents — the fleet.
export async function fleet() {
  const out = [];
  for await (const s of daytona().list({ labels: { app: "tiktok-for-work" } })) {
    out.push({ id: s.id, name: s.name, state: s.state, labels: s.labels || {} });
  }
  return out;
}
