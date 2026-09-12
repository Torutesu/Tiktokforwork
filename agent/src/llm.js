// One OpenAI-compatible chat call. LLM_BASE_URL is any /v1 endpoint that
// speaks chat/completions (OpenAI by default); LLM_MODEL picks the model.
import { env, has } from "./env.js";

export const hasModel = () => has("LLM_API_KEY");

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
  if (!hasModel()) return { edits: [], summary: "" };
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
  if (!hasModel()) return templateSummary({ related, conflicts, locale });
  return chat([
    { role: "system", content: `Summarize in ONE short sentence, in ${locale === "ja" ? "Japanese" : "English"}, for a busy approver. No preamble.` },
    { role: "user", content: JSON.stringify({ related, conflicts }) },
  ], { maxTokens: 120 });
}

// The same sentence, written by hand from the rows, when no model is configured.
function templateSummary({ related, conflicts, locale }) {
  const who = (l) => String(l || "").replace(/^(u:|email:)/, "").split("@")[0];
  const approved = related.filter((r) => r.action === "approve").length;
  const last = related[0];
  const ja = locale === "ja";
  const parts = [];
  if (related.length) {
    parts.push(ja
      ? `この事業の直近 ${related.length} 件のうち ${approved} 件が承認${last?.by ? `、最新は ${who(last.by)} の判断` : ""}`
      : `${approved} of the last ${related.length} decisions on this business were approved${last?.by ? `, most recently by ${who(last.by)}` : ""}`);
  }
  if (conflicts.length) {
    const c = conflicts[0];
    parts.push(ja
      ? `${who(c.recipient)} の未決カード「${c.title}」が同じリポジトリに触れている`
      : `${who(c.recipient)} has an open card touching the same repository: "${c.title}"`);
  }
  return parts.join(ja ? "。" : ". ") + (ja ? "。" : ".");
}
