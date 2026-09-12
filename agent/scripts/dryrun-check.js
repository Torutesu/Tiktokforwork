// A real dry-run with no relay and no model: make (or find) the desk for
// DRYRUN_USER, fork it for a fake card, run the target's tests, start the
// preview, print the evidence, and delete the fork.
import "../src/env.js";
import { env } from "../src/env.js";
import * as daytona from "../src/daytona.js";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const user = env("DRYRUN_USER", "check");
const t0 = Date.now();
const desk = await daytona.ensureDesk(user, { log, onStep: (l, d) => log("desk:", l, d || "") });
log(`desk ready in ${Date.now() - t0} ms: ${desk.name} (${desk.id}, ${desk.state})`);
const card = { id: `card-check-${Date.now().toString(36)}`, title: env("DRYRUN_TITLE", "Show tax-inclusive prices on the booking site"), type: "approval" };
const dry = await daytona.dryRun(card, desk, {
  log,
  withEdits: env("DRYRUN_EDITS", "0") === "1",
  onStep: (label, detail) => log("step:", label, detail || ""),
});
console.log(JSON.stringify({ ...dry, tests: { ...dry.tests, raw: undefined } }, null, 2));
if (dry.previewUrl) {
  const r = await fetch(dry.previewUrl).catch((e) => ({ status: "ERR " + e.message }));
  log("preview fetch:", r.status);
}
if (env("KEEP", "0") !== "1") { await daytona.discard(card.id); log("fork deleted"); }
log(`total ${Date.now() - t0} ms`);
