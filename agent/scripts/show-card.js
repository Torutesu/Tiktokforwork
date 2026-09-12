// Print one card (or the latest) as the relay holds it, from this user's snapshot.
import "../src/env.js";
import { Relay } from "../src/relay.js";
const wanted = process.argv[2];
const relay = new Relay({ log: () => {} });
relay.onSnapshot = (state) => {
  const cards = Object.values(state.cardsById).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const c = wanted ? state.cardsById[wanted] : cards[0];
  if (!c) { console.log("no card"); process.exit(1); }
  const { evidence, ...rest } = c;
  console.log(JSON.stringify({ id: rest.id, title: rest.title, status: rest.status, decision: rest.decision, context: rest.context, evidence: evidence ? { ...evidence, dryRun: evidence.dryRun ? { ...evidence.dryRun, tests: { ...evidence.dryRun.tests, raw: undefined } } : undefined } : undefined }, null, 2));
  process.exit(0);
};
relay.connect();
