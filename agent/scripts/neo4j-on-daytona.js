// The decision graph on its own Daytona machine: a persistent sandbox named
// `graph-neo4j` running Neo4j Community, reached through Daytona's preview
// link. Prints the NEO4J_* lines for agent/.env.
//   node scripts/neo4j-on-daytona.js            # create or find, start, print
import "../src/env.js";
import { env } from "../src/env.js";
import { daytona } from "../src/daytona.js";
import { existsSync, readFileSync } from "node:fs";

const NAME = env("GRAPH_SANDBOX", "graph-neo4j");
const VERSION = env("NEO4J_VERSION", "5.26.0");
const PASSWORD = env("NEO4J_PASSWORD", "tfw-hackathon");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sh = async (sb, cmd, timeout = 600) => { const r = await sb.process.executeCommand(cmd, "/home/daytona", undefined, timeout); return { code: r.exitCode, out: String(r.result || "") }; };

let sb;
try { sb = await daytona().get(NAME); if (sb.state === "stopped") await daytona().start(sb); log(`found ${NAME} (${sb.id}, ${sb.state})`); }
catch {
  log(`creating ${NAME}`);
  sb = await daytona().create({ name: NAME, language: "typescript", labels: { app: "tiktok-for-work", role: "graph" }, autoStopInterval: 0, autoArchiveInterval: 0, autoDeleteInterval: -1 });
}
const installed = (await sh(sb, `test -x /home/daytona/neo4j/bin/neo4j && echo yes || echo no`, 30)).out.trim() === "yes";
if (!installed) {
  log("installing Java");
  const j = await sh(sb, "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless > /tmp/apt.log 2>&1; java -version 2>&1 | head -1", 900);
  log("java:", j.out.trim().slice(0, 80));
  log(`downloading Neo4j ${VERSION}`);
  let d = await sh(sb, `curl -sSL --retry 5 --retry-all-errors --retry-delay 3 -o /tmp/neo4j.tgz https://dist.neo4j.org/neo4j-community-${VERSION}-unix.tar.gz && echo ok`, 900);
  const local = env("NEO4J_TARBALL", "");
  if (!d.out.includes("ok") && local && existsSync(local)) {
    log("download failed; uploading the local tarball instead");
    await sb.fs.uploadFile(readFileSync(local), "/tmp/neo4j.tgz", 900);
    d = { out: "ok" };
  }
  if (!d.out.includes("ok")) throw new Error("could not fetch Neo4j: " + d.out.slice(-200));
  const x = await sh(sb, `tar xzf /tmp/neo4j.tgz -C /home/daytona && mv /home/daytona/neo4j-community-${VERSION} /home/daytona/neo4j && echo ok`, 300);
  log("unpack:", x.out.trim().slice(-40));
  await sh(sb, `cd /home/daytona/neo4j && sed -i 's/^#\\?server.default_listen_address=.*/server.default_listen_address=0.0.0.0/; s/^#\\?server.memory.heap.max_size=.*/server.memory.heap.max_size=400m/; s/^#\\?server.memory.pagecache.size=.*/server.memory.pagecache.size=100m/' conf/neo4j.conf && echo 'server.memory.heap.initial_size=200m' >> conf/neo4j.conf && bin/neo4j-admin dbms set-initial-password ${PASSWORD}`, 120);
}
const running = (await sh(sb, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7474/ || true", 20)).out.trim() === "200";
if (!running) {
  log("starting Neo4j");
  await sh(sb, "cd /home/daytona/neo4j && NEO4J_ACCEPT_LICENSE_AGREEMENT=yes nohup bin/neo4j console > /tmp/neo4j.log 2>&1 &", 20);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if ((await sh(sb, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7474/ || true", 20)).out.trim() === "200") break;
  }
}
const check = await sh(sb, `curl -s -u neo4j:${PASSWORD} -H 'content-type: application/json' -X POST http://127.0.0.1:7474/db/neo4j/query/v2 -d '{"statement":"RETURN 1 AS ok"}'`, 30);
log("inside sandbox:", check.out.slice(0, 80));
const link = await sb.getPreviewLink(7474);
console.log("\n# agent/.env");
console.log(`NEO4J_URI=${link.url}`);
console.log(`NEO4J_PREVIEW_TOKEN=${link.token}`);
console.log(`NEO4J_USER=neo4j`);
console.log(`NEO4J_PASSWORD=${PASSWORD}`);
