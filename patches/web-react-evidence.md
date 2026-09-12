# P2: web-react に evidence バッジを出す（10 行）

`context` に `[honmaru] …` セグメントを足す方式で **UI 変更なしでも証拠は見える**。
時間が余ったら HonmaruAI 側 `web-react/src/components/Feed.tsx` の `card-context` の直前に:

```tsx
{card.evidence?.dryRun && (
  <div className="card-evidence">
    <span className={`badge ${card.evidence.dryRun.status}`}>
      {card.evidence.dryRun.status === 'passed' ? '✅' : '❌'} tests {card.evidence.dryRun.tests?.passed ?? 0}/{(card.evidence.dryRun.tests?.passed ?? 0) + (card.evidence.dryRun.tests?.failed ?? 0)}
    </span>
    <span className="badge">{card.evidence.dryRun.filesChanged} files · Daytona {Math.round(card.evidence.dryRun.durationMs / 1000)}s</span>
    {card.evidence.execution?.prUrl && <a className="badge" href={card.evidence.execution.prUrl} target="_blank">PR #{card.evidence.execution.number}</a>}
  </div>
)}
```

`src/types/card.ts` の `DecisionCard` に `evidence?: any` を足し、CSS は既存の chip
スタイル（`.badge`）を流用。`[honmaru]` プレフィックスは `segments()` 内で
`seg.replace(/^\[honmaru\]\s*/, '')` で剥がす。
