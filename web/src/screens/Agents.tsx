import React from 'react'
import type { AppState, AgentStatus, DecisionCard } from '../types/card'
import { useT } from '../utils/i18n'
import { properName } from '../utils/names'
import './Agents.css'

interface Props {
  state: AppState
  userId: string
  members: string[]
  onOpenCard: (id: string) => void
  onClose: () => void
}

function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

/// Every teammate's AI, and the computer it works on. One desk per agent,
/// one sandbox per decision it is checking right now.
export const Agents: React.FC<Props> = ({ state, userId, members, onOpenCard, onClose }) => {
  const t = useT()
  const contexts = state.context || {}
  const ids = Array.from(new Set([...members, ...Object.keys(contexts), userId]))
  const cards = state.cardsById || {}
  const agents = ids.map((id) => ({ id, status: contexts[id]?.agent as AgentStatus | undefined }))
  const machines = agents.reduce((n, a) => n + (a.status?.desk ? 1 : 0) + (a.status?.working?.length || 0), 0)
  const busy = agents.reduce((n, a) => n + (a.status?.working?.length || 0), 0)

  return (
    <div className="screen agents">
      <div className="screen-head">
        <button className="back" onClick={onClose} aria-label={t('Close')}>‹</button>
        <span className="head-title">{t('Your team\'s AIs')}</span>
      </div>
      <div className="screen-body">
        <div className="fleet-stats">
          <div><strong>{agents.filter((a) => a.status).length}</strong><span>{t('agents online')}</span></div>
          <div><strong>{machines}</strong><span>{t('sandboxes')}</span></div>
          <div><strong>{busy}</strong><span>{t('decisions being checked')}</span></div>
        </div>
        <p className="fleet-lede">{t('fleet.lede')}</p>

        <div className="rows-title">{t('Who is here')}</div>
        <div className="fleet">
          {agents.map(({ id, status }) => {
            const name = properName(id)
            const online = Boolean(status)
            return (
              <section className={`agent ${online ? 'online' : 'offline'}`} key={id} data-agent={id}>
                <header className="agent-head">
                  <span className="profile-avatar sm">{(name || '?')[0]?.toUpperCase()}</span>
                  <span className="row-main">
                    {t("{name}'s AI", { name })}{id === userId ? ` · ${t('you')}` : ''}
                    <span className="row-sub">
                      {online
                        ? status?.desk
                          ? t('on {desk}', { desk: status.desk.name || status.desk.id })
                          : t('no desk yet')
                        : t('not running')}
                      {status?.at ? ` · ${ago(status.at)}` : ''}
                    </span>
                  </span>
                  <span className={`agent-dot ${online ? 'on' : ''}`} />
                </header>
                {status && (
                  <div className="machines">
                    {status.desk && (
                      <div className="machine desk">
                        <span className="m-kind">{t('Desk')}</span>
                        <span className="m-id">{status.desk.name || status.desk.id}</span>
                        <span className="m-state">{status.desk.state || 'started'}</span>
                      </div>
                    )}
                    {(status.working || []).map((w) => {
                      const card: DecisionCard | undefined = cards[w.cardId]
                      return (
                        <button className="machine work" key={w.sandboxId} onClick={() => onOpenCard(w.cardId)}>
                          <span className="m-kind">{t('Sandbox')}</span>
                          <span className="m-id">{card?.title || w.cardId}</span>
                          <span className="m-state running"><i />{w.step || w.branch || t('working')}</span>
                        </button>
                      )
                    })}
                    {status.done > 0 && <div className="m-done">{t('{n} decisions executed', { n: status.done })}</div>}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
