import React, { useMemo, useState } from 'react'
import type { DecisionCard, Evidence as EvidenceT, EvidenceStep } from '../types/card'
import { displayName } from '../utils/names'
import { useT } from '../utils/i18n'
import './Evidence.css'

interface Props {
  card: DecisionCard
  onOpenGraph?: (cardId: string) => void
}

const LAYER_LABEL: Record<string, string> = {
  daytona: 'Daytona',
  neo4j: 'Neo4j',
  github: 'GitHub',
  ai: 'AI',
}

function seconds(ms?: number): string {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
}

function agoShort(iso?: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 30) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

/// The recipient's AI, showing its work. Everything here was found out
/// before the person looked: the dry-run in a sandbox, what the decision
/// graph remembers, and, once they approve, what was executed.
export const Evidence: React.FC<Props> = ({ card, onOpenGraph }) => {
  const t = useT()
  const ev = card.evidence
  const dry = ev?.dryRun
  const graph = ev?.graph
  const exec = ev?.execution
  const steps = ev?.timeline || []
  // Hooks before the early return: a card that gains evidence later must not
  // change the number of hooks this component calls.
  const layers = useMemo(() => ({
    neo4j: Boolean(graph) || steps.some((s) => s.layer === 'neo4j'),
    daytona: Boolean(dry) || steps.some((s) => s.layer === 'daytona'),
  }), [graph, dry, steps])
  const [open, setOpen] = useState<boolean | null>(null)
  if (!ev) return null
  const running = ev.status === 'running'
  const total = ev.finishedAt && ev.startedAt ? Date.parse(ev.finishedAt) - Date.parse(ev.startedAt) : dry?.durationMs
  // While the AI works the steps are the point; once it is done the results
  // are, and the steps fold away behind one line.
  const showSteps = open ?? running

  return (
    <section className={`evidence ${running ? 'is-running' : ''}`} aria-live="polite">
      <header className="ev-head">
        <span className="ev-title"><span className="ai-spark" aria-hidden="true">✦</span> {t('Your AI checked this')}</span>
        <span className={`ev-status ${running ? 'running' : ev.status === 'failed' ? 'failed' : 'done'}`}>
          {running ? <><i className="ev-dot" /> {t('Working')}</> : total ? t('Done in {s}', { s: seconds(total) }) : t('Done')}
        </span>
      </header>

      <div className="ev-layers">
        <span className={`ev-layer daytona ${layers.daytona ? 'on' : ''}`}><i />Daytona {t('sandbox')}</span>
        <span className={`ev-layer neo4j ${layers.neo4j ? 'on' : ''}`}><i />Neo4j {t('graph')}</span>
      </div>

      {steps.length > 0 && !showSteps && (
        <button type="button" className="ev-fold" onClick={() => setOpen(true)}>
          {t('{n} steps', { n: steps.length })} · {steps.filter((s) => s.status === 'done').length} ✓ · {t('show')}
        </button>
      )}
      {steps.length > 0 && showSteps && (
        <ol className="ev-timeline" onClick={() => { if (!running) setOpen(false) }}>
          {steps.map((s: EvidenceStep, i) => (
            <li key={i} className={`ev-step ${s.status} ${s.layer || ''}`}>
              <span className="ev-mark" aria-hidden="true">{s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : ''}</span>
              <span className="ev-text">
                <span className="ev-label">{s.label}</span>
                {s.detail && <span className="ev-detail">{s.detail}</span>}
              </span>
              {s.layer && <span className={`ev-tag ${s.layer}`}>{LAYER_LABEL[s.layer]}</span>}
            </li>
          ))}
        </ol>
      )}

      {dry && (
        <div className="ev-results">
          <span className={`ev-badge tests ${dry.status}`}>
            {dry.status === 'passed' ? '✅' : dry.status === 'failed' ? '❌' : '⚠️'}{' '}
            {dry.status === 'error'
              ? t('Dry-run failed')
              : dry.tests
                ? t('{n} tests passed', { n: dry.tests.passed }) + (dry.tests.failed ? ` · ${t('{n} failed', { n: dry.tests.failed })}` : '')
                : t('Tests ran')}
          </span>
          {typeof dry.filesChanged === 'number' && (
            <span className="ev-badge">{dry.filesChanged === 1 ? t('1 file') : t('{n} files', { n: dry.filesChanged })} <em>+{dry.insertions ?? 0} −{dry.deletions ?? 0}</em></span>
          )}
          {typeof dry.bootMs === 'number' && <span className="ev-badge">{dry.forked === false ? t('Sandbox up in {s}', { s: seconds(dry.bootMs) }) : t('Forked in {s}', { s: seconds(dry.bootMs) })}</span>}
          {dry.branch && <span className="ev-badge mono">{dry.branch}</span>}
          {dry.previewUrl && (
            <a className="ev-badge preview" href={dry.previewUrl} target="_blank" rel="noopener noreferrer">▶ {t('Open the preview')}</a>
          )}
          {dry.editSummary && <p className="ev-edit">{dry.editSummary}</p>}
        </div>
      )}

      {graph && (
        <div className="ev-graph">
          {graph.summary && <p className="ev-summary">{graph.summary}</p>}
          <MiniGraph card={card} />
          {onOpenGraph && (
            <button type="button" className="ev-graph-open" onClick={() => onOpenGraph(card.id)}>{t('Explore in the graph')} ›</button>
          )}
          {(graph.related?.length || 0) > 0 && (
            <ul className="ev-list">
              {graph.related!.slice(0, 3).map((r) => (
                <li key={r.cardId}>
                  <span className={`ev-action ${r.action || ''}`}>{r.action || '·'}</span>
                  <span className="ev-rel-title">{r.title}</span>
                  <span className="ev-rel-meta">{r.by ? displayName(r.by) : ''}{r.decidedAt ? ` · ${agoShort(r.decidedAt)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {(graph.conflicts?.length || 0) > 0 && (
            <ul className="ev-list conflicts">
              {graph.conflicts!.slice(0, 2).map((c) => (
                <li key={c.cardId}>
                  <span className="ev-action warn">⚠</span>
                  <span className="ev-rel-title">{c.title}</span>
                  <span className="ev-rel-meta">{c.recipient ? t('open with {name}', { name: displayName(c.recipient) }) : t('open')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {exec && (exec.prUrl || exec.error) && (
        <div className="ev-exec">
          {exec.prUrl ? (
            <a className="ev-pr" href={exec.prUrl} target="_blank" rel="noopener noreferrer">
              {t('Pull request #{n} is open', { n: exec.number ?? '' })} ↗
            </a>
          ) : (
            <span className="ev-badge failed">⚠️ {exec.error}</span>
          )}
        </div>
      )}
    </section>
  )
}

/// The neighbourhood of this decision in the graph, small enough to sit on a
/// card: the decision in the middle, and around it the business it is about,
/// the repository it touches, who asked, who decided the precedents, whose
/// open work collides, and the PR it produced.
const MiniGraph: React.FC<{ card: DecisionCard }> = ({ card }) => {
  const g = card.evidence?.graph
  const exec = card.evidence?.execution
  const nodes: Array<{ id: string; label: string; kind: string }> = []
  const seen = new Set<string>()
  const add = (id: string, label: string, kind: string) => {
    if (!label || seen.has(id)) return
    seen.add(id); nodes.push({ id, label, kind })
  }
  add('biz', card.business ? card.business.replace(/-/g, ' ') : g?.business || '', 'business')
  add('repo', (g?.repo || '').split('/').pop() || '', 'repo')
  add('asker', card.requestedBy?.name || displayName(card.senderUserID), 'person')
  for (const r of g?.related || []) if (r.by) add(`p-${r.by}`, displayName(r.by), 'person')
  for (const c of g?.conflicts || []) if (c.recipient) add(`c-${c.recipient}`, displayName(c.recipient), 'conflict')
  if (exec?.number) add('pr', `PR #${exec.number}`, 'pr')
  if (nodes.length === 0) return null

  const W = 360, H = 150, cx = W / 2, cy = H / 2, rx = 140, ry = 52
  const placed = nodes.slice(0, 7).map((n, i, arr) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / arr.length
    return { ...n, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }
  })
  return (
    <svg className="ev-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Decision graph">
      {placed.map((n) => <line key={`l-${n.id}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className={`ev-edge ${n.kind}`} />)}
      {placed.map((n) => (
        <g key={n.id} className={`ev-node ${n.kind}`} transform={`translate(${n.x} ${n.y})`}>
          <circle r="5" />
          <text y={n.y < cy ? -10 : 17} textAnchor="middle">{n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label}</text>
        </g>
      ))}
      <g className="ev-node decision" transform={`translate(${cx} ${cy})`}>
        <circle r="8" />
      </g>
    </svg>
  )
}
