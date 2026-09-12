import "../src/env.js";
import { chat } from "../src/llm.js";
console.log(await chat([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 5 }));
