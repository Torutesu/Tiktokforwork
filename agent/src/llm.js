// One OpenAI-compatible chat call against the model running on Nosana.
// A Nosana job (vLLM or Ollama template) exposes /v1/chat/completions; that
// URL is LLM_BASE_URL. There is deliberately no other provider in this file:
// the decision data never leaves the deployment we control.
import { env } from "./env.js";

export async function chat(messages, { json = false, temperature = 0.1, maxTokens = 1200 } = {}) {
  const base = env("LLM_BASE_URL").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env("LLM_API_KEY", "none")}` },
    body: JSON.stringify({
      model: env("LLM_MODEL"),
      temperature,
      max_tokens: maxTokens,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return json ? JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) : text;
}

// Given a few files, ask the model for surgical edits. Returns [{ path, find, replace }].
export async function proposeEdits(instruction, files) {
  const out = await chat([
    {
      role: "system",
      content:
        "You are a careful engineer. Output ONLY JSON: {\"edits\":[{\"path\":string,\"find\":string,\"replace\":string}], \"summary\":string}. " +
        "Each `find` must be an exact substring of that file. Make the smallest change that fulfils the instruction and keeps tests passing.",
    },
    { role: "user", content: `Instruction: ${instruction}\n\n` + files.map((f) => `--- ${f.path}\n${f.content}`).join("\n\n") },
  ], { json: true });
  return { edits: Array.isArray(out.edits) ? out.edits : [], summary: out.summary || "" };
}

// Turn graph rows into one line the recipient can read at a glance.
export async function summarizeGraph({ related, conflicts, locale = "ja" }) {
  if (!related.length && !conflicts.length) return locale === "ja" ? "この事業に関する過去の判断はまだありません" : "No prior decisions on this business yet";
  return chat([
    { role: "system", content: `Summarize in ONE short sentence, in ${locale === "ja" ? "Japanese" : "English"}, for a busy approver. No preamble.` },
    { role: "user", content: JSON.stringify({ related, conflicts }) },
  ], { maxTokens: 120 });
}
