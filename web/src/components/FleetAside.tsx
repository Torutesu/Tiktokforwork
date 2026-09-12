import React from 'react'
import type { AppState, AgentStatus } from '../types/card'
import { useT } from '../utils/i18n'
import { properName } from '../utils/names'
import './FleetAside.css'

interface Props {
  state: AppState
  userId: string
  onOpenAgents: () => void
  onOpenGraph: () => void
  onOpenCard: (id: string) => void
}

function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`
}

/// The team's AIs, beside the feed on a wide screen: who is online, on which
/// machine, and which decision each one is checking right now.
export const FleetAside: React.FC<Props> = ({ state, userId, onOpenAgents, onOpenGraph, onOpenCard }) => {
  const t = useT()
  const contexts = state.context || {}
  const cards = state.cardsById || {}
  const ids = Array.from(new Set([userId, ...Object.keys(contexts), ...Object.values(cards).flatMap((c) => [c.recipientUserID, c.senderUserID])].filter(Boolean)))
  const agents = ids.map((id) => ({ id, status: contexts[id]?.agent as AgentStatus | undefined }))
    .sort((a, b) => Number(Boolean(b.status)) - Number(Boolean(a.status)))
  const online = agents.filter((a) => a.status).length
  const sandboxes = agents.reduce((n, a) => n + (a.status?.desk ? 1 : 0) + (a.status?.working?.length || 0), 0)
  const checking = agents.reduce((n, a) => n + (a.status?.working?.length || 0), 0)
  const pending = Object.values(cards).filter((c) => c.status === 'pending' && c.recipientUserID === userId).length

  return (
    <aside className="fleet-aside" aria-label={t("Your team's AIs")}>
      <div className="fa-title">{t("Your team's AIs")}</div>
      <div className="fa-stats">
        <button onClick={onOpenAgents}><strong>{online}</strong><span>{t('agents online')}</span></button>
        <button onClick={onOpenAgents}><strong>{sandboxes}</strong><span>{t('sandboxes')}</span></button>
        <button onClick={onOpenGraph}><strong>{checking}</strong><span>{t('decisions being checked')}</span></button>
      </div>
      <ul className="fa-list">
        {agents.slice(0, 6).map(({ id, status }) => {
          const name = properName(id)
          const work = status?.working || []
          return (
            <li key={id} className={status ? 'online' : 'offline'}>
              <span className="fa-avatar">{(name || '?')[0]?.toUpperCase()}</span>
              <span className="fa-main">
                <span className="fa-name">{t("{name}'s AI", { name })}{id === userId ? ` · ${t('you')}` : ''}<i className={`fa-dot ${status ? 'on' : ''}`} /></span>
                <span className="fa-sub">
                  {status ? (status.desk ? t('on {desk}', { desk: status.desk.name || status.desk.id }) : t('no desk yet')) : t('not running')}
                  {status?.at ? ` · ${ago(status.at)}` : ''}
                </span>
                {work.map((w) => (
                  <button key={w.sandboxId} className="fa-work" onClick={() => onOpenCard(w.cardId)}>
                    <i /> {cards[w.cardId]?.title || w.cardId}
                    <em>{w.step || t('working')}</em>
                  </button>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="fa-foot">
        <span>{pending} {t('waiting on you')}</span>
        <button onClick={onOpenGraph}>{t('Decision graph')} ›</button>
      </div>
    </aside>
  )
}
