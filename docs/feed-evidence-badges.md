# Optional: evidence badges in the web feed

The agent appends `[agent] …` segments to a card's `context`, and the feed
already renders each `" · "`-separated segment as a bullet, so evidence is
visible without touching a client. When there is time for polish, the
structured `evidence` object supports dedicated badges.

In the feed's card component, just above the context list:

```tsx
{card.evidence?.dryRun && (
  <div className="card-evidence">
    <span className={`badge ${card.evidence.dryRun.status}`}>
      {card.evidence.dryRun.status === 'passed' ? '✅' : '❌'} tests{' '}
      {card.evidence.dryRun.tests?.passed ?? 0}/
      {(card.evidence.dryRun.tests?.passed ?? 0) + (card.evidence.dryRun.tests?.failed ?? 0)}
    </span>
    <span className="badge">
      {card.evidence.dryRun.filesChanged} files · sandbox {Math.round(card.evidence.dryRun.durationMs / 1000)}s
    </span>
    {card.evidence.execution?.prUrl && (
      <a className="badge" href={card.evidence.execution.prUrl} target="_blank" rel="noreferrer">
        PR #{card.evidence.execution.number}
      </a>
    )}
  </div>
)}
```

Add `evidence?: Evidence` to the card type (shape in `docs/design.md`), reuse
the existing chip style for `.badge`, and strip the `[agent] ` prefix when
splitting context segments so the bullets and the badges do not both say it.
