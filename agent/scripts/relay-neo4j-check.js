// Joins the relay as the configured user, seeds Neo4j from the snapshot,
// publishes the live graph as this user's context, and prints what it did.
// A check of the relay ⇄ Neo4j half of the runner that needs no sandbox.
import "../src/env.js";
import { env } from "../src/env.js";
import { Relay } from "../src/relay.js";
import * as neo4j from "../src/neo4j.js";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const relay = new Relay({ log, onCard: (c) => log("card for me:", c.id, c.title), onDecision: (c, d) => log("decision:", c.id, d?.action) });
relay.onSnapshot = async (state) => {
  await neo4j.ensureSchema();
  const cards = Object.values(state.cardsById);
  for (const c of cards) await neo4j.upsertCard(c, { repo: env("TARGET_REPO", undefined), orgId: relay.orgId });
  log(`neo4j: ${cards.length} decisions upserted`);
  const g = await neo4j.neighborhood(relay.orgId);
  log(`neighborhood: ${g.nodes.length} nodes, ${g.edges.length} edges`);
  relay.sendContext({ agent: { user: relay.userId, desk: null, working: [], done: 0, at: new Date().toISOString() }, graph: g });
  log("context published; staying connected for", env("CHECK_SECONDS", "20"), "s");
  setTimeout(() => process.exit(0), Number(env("CHECK_SECONDS", "20")) * 1000);
};
relay.connect();
