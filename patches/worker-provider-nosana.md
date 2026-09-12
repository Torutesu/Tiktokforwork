# worker のルーティングも Nosana で推論する（`worker/src/provider.js` に 9 行）

ランナーだけでなく、HonmaruAI 本体の `/ai/route`・triage・翻訳・事業分類も同じ
Nosana 上のモデルに向ける。`providerConfig` は全呼び出し元が共有する唯一の設定
なので、ここに 1 分岐足すだけで製品全体の推論が Nosana になる。

```js
// worker/src/provider.js — providerConfig() の先頭に追加
if (env.NOSANA_BASE_URL) {
  return {
    providerName: "Nosana",
    endpoint: `${env.NOSANA_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    apiKey: env.NOSANA_API_KEY || "none",
    model: env.NOSANA_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct",
  };
}
```

反映:

```bash
cd worker
npx -y wrangler@4 secret put NOSANA_BASE_URL   # https://<job>.node.k8s.prd.nos.ci/v1
npx -y wrangler@4 secret put NOSANA_MODEL
npm test && npx -y wrangler@4 deploy
```

`create_decision_card` の tool calling を使うので、vLLM 側は
`--enable-auto-tool-choice --tool-call-parser hermes` を付けて起動する（Qwen2.5 は
hermes 形式）。tool calling が通らない場合でも `routing.js` は
「モデルが `create_decision_card` を呼ばなかった」時にキーワードルーターへ落ちるので、
製品は止まらない。ただしデモで見せる推論は Nosana に乗った状態にすること。
