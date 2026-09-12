# agent/ — 受信者の AI ランナー

HonmaruAI の relay に「ある受信者の AI」として参加し、届いた Decision Card に
Daytona の dry-run と Neo4j の文脈を証拠として付け、承認されたら PR を開く。
worker も iOS も触らない。設計は [../HACKATHON.md](../HACKATHON.md)。

**3 スポンサーは前提。** 起動時に Daytona・Neo4j・Nosana の 3 つへ疎通確認
（preflight）を行い、1 つでも応答しなければ起動しない。「無ければスキップ」の
分岐は意図的に置いていない。

## 起動

```bash
cd agent
npm install                 # 依存は @daytonaio/sdk だけ。Node 22 以上
cp .env.example .env        # 値を埋める（下記）
npm run smoke:daytona       # create → exec → delete が通るか
npm run smoke:neo4j         # RETURN 1 と制約作成
npm run smoke:llm           # Nosana 上のモデル（OpenAI 互換 /v1）
npm start                   # preflight → relay に join
```

## Nosana のデプロイ

1. Nosana ダッシュボードで vLLM または Ollama のテンプレートを選び、
   `Qwen/Qwen2.5-Coder-7B-Instruct`（編集提案とグラフ要約の両方に十分）を指定してデプロイ。
2. ジョブの公開 URL に `/v1` を付けて `LLM_BASE_URL` に、モデル名を `LLM_MODEL` に。
3. `npm run smoke:llm` が `ready` を返せば OK。ランナーが行う LLM 呼び出しは
   すべてここに行く（パッチ提案・グラフ要約）。worker 側のルーティングも同じ
   エンドポイントに向ける手順は [../patches/worker-provider-nosana.md](../patches/worker-provider-nosana.md)。

## セッショントークンの取り方

web-react で **受信者（例: Tanaka）** としてログインし、DevTools → Application →
Local Storage → `sessionToken` と `userId` をコピーして `AGENT_SESSION_TOKEN` /
`AGENT_USER_ID` に入れる。`ORG_ID` は同じく `orgId`。
relay は `card_updated` を受信者本人にしか許さないので、ランナーは必ず受信者の
トークンで動かす。デモで 2 人分の AI を動かすならプロセスを 2 つ立てる。

## 動作

| relay イベント | ランナーの動き |
|---|---|
| `STATE_SNAPSHOT`（join 直後） | メンバーと全カードを Neo4j に upsert |
| `STATE_DELTA` で自分宛の新カード | Neo4j で関連判断・競合を取得 → `card_updated`。次に Daytona で clone / 編集 / test → もう一度 `card_updated` |
| `TOOL_CALL_RESULT` approve | 同じ sandbox から branch を push → PR → 依頼者へ完了カード → Neo4j に PRODUCED |
| それ以外の決定 | sandbox 破棄、判断をグラフに記録 |

証拠は `card.evidence`（JSON）と、`card.context` の末尾に `[honmaru] …` の
セグメントとして入る。web-react の Feed は `context` を " · " で割って箇条書きに
するので、**UI を変えなくても証拠が見える**。

## デモ保険

`DEMO_CACHE=1` にすると同じ指示文の dry-run 結果を `.cache/dryrun.json` から即時
返す（sandbox は作らないので approve → push は動かない）。本番デモは
`DEMO_CACHE=0` で 1 回だけライブに走らせ、リハーサルはキャッシュで回す。

## 確認済み / 要確認

- ✅ `@daytonaio/sdk` 0.211.2 の型定義で確認済み: `process.executeCommand(cmd, cwd?, env?, timeoutSec?)`、
  `git.clone(url, path, branch?, commitId?, username?, password?)`、`fs.uploadFile(Buffer, remotePath)`、
  `sandbox.delete()`、`daytona.create({ language })`
- ⚠️ 未実行（API キーがこの環境に無い）: 実際の create → exec → delete は `npm run smoke:daytona` で当日確認
- ⚠️ Neo4j Aura の Query API パス `/db/neo4j/query/v2` は `npm run smoke:neo4j` で確認。無ければ `neo4j-driver`（Bolt）に切替し、`run()` だけ差し替える（Neo4j を外す選択肢はない）
- ⚠️ Nosana のジョブ URL は実行ごとに変わる。当日デプロイしたら `.env` を更新して `smoke:llm`
