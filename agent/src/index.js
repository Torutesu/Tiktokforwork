// TikTok for Work agent runner — "the recipient's AI", made real, on its own
// computer.
//
//   start            → make sure this agent's desk sandbox exists (Daytona)
//   new card for me  → Neo4j context → fork the desk, edit, test, preview
//                      → card_updated { evidence } as each step lands
//   I approve        → push from that fork → open PR → result card → Neo4j
//   I decline        → fork deleted, decision recorded in the graph
//   always           → this agent's machines and work, as my context, for
//                      the fleet view on every teammate's screen
//
// Daytona and Neo4j are not optional layers on top of the product — they ARE
// its execution and context layers. The runner refuses to start until both
// answer (and the model endpoint does).

import { env } from "./env.js";
import { Relay } from "./relay.js";
import * as neo4j from "./neo4j.js";
import * as daytona from "./daytona.js";
import { summarizeGraph, chat } from "./llm.js";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dryRuns = new Map(); // cardId → dryRun result
const ja = env("LOCALE", "ja") === "ja";
let desk;
let done = 0;

// ------------------------------------------------------------ preflight

async function preflight() {
  for (const k of ["DAYTONA_API_KEY", "NEO4J_URI", "NEO4J_PASSWORD", "LLM_API_KEY", "TARGET_REPO", "GITHUB_TOKEN"]) env(k);
  let t = Date.now();
  await neo4j.run("RETURN 1");
  log(`neo4j ok (${Date.now() - t}ms)`);
  t = Date.now();
  await chat([{ role: "user", content: "ping" }], { maxTokens: 2 });
  log(`model ok: ${env("LLM_MODEL")} @ ${env("LLM_BASE_URL")} (${Date.now() - t}ms)`);
  t = Date.now();
  await daytona.ping();
  log(`daytona ok (${Date.now() - t}ms)`);
}

// ------------------------------------------------- evidence on the card

/// A running record of what the AI did, written to the card as it happens.
function tracker(card) {
  const started = new Date().toISOString();
  let timeline = [];
  const push = (label, detail, extra = {}) => {
    // The previous step is done the moment the next one starts.
    timeline = timeline.map((s) => (s.status === "running" ? { ...s, status: "done" } : s));
    // A step that repeats its predecessor's label ("Running…" → "Ran…") replaces it.
    const last = timeline[timeline.length - 1];
    if (last && extra.replaceLast) timeline = timeline.slice(0, -1);
    timeline.push({ at: new Date().toISOString(), label, detail, layer: extra.layer || "daytona", status: extra.status || "running" });
    write({ status: "running" });
  };
  const write = (patch) => {
    const latest = relay.state.cardsById[card.id] || card;
    const evidence = { ...(latest.evidence || {}), startedAt: (latest.evidence || {}).startedAt || started, ...patch, timeline };
    relay.attachEvidence(latest, evidence, bits(evidence));
    publishStatus();
  };
  const finish = (patch = {}) => {
    timeline = timeline.map((s) => (s.status === "running" ? { ...s, status: "done" } : s));
    write({ status: "done", finishedAt: new Date().toISOString(), ...patch });
  };
  return { push, write, finish };
}

/// The plain-text version of the evidence, for clients without the panel.
function bits(ev) {
  const out = [];
  const dry = ev.dryRun;
  if (dry) {
    if (dry.status === "passed") out.push(ja ? `✅ テスト ${dry.tests.passed} 件通過` : `✅ ${dry.tests.passed} tests passed`);
    else if (dry.status === "failed") out.push(ja ? `❌ テスト ${dry.tests.failed} 件失敗` : `❌ ${dry.tests.failed} tests failed`);
    else out.push(ja ? "⚠️ dry-run エラー" : "⚠️ dry-run error");
    if (dry.filesChanged) out.push(ja ? `${dry.filesChanged} ファイル変更 (+${dry.insertions} −${dry.deletions})` : `${dry.filesChanged} files changed (+${dry.insertions} −${dry.deletions})`);
    out.push(ja ? `Daytona で ${Math.round(dry.durationMs / 1000)} 秒で検証` : `verified in Daytona in ${Math.round(dry.durationMs / 1000)}s`);
    if (dry.previewUrl) out.push(`Preview: ${dry.previewUrl}`);
  }
  if (ev.graph?.summary) out.push(ev.graph.summary);
  if (ev.execution?.prUrl) out.push(`PR: ${ev.execution.prUrl}`);
  return out;
}

// --------------------------------------------------------- fleet status

let statusTimer;
function publishStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    try {
      relay.sendContext({
        agent: {
          user: relay.userId,
          desk: desk ? { id: desk.id, name: desk.name, state: desk.state || "started" } : null,
          working: daytona.working(),
          done,
          at: new Date().toISOString(),
        },
      });
    } catch (err) {
      log("status publish failed", err.message);
    }
  }, 150);
}

// --------------------------------------------------------------- relay

const relay = new Relay({ log, onCard: enrich, onDecision: execute });

relay.onSnapshot = async (state) => {
  publishStatus();
  try {
    await neo4j.ensureSchema();
    const members = await relay.members().catch(() => []);
    if (members.length) await neo4j.upsertMembers(relay.orgId, members);
    const cards = Object.values(state.cardsById);
    for (const c of cards) await neo4j.upsertCard(c, { repo: env("TARGET_REPO") });
    log(`neo4j: synced ${members.length} members, ${cards.length} decisions`);
  } catch (err) {
    log("neo4j sync failed", err.message);
  }
};

async function enrich(card) {
  log(`new card for me: ${card.id} "${card.title}"`);
  const track = tracker(card);
  const repo = env("TARGET_REPO");

  // 1. Neo4j first — the graph answers in milliseconds and is useful on its own.
  track.push(ja ? "判断グラフに問い合わせ" : "Asked the decision graph", ja ? "前例・競合・前回の決定者" : "precedent · collisions · who decided last time", { layer: "neo4j" });
  try {
    await neo4j.upsertCard(card, { repo });
    const ctx = await neo4j.contextFor(card.id);
    const graph = { ...ctx, business: card.business, repo, summary: await summarizeGraph({ ...ctx, locale: ja ? "ja" : "en" }) };
    track.push(ja ? "グラフの答え" : "The graph answered", `${ctx.related.length} ${ja ? "件の前例" : "precedents"} · ${ctx.conflicts.length} ${ja ? "件の競合" : "collisions"}`, { layer: "neo4j", status: "done", replaceLast: true });
    track.write({ graph });
  } catch (err) {
    log("graph context failed", err.message);
    track.push(ja ? "グラフに届かなかった" : "Could not reach the graph", err.message.slice(0, 80), { layer: "neo4j", status: "failed" });
  }

  // 2. Daytona: fork the desk, edit, test, preview. Pure FYI cards get the graph only.
  if (card.type === "notification") return track.finish();
  const dry = await daytona.dryRun(card, desk, {
    log,
    withEdits: env("DRYRUN_EDITS", "1") === "1",
    onStep: (label, detail, extra = {}) => track.push(label, detail, { layer: extra.layer || "daytona", status: extra.status }),
  });
  dryRuns.set(card.id, dry);
  track.finish({ dryRun: dry, status: dry.status === "error" ? "failed" : "done" });
  log(`dry-run ${dry.status} for ${card.id} (${dry.durationMs}ms)`);
}

async function execute(card, decision) {
  const action = decision?.action || card.decision?.action;
  if (!action) return;
  log(`decision on ${card.id}: ${action}`);
  const dry = dryRuns.get(card.id);
  neo4j.upsertCard({ ...card, decision: { ...card.decision, ...decision } }).catch((e) => log("neo4j record failed", e.message));

  if (action !== "approve") {
    await daytona.discard(card.id);
    publishStatus();
    return;
  }
  if (!dry || dry.status === "error") return;
  const track = tracker(card);
  try {
    const exec = await daytona.pushAndOpenPR(card, dry, {
      title: card.title,
      body: `${card.summary || ""}\n\nApproved by ${relay.userId} in TikTok for Work. Verified in Daytona sandbox ${dry.sandboxId} (forked from ${dry.deskId}): ${dry.tests?.passed ?? 0} tests passed.${dry.previewUrl ? `\nPreview: ${dry.previewUrl}` : ""}\n\nDecision: ${card.id}`,
      onStep: (label, detail, extra = {}) => track.push(label, detail, extra),
    });
    dryRuns.delete(card.id);
    done += 1;
    neo4j.recordPR(card.id, exec.prUrl).catch((e) => log("neo4j PR record failed", e.message));
    track.finish({ execution: exec });
    if (card.senderUserID && card.senderUserID !== relay.userId) {
      relay.createCard({
        recipientUserID: card.senderUserID,
        title: ja ? `承認済み: ${card.title}` : `Approved: ${card.title}`,
        summary: ja ? `${relay.userId} が承認し、PR #${exec.number} を開きました。` : `${relay.userId} approved it and PR #${exec.number} is open.`,
        context: `${exec.prUrl} · ${ja ? "テスト" : "tests"} ${dry.tests?.passed ?? 0} ✅${dry.previewUrl ? ` · Preview: ${dry.previewUrl}` : ""}`,
        business: card.business,
        labels: ["executed"],
      });
    }
    log(`PR opened: ${exec.prUrl}`);
  } catch (err) {
    log("execution failed", err.message);
    track.push(ja ? "実行に失敗" : "Execution failed", err.message.slice(0, 120), { layer: "github", status: "failed" });
    track.finish({ execution: { error: err.message }, status: "failed" });
  }
}

// ---------------------------------------------------------------- boot

await preflight();
desk = await daytona.ensureDesk(env("AGENT_USER_ID"), { log, onStep: (l, d) => log("desk:", l, d || "") });
relay.connect();
setInterval(publishStatus, 30000);
log("agent running as", relay.userId, `on desk ${desk.name} — Daytona and Neo4j live`);
