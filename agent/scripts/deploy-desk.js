// Put an agent on its own computer: create (or find) the desk sandbox for a
// user, upload this directory, install, and start the runner inside it.
//   node scripts/deploy-desk.js            # uses AGENT_USER_ID from .env
import "../src/env.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { daytona, ensureDesk } from "../src/daytona.js";
import { env } from "../src/env.js";

const user = env("AGENT_USER_ID");
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const desk = await ensureDesk(user, { log: console.log, onStep: (l, d) => console.log("desk:", l, d || "") });
const home = "/home/daytona/agent";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".cache", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}
let n = 0;
for (const file of walk(root)) {
  await desk.fs.uploadFile(readFileSync(file), `${home}/${relative(root, file)}`);
  n++;
}
console.log(`uploaded ${n} files to ${desk.name}:${home}`);
const install = await desk.process.executeCommand("npm install --silent", home, undefined, 600);
console.log("npm install:", install.exitCode);
const envs = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(RELAY_|ORG_ID|AGENT_|DAYTONA_|TARGET_|GITHUB_|NEO4J_|LLM_|PREVIEW_|DRYRUN_|LOCALE)/.test(k)));
const exports = Object.entries(envs).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join("; ");
await desk.process.executeCommand(`pkill -f "node src/index.js" || true; ${exports}; nohup node src/index.js > /tmp/agent.log 2>&1 &`, home, undefined, 20);
console.log(`agent for ${user} is running inside ${desk.name} (${desk.id}). Logs: /tmp/agent.log in the sandbox`);
void daytona;
