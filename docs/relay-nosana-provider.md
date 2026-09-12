# Optional: run the relay's routing model on Nosana too

The agent's own model calls already go to the Nosana deployment. The relay's
routing, triage, translation and business-classification calls share one
provider config; adding a branch there points all of them at the same
endpoint, so every model call in the product runs on compute we deploy.

```js
// relay provider config — first branch
if (env.NOSANA_BASE_URL) {
  return {
    providerName: "Nosana",
    endpoint: `${env.NOSANA_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    apiKey: env.NOSANA_API_KEY || "none",
    model: env.NOSANA_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct",
  };
}
```

Then set the two secrets on the deployment and redeploy.

Routing uses tool calling (`create_decision_card`), so the vLLM job needs
`--enable-auto-tool-choice --tool-call-parser hermes` (Qwen2.5 speaks the
hermes format). If the model does not call the tool, the relay falls back to
its keyword router, so the product keeps working while the job is tuned.
