# Honmaru AI × Daytona HackSprint Tokyo — 設計書

> **一行コンセプト:** 「承認したら、もう動いている」。
> Decision Card が届く前に、受信者の AI が Daytona で"やってみて"、結果（diff・テスト・影響範囲）を証拠として添えて届ける。人は証拠を見て一回スワイプするだけ。承認した瞬間に PR が立ち、判断は Neo4j のグラフに残って次の判断の文脈になる。

ハッキング時間は 14:00–16:00 の 2 時間。**worker（Cloudflare）と iOS は一切触らない。** 新規ディレクトリ `agent/`（Node 22 の単一プロセス）に 3 スポンサーの統合を全部集約し、既存の relay プロトコル（AG-UI over WebSocket）に「受信者の AI」として参加する。デプロイ不要、ラップトップで動く。

---

## 1. 第一原理から: 本質的な価値は何か

HonmaruAI の主張は「人間は自分の AI とだけ話し、判断はカードになって届く」。この主張の弱点は 2 つある。

1. **判断の質は、届いた文脈の質で決まる。** 今のカードは「タイトル・要約・文脈」のテキスト。「これを承認すると何が起きるか」「前に似た判断をしたか」「誰の作業とぶつかるか」は載っていない。承認者は結局 Slack や GitHub を開いて調べる。カードが"判断の入口"ではなく"通知"に戻ってしまう。
2. **承認は仕事の終わりではなく始まり。** スワイプで approve しても、誰かがコードを書き、テストを回し、PR を出す。承認と実行の間の「誰がやるの？」ギャップが、小さなチームで一番の摩擦。

つまり本質価値は **「判断に証拠と結果を同梱すること」**。この 2 つのギャップを埋めるのに、ちょうど 3 スポンサーが必要になる。

| ギャップ | 埋めるもの | スポンサー | なぜこれでないと駄目か |
|---|---|---|---|
| 承認前に「やってみた結果」がない | カードごとに隔離環境で dry-run（clone → 変更 → test） | **Daytona** | カードは 1 日に何十枚も並列に生まれる。1 枚 1 サンドボックスで 100ms 起動・並列・使い捨てでないと「届いた時にはもう証拠がある」UX にならない。人の PC で走らせたら順番待ちになる |
| 「前にどう決めたか」「誰に影響するか」が見えない | 判断・人・事業・リポジトリ・PR を一つのグラフに | **Neo4j** | D1 の行にある `business` スラッグでは「Tanaka が過去に承認した hotel 系の判断 → その PR → 触ったファイル → 今 Yui が開いているカード」の 3 ホップ以上の問いに答えられない。GraphRAG で"判断の文脈"を LLM に渡す |
| 判断＝会社で一番機密なデータを OpenAI に投げている | dry-run のパッチ生成・グラフ要約を Nosana 上のオープンモデルで推論 | **Nosana** | 承認カードの中身（価格変更、人事、取引先）を外部 API に出せない会社は日本に多い。オンデマンド GPU で自社モデルを動かす、というのが本番運用の答え |

## 2. ターゲットとペイン

- **誰:** 少人数（3〜10 人）で複数の事業・複数リポジトリを回しているチーム。HonmaruAI の既存前提（10 人で 10 事業）そのまま。
- **状況:** オーナーが「予約サイトの価格を税込表示にして」と口にする。承認者はエンジニアに近い人で、承認前に「壊れないか」「他の作業とぶつからないか」を確かめたい。
- **痛み:** 承認するために Slack・GitHub・過去の議事録を 3 つ開く。承認しても誰かが着手するまで 2 日止まる。

## 3. コアユースケース（1 つだけ、エンドツーエンド）

```
Toru（オーナー）が自分の AI に言う
  「本丸ホテルの予約サイトの価格表示を税込にして」
        │  既存: /ai/route → Tanaka（承認者）宛の approval カード
        ▼
Tanaka の AI（= agent/ ランナー）が relay でカードを受け取る
        │
        ├─ Neo4j: 「hotel-honmaru に関する過去の判断」「同じ repo を触っている open カード」
        │          「Tanaka が過去に承認した回数」を Cypher で取得 → 1 行の文脈に要約
        │
        ├─ Daytona: サンドボックス起動 → repo clone → LLM(Nosana) が編集 → npm test
        │          → diff の統計・テスト結果・ブランチ名
        │
        └─ card_updated { evidence: { graph, dryRun } }   ← 受信者本人の AI なので relay が受理
        ▼
Tanaka のフィードに「証拠付きカード」が出る
  ✅ 14 tests passed · 2 files changed · 前回 8/30 に類似の判断を承認 · Yui の open カードと同じ repo
        │  スワイプ右（approve）
        ▼
Tanaka の AI が TOOL_CALL_RESULT を見て
  ├─ Daytona: そのサンドボックスから branch を push → GitHub PR 作成
  ├─ Neo4j: (Decision)-[:APPROVED_BY]->(Tanaka), (Decision)-[:PRODUCED]->(PR) を書く
  └─ card_created: Toru 宛に「PR #12 を開きました」の notification カード
```

ストレッチ（時間が余ったら）: reject 時にサンドボックスを破棄して Neo4j に `REJECTED` を記録するだけ。「却下しても学習が残る」の一言が言える。

## 4. アーキテクチャ

```
┌────────────┐  wss (AG-UI)  ┌─────────────────────────┐
│ web-react  │◄─────────────►│ worker (Cloudflare)      │  ← 一切変更しない
│ Tanaka/Toru│               │ OrgRelay DO · D1 · /ai/route │
└────────────┘               └───────────┬─────────────┘
                                         │ wss (AG-UI) join as Tanaka
                              ┌──────────▼──────────┐
                              │ agent/  (Node 22)   │  ← 今日書くのはここだけ
                              │ "受信者の AI"        │
                              └──┬───────┬────────┬─┘
                                 ▼       ▼        ▼
                             Daytona   Neo4j    Nosana
                             sandbox   Aura     OpenAI互換
                             (SDK)     Query API  /v1/chat/completions
```

**なぜ relay を触らないで済むか（コードで確認済み）**

- `card_updated` は **受信者本人**だけが送れる（`worker/src/relay.js`）。ランナーを「受信者のセッショントークン」で join させれば、カードに任意フィールドを足して保存・全員に STATE_DELTA で配信される。`validateIncomingCard` は既知フィールドの長さだけ見るので `evidence` は素通りして `cards.data` に JSON のまま残る。
- `card_created` は誰でも自分名義で送れる → 完了通知カードは Tanaka の AI から Toru に送れる。
- join 時の `STATE_SNAPSHOT` に org の全カードが入る → Neo4j の初期投入はこれを流すだけ。org のメンバーは `GET /members?orgId=` で取れる。
- 決定は `TOOL_CALL_RESULT` イベントで届く（`docs/agui-protocol.md`）。

これは HonmaruAI の設計思想そのもの:「受信側の AI は生のメッセージを渡すのではなく、受信者の役割・状況を踏まえて判断しやすい形に変換する」。ランナーは"受信者の AI"の実体化であり、後付けではない。

## 5. MVP スコープ（削る順に P2 から）

| 優先 | やること | 誰が見ても動いた証拠 |
|---|---|---|
| **P0** | ランナーが Tanaka として join し、新規 pending カードに `evidence.dryRun`（Daytona で clone + test した結果）を付けて `card_updated` | Tanaka の画面のカードに「✅ tests passed」が後から浮かぶ |
| **P0** | approve の `TOOL_CALL_RESULT` を拾って Toru 宛に完了カードを `card_created` | Toru の画面に結果カードが飛ぶ |
| **P0** | Neo4j にメンバー・事業・カード・判断をノードとして書く（join snapshot から一括、以後は差分） | Neo4j Browser でグラフが見える |
| **P1** | Neo4j から「関連する過去の判断」「同 repo の open カード」を Cypher で取り `evidence.graph` に載せる | カードに「前回 8/30 に承認」の行 |
| **P1** | LLM（Nosana エンドポイント）がサンドボックス内のファイルを編集してからテスト | diff 統計が 0 でなくなる |
| **P1** | approve 後に branch push → PR URL をカードに | PR リンク |
| **P2** | web-react の Feed に `evidence` 専用の描画（バッジ 3 つ） | 見栄え。P2 なのは `context` 文字列に " · " 区切りで書けば**既存 UI がそのまま箇条書きにする**から（`Feed.tsx` の `segments()`）|
| **P2** | reject → sandbox 破棄 + Neo4j に REJECTED | 一言で済む |

**カットライン:** 15:20 時点で P0 が通っていなければ P1 は全部捨て、Daytona の dry-run を「clone + `npm test` だけ」に固定して確実に動かす。デモは P0 だけで成立する（証拠が浮かぶ → スワイプ → 結果が飛ぶ → グラフ）。

## 6. 2 分デモのストーリーボード

| 秒 | 画面 | セリフ |
|---|---|---|
| 0–15 | Toru の画面。フィードは空 | 「小さなチームは承認の前に 3 つのツールを開き、承認の後に 2 日止まります。これを 1 スワイプにします」 |
| 15–35 | Toru が入力「本丸ホテルの予約サイトの価格を税込表示にして」 | 「Toru は自分の AI に話すだけ。AI が承認者 Tanaka に Decision Card を送ります」 |
| 35–70 | **Tanaka の画面**。カードが届く → 数秒後に証拠が浮かぶ（tests passed / 2 files / 過去の類似判断 / Yui との競合）。隣にターミナルで Daytona sandbox のログ | 「届く前に Tanaka の AI が Daytona のサンドボックスでやってみました。100ms で起動、カード 1 枚に 1 環境、使い捨て。Neo4j が"前回どう決めたか、誰にぶつかるか"を足しています」 |
| 70–90 | Tanaka がスワイプ右 | 「証拠を見て、一回スワイプ」 |
| 90–105 | Toru の画面に「PR #12 を開きました」カード。GitHub の PR ページ | 「承認した瞬間に PR。誰も着手を待ちません」 |
| 105–120 | Neo4j Browser のグラフ（Decision–Business–Person–PR） | 「判断はグラフに残り、次の判断の文脈になります。推論は Nosana 上のオープンモデル。判断という一番機密なデータを外に出さない」 |

**デモ保険:** Daytona 実行は 30–90 秒かかる。デモ前に同じ指示を 1 回流しておき、当日は事前実行済みの sandbox 結果を `DEMO_CACHE=1` で即時返せるようにしておく（`agent/src/daytona.js` のキャッシュ分岐）。ライブで走らせるのは 1 回、見せ場は「浮かぶ瞬間」だけにする。

## 7. データ設計

### 7.1 カードに足すフィールド（relay は素通し）

```jsonc
"evidence": {
  "dryRun": {
    "sandboxId": "…", "branch": "honmaru/card-abc123",
    "filesChanged": 2, "insertions": 9, "deletions": 3,
    "tests": { "passed": 14, "failed": 0, "raw": "…tail…" },
    "status": "passed" | "failed" | "error",
    "durationMs": 41000
  },
  "graph": {
    "summary": "hotel-honmaru の判断 3 件、直近は 8/30 に Tanaka が承認。Yui の open カード #c9 が同じ repo。",
    "related": [{ "cardId": "…", "title": "…", "action": "approve", "decidedAt": "…" }],
    "conflicts": [{ "cardId": "…", "recipient": "yui" }]
  },
  "execution": { "prUrl": "https://github.com/…/pull/12", "pushedAt": "…" }
}
```

同時に `context` 文字列の末尾に `" · ✅ 14 tests passed · 2 files changed · 前回 8/30 に承認"` を足す。**既存 UI がそのまま箇条書きにする**ので、P2 の UI 作業なしで見える。

### 7.2 Neo4j グラフモデル

```
(:Person {login, name, role})
(:Business {slug, name})
(:Decision {id, title, type, status, priority, createdAt, decidedAt, action})
(:Repo {fullName})
(:PR {url, number})

(Person)-[:MEMBER_OF]->(Org)
(Person)-[:REQUESTED]->(Decision)
(Decision)-[:ASSIGNED_TO]->(Person)
(Decision)-[:DECIDED_BY {action, at, note}]->(Person)
(Decision)-[:ABOUT]->(Business)
(Decision)-[:TOUCHES]->(Repo)
(Decision)-[:PRODUCED]->(PR)
```

文脈取得の Cypher（`agent/src/neo4j.js` に実装済み）:

```cypher
// 同じ事業の過去の判断（決定済み・新しい順・5 件）
MATCH (d:Decision {id:$id})-[:ABOUT]->(b:Business)<-[:ABOUT]-(p:Decision)
WHERE p.id <> d.id AND p.action IS NOT NULL
OPTIONAL MATCH (p)-[r:DECIDED_BY]->(who:Person)
RETURN p.id, p.title, p.action, r.at, who.login ORDER BY r.at DESC LIMIT 5

// 同じ repo を触る open なカード（競合）
MATCH (d:Decision {id:$id})-[:TOUCHES]->(r:Repo)<-[:TOUCHES]-(o:Decision)-[:ASSIGNED_TO]->(p:Person)
WHERE o.id <> d.id AND o.action IS NULL
RETURN o.id, o.title, p.login
```

### 7.3 Daytona の手順（`agent/src/daytona.js`）

1. `daytona.create({ language: "typescript" })` — 1 カード 1 サンドボックス
2. `sandbox.git.clone(repoUrl, "/home/daytona/repo", "main", undefined, ghUser, ghToken)`
3. `git checkout -b honmaru/card-<id>`
4. （P1）`git grep -l` でキーワードに触るファイルを 3 つまで取り、LLM に JSON の `{path, find, replace}` を出させ、`sandbox.fs.uploadFile` で書き戻す
5. `npm ci && npm test` → exitCode と末尾 40 行を evidence に
6. `git diff --shortstat` → filesChanged 等
7. approve なら `git push -u origin <branch>` → GitHub API で PR 作成。reject / タイムアウトなら `sandbox.delete()`

### 7.4 Nosana（`agent/src/llm.js`）

OpenAI 互換の `POST {LLM_BASE_URL}/chat/completions`。Nosana ダッシュボードで vLLM / Ollama テンプレ（Qwen2.5-Coder 7B 推奨）をデプロイして得た URL を `LLM_BASE_URL` に入れるだけ。取れなかったら `LLM_BASE_URL=https://api.openai.com/v1` に戻す。**デモでは Nosana ジョブのダッシュボード画面を 1 カット見せる**（審査基準 4 の"名義だけでない"の証拠）。

## 8. 14:00–16:00 のタスク分解（4 人想定）

| 時刻 | A: ランナー/relay | B: Daytona | C: Neo4j | D: デモ/データ |
|---|---|---|---|---|
| 14:00 | `agent/` を clone、`npm i`、Tanaka と Toru のセッショントークンを web-react の localStorage から取り `.env` に | Daytona API key、`node scripts/daytona-smoke.js` で create → exec → delete が通るまで | Aura Free を作り Query API に `RETURN 1` が通るまで | デモ用リポジトリ（小さな予約サイト + 5 個の jest テスト）を用意、Tanaka にコラボレータ権限 |
| 14:20 | ランナーが join → snapshot を受けてログに出るまで | `dryRun(card)` が clone + test の結果オブジェクトを返す | `syncSnapshot()` で snapshot の人・カードをノードに | 事業 `hotel-honmaru` に過去の決定カード 3 枚を先に作って承認しておく（グラフの見せ場の種） |
| 14:45 | 新カード → `dryRun` → `card_updated` の結線。Tanaka の画面で証拠が浮くのを確認 | LLM 編集ステップ（P1） | `contextFor(card)` の Cypher 2 本 | Nosana にモデルをデプロイ、`LLM_BASE_URL` 差し替え |
| 15:15 | `TOOL_CALL_RESULT` → push + PR + Toru への完了カード | PR 作成 | `recordDecision()` | デモ台本を通しで 2 回。事前実行のキャッシュを作る |
| 15:40 | **フリーズ。** 以降は台本練習とバックアップ動画の撮影のみ | | | |

## 9. リスクとフォールバック

| リスク | 兆候 | 逃げ道 |
|---|---|---|
| Daytona で `npm ci` が遅い（60 秒超） | 証拠が浮くまで長い | デモ用 repo の依存を 0 に近づける（Node 標準の `node --test`）。事前実行キャッシュ |
| セッショントークンが期限切れ | join が `sign-in-required` | web-react で再ログインして取り直す。手順を README に |
| Neo4j Query API が Aura の版で無い | 404 | `neo4j-driver` に切替（Node なので Bolt が使える）。`neo4j.js` の関数シグネチャは変えない |
| Nosana のデプロイが間に合わない | 15:00 時点で URL がない | OpenAI に戻し、デモでは「差し替え可能」と正直に言う。審査基準 4 は Daytona と Neo4j で満たす |
| LLM のパッチが壊れてテストが落ちる | `status: failed` | それも証拠。「落ちるとわかった上で判断できる」はむしろ主張と一致 |

## 10. このハッカソンで検証できる仮説

1. **「証拠付きのカードは、証拠なしより速く判断される」** — デモで 2 人に同じカードを見せ、判断までの秒数を比べる。定性的でも「開いた瞬間わかった」の一言が取れれば十分。
2. **「承認 = 実行」の方が「承認 → 誰かが着手」より受け入れられるか** — 却下したくなる瞬間（勝手に PR を出されたくない）があるか。あれば「push は approve 後」という今の設計が正解、なければ「PR まで先に作っておく」に倒せる。
3. **判断のグラフは"次の判断"に効くか** — 3 枚目のカードで「前回はこう決めた」が出た時に、承認者がそれを読んだか。読まないなら GraphRAG の価値は"記録"側にある。

## 11. 審査基準との対応

- **完成度:** P0 の 1 フローがエンドツーエンド。worker/iOS を触らないので壊さない。
- **革新性:** 「判断に証拠と結果を同梱」は 3 つの組み合わせでしか成立しない（並列使い捨て環境 × 関係性の記憶 × 機密を外に出さない推論）。
- **現実の問題:** 少人数多事業チームの「承認前の調査」と「承認後の放置」。
- **スポンサー活用:** Daytona = 1 カード 1 サンドボックスの UX そのもの。Neo4j = 判断の文脈 OS。Nosana = 判断データを外に出さない推論基盤。
