// Honmaru agent runner — "the recipient's AI", made real.
//
//   new card for me  → Neo4j context + Daytona dry-run → card_updated { evidence }
//   I approve        → push branch + open PR → result card to the requester → Neo4j
//   I decline        → sandbox discarded, decision recorded in the graph
//
// Every integration is optional and degrades to a log line, so the loop keeps
// running while a teammate is still wiring a key.

import { env } from "./env.js";
import { Relay } from "./relay.js";
import * as neo4j from "./neo4j.js";
import * as daytona from "./daytona.js";
import { summarizeGraph } from "./llm.js";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dryRuns = new Map(); // cardId → dryRun result
const ja = (env("LOCALE", "ja") === "ja");

function bits(dry, graph) {
  const out = [];
  if (dry) {
    if (dry.status === "passed") out.push(ja ? `✅ テスト ${dry.tests.passed} 件通過` : `✅ ${dry.tests.passed} tests passed`);
    else if (dry.status === "failed") out.push(ja ? `❌ テスト ${dry.tests.failed} 件失敗` : `❌ ${dry.tests.failed} tests failed`);
    else out.push(ja ? `⚠️ dry-run エラー` : `⚠️ dry-run error`);
    if (dry.filesChanged) out.push(ja ? `${dry.filesChanged} ファイル変更 (+${dry.insertions} −${dry.deletions})` : `${dry.filesChanged} files changed (+${dry.insertions} −${dry.deletions})`);
    out.push(ja ? `Daytona で ${Math.round(dry.durationMs / 1000)} 秒で検証` : `verified in Daytona in ${Math.round(dry.durationMs / 1000)}s`);
  }
  if (graph?.summary) out.push(graph.summary);
  return out;
}

const relay = new Relay({ log, onCard: enrich, onDecision: execute });

relay.onSnapshot = async (state) => {
  if (!neo4j.enabled()) return log("neo4j: not configured, skipping graph sync");
  try {
    await neo4j.ensureSchema();
    const members = await relay.members().catch(() => []);
    if (members.length) await neo4j.upsertMembers(relay.orgId, members);
    const cards = Object.values(state.cardsById);
    for (const c of cards) await neo4j.upsertCard(c, { repo: env("TARGET_REPO", undefined) });
    log(`neo4j: synced ${members.length} members, ${cards.length} decisions`);
  } catch (err) {
    log("neo4j sync failed", err.message);
  }
};

async function enrich(card) {
  log(`new card for me: ${card.id} "${card.title}"`);
  const evidence = {};
  const repo = env("TARGET_REPO", undefined);

  // 1. Graph context first — it is fast and useful even when the dry-run fails.
  let graph;
  if (neo4j.enabled()) {
    try {
      await neo4j.upsertCard(card, { repo });
      const ctx = await neo4j.contextFor(card.id);
      graph = { ...ctx, summary: await summarizeGraph({ ...ctx, locale: ja ? "ja" : "en" }) };
      evidence.graph = graph;
      relay.attachEvidence(card, evidence, bits(undefined, graph));
      log(`graph: ${ctx.related.length} related, ${ctx.conflicts.length} conflicts`);
    } catch (err) {
      log("graph context failed", err.message);
    }
  }

  // 2. Dry-run in a sandbox. Only for cards that ask for a change in the repo.
  if (daytona.enabled() && ["task", "approval", "revision"].includes(card.type)) {
    const dry = await daytona.dryRun(card, { log, withEdits: env("DRYRUN_EDITS", "1") === "1" });
    dryRuns.set(card.id, dry);
    evidence.dryRun = dry;
    relay.attachEvidence(card, evidence, bits(dry, graph));
    log(`dry-run ${dry.status} for ${card.id} (${dry.durationMs}ms)`);
  }
}

async function execute(card, decision) {
  const action = decision?.action || card.decision?.action;
  if (!action) return;
  log(`decision on ${card.id}: ${action}`);
  const dry = dryRuns.get(card.id);
  if (neo4j.enabled()) neo4j.upsertCard({ ...card, decision: { ...card.decision, ...decision } }).catch((e) => log("neo4j record failed", e.message));

  if (action !== "approve") {
    await daytona.discard(card.id);
    return;
  }
  if (!dry || dry.status === "error") return;
  try {
    const exec = await daytona.pushAndOpenPR(card, dry, {
      title: card.title,
      body: `${card.summary || ""}\n\nApproved by ${relay.userId} in Honmaru AI. Verified in Daytona sandbox ${dry.sandboxId}: ${dry.tests?.passed ?? 0} tests passed.\n\nDecision: ${card.id}`,
    });
    dryRuns.delete(card.id);
    if (neo4j.enabled()) neo4j.recordPR(card.id, exec.prUrl).catch(() => {});
    relay.attachEvidence(card, { execution: exec }, [...bits(dry, card.evidence?.graph), `PR: ${exec.prUrl}`]);
    if (card.senderUserID && card.senderUserID !== relay.userId) {
      relay.createCard({
        recipientUserID: card.senderUserID,
        title: ja ? `承認済み: ${card.title}` : `Approved: ${card.title}`,
        summary: ja ? `${relay.userId} が承認し、PR #${exec.number} を開きました。` : `${relay.userId} approved it and PR #${exec.number} is open.`,
        context: `${exec.prUrl} · ${ja ? "テスト" : "tests"} ${dry.tests?.passed ?? 0} ✅`,
        business: card.business,
        labels: ["executed"],
      });
    }
    log(`PR opened: ${exec.prUrl}`);
  } catch (err) {
    log("execution failed", err.message);
    relay.attachEvidence(card, { execution: { error: err.message } }, [...bits(dry, card.evidence?.graph), `⚠️ ${err.message.slice(0, 80)}`]);
  }
}

relay.connect();
log("honmaru agent running as", relay.userId);
