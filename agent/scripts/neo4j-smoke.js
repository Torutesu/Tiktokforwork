import "../src/env.js";
import { run, ensureSchema } from "../src/neo4j.js";
console.log(await run("RETURN 1 AS ok, $x AS x", { x: "hello" }));
await ensureSchema();
console.log("schema ok");
