import React, { useState, useEffect, useCallback, useRef } from 'react'
import { WebSocketClient } from '../services/WebSocketClient'
import { DemoClient, isDemo, DEMO_BUSINESSES, demoRoute, demoRouteText } from '../services/DemoClient'
import { Feed } from './Feed'
import { ClassicList } from './ClassicList'
import { Icon } from './Icon'
import { DecisionCard } from './DecisionCard'
import { CreateDecision } from './CreateDecision'
import { RecordSheet } from './RecordSheet'
import { Team } from '../screens/Team'
import { Agents } from '../screens/Agents'
import { Graph } from '../screens/Graph'
import { FleetAside } from './FleetAside'
import { Tools } from '../screens/Tools'
import { History } from '../screens/History'
import { NotificationSettings } from '../screens/NotificationSettings'
import { Plans } from '../screens/Plans'
import { Profile } from '../screens/Profile'
import { NotificationsButton } from './NotificationsBanner'
import { notifyNewDecision, setTabBadge } from '../utils/notifications'
import { syncLocale } from '../utils/push'
import type { AppState, Business } from '../types/card'
import './Dashboard.css'
import { useT } from '../utils/i18n'
import { getLocale } from '../utils/locale'
import { properName } from '../utils/names'

interface Props {
  userId: string
  orgId: string
  relayUrl: string
  sessionToken: string
  onLogout: () => void
  onSwitchOrg: (orgId: string) => void
  /// This account is no longer in the workspace on screen. The shell finds
  /// them another one.
  onLeft: () => void
}

type Panel = null | 'compose' | 'sent' | 'done' | 'record'
type Mode = 'cards' | 'classic'
// A full screen over the feed, as opposed to a sheet. These are the design's
// own screens — Tools, History, Notifications, Plan, You — and each one owns
// the viewport while it is open.
type Screen = null | 'tools' | 'history' | 'notifications' | 'plans' | 'profile' | 'team' | 'agents' | 'graph'

/// The shell around the feed. The feed is the screen; everything else —
/// telling your AI something, what you sent, what you decided, the team —
/// is a sheet over it that closes back to the feed.
export const Dashboard: React.FC<Props> = ({ userId, orgId, relayUrl, sessionToken, onLogout, onSwitchOrg, onLeft }) => {
  const t = useT()
  const [state, setState] = useState<AppState>({ cardsById: {} })
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Where what you just told your AI went. Shown for a few seconds.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(id) }, [notice])
  const [panel, setPanel] = useState<Panel>(null)
  const [screen, setScreen] = useState<Screen>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [debugLog, setDebugLog] = useState<Array<{ timestamp: string; message: string }>>([])
  const showDebug = import.meta.env.VITE_DEBUG === 'true' || (typeof location !== 'undefined' && location.search.includes('debug'))
  // Bumped when the language changes, so cards re-read their localized text.
  const [localeVersion, setLocaleVersion] = useState(0)
  // Cards is one decision per screen; Classic is the same decisions as a list
  // you can scan. Remembered, because it is a way of working, not a detour.
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem('mode') === 'classic' ? 'classic' : 'cards' } catch { return 'cards' }
  })
  const switchMode = (next: Mode) => {
    setMode(next)
    try { localStorage.setItem('mode', next) } catch {}
  }
  // The card a notification tap (or a ?card= link) asked for.
  const [focusCardId, setFocusCardId] = useState<string | null>(() => {
    try { return new URL(window.location.href).searchParams.get('card') } catch { return null }
  })

  // `?demo` runs the feed against a scripted client: the same events the relay
  // would send, on a timer, with no backend. It is how the product is shown
  // on a stage without two phones, a sandbox and a graph database on the wifi.
  // The decision the graph opens centred on, when it is opened from a card.
  const [graphFocus, setGraphFocus] = useState<string | null>(null)
  const wsClientRef = useRef<WebSocketClient | DemoClient | null>(null)
  if (wsClientRef.current === null) wsClientRef.current = isDemo() ? new DemoClient() : new WebSocketClient()

  const addDebugLog = useCallback((message: string) => {
    setDebugLog((logs) => [...logs.slice(-199), { timestamp: new Date().toLocaleTimeString(), message }])
  }, [])

  const relayHttpUrl = relayUrl.replace(/^ws/, 'http')

  useEffect(() => {
    const cards = Object.values(state.cardsById || {})
    const pending = cards.filter((c) => c.status === 'pending' && c.recipientUserID === userId)
    setTabBadge(pending.length)
    return () => setTabBadge(0)
  }, [state, userId])

  useEffect(() => {
    const wsClient = wsClientRef.current!
    let ignore = false
    wsClient.onStateChange = (newState) => { if (!ignore) setState(newState) }
    wsClient.onCardCreated = (card) => {
      if (ignore) return
      addDebugLog(`Card created: ${card.id}`)
      if (card.recipientUserID === userId && card.status === 'pending') {
        notifyNewDecision(card.title || 'A decision is waiting', card.senderUserID || 'a teammate')
      }
    }
    wsClient.onCardUpdated = (card) => { if (!ignore) addDebugLog(`Card updated: ${card.id}`) }
    wsClient.onCardDeleted = (cardId) => { if (!ignore) addDebugLog(`Card deleted: ${cardId}`) }
    wsClient.onPresence = (who, status) => { if (!ignore) addDebugLog(`Presence: ${who} → ${status}`) }
    wsClient.onError = (message) => { if (!ignore) { setError(message); addDebugLog(`Error: ${message}`) } }
    // The relay will not have this socket, and will not have the next one
    // either. Retrying is not the answer to any of these — where the answer is
    // "you belong somewhere else now", go there; otherwise say so and stop.
    wsClient.onRefused = (message, code) => {
      if (ignore) return
      setError(message)
      addDebugLog(`Refused: ${code || 'no code'} — ${message}`)
      if (code === 'not-a-member' || code === 'sign-in-required') onLeft()
    }
    wsClient.onToolCallResult = (toolCallId) => { if (!ignore) addDebugLog(`Tool result: ${toolCallId}`) }
    wsClient.onConnectionChange = (connected) => {
      if (ignore) return
      setIsConnected(connected)
      if (connected) setError(null)
      addDebugLog(connected ? `Connected to ${relayUrl}` : 'Disconnected — will retry')
    }
    wsClient.connect(relayUrl, userId, orgId, sessionToken).catch((err) => {
      if (ignore) return
      const message = err instanceof Error ? err.message : String(err)
      setError(`Failed to connect: ${message}`)
    })
    return () => { ignore = true; wsClient.disconnect() }
  }, [relayUrl, userId, orgId, sessionToken, addDebugLog, onLeft])

  // A notification tapped while a tab is open: the service worker tells us
  // which card, rather than opening a second tab.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'open-card' && event.data.cardId) { setPanel(null); setFocusCardId(event.data.cardId) }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  // What language this browser reads, so every notification arrives in it.
  useEffect(() => { syncLocale(relayHttpUrl, sessionToken) }, [relayHttpUrl, sessionToken])

  // The org's businesses, for turning a slug on a card into its name. Nobody
  // picks one; the AI files every card in the background.
  const loadBusinesses = useCallback(async () => {
    if (isDemo()) { setBusinesses(DEMO_BUSINESSES); return }
    try {
      const res = await fetch(`${relayHttpUrl}/businesses?orgId=${encodeURIComponent(orgId)}`, {
        headers: { 'x-session-token': sessionToken },
      })
      if (res.ok) setBusinesses((await res.json()).businesses || [])
    } catch { /* a label is a convenience */ }
  }, [relayHttpUrl, orgId, sessionToken])
  useEffect(() => { loadBusinesses() }, [loadBusinesses])
  useEffect(() => {
    const known = new Set(businesses.map((b) => b.slug))
    if (Object.values(state.cardsById || {}).some((c) => c.business && !known.has(c.business))) loadBusinesses()
  }, [state, businesses, loadBusinesses])

  // Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPanel(null); setScreen(null) }
      else if (e.key === 'n' && !panel && !screen && !(e.target as HTMLElement)?.matches('input, textarea')) setPanel('compose')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, screen])

  /// "Ask anything" on a card: the same thing telling your AI does, with the
  /// card it is about named, so the router has the context a bare sentence
  /// would be missing.
  const handleAsk = useCallback(async (text: string, card: any) => {
    if (isDemo()) { wsClientRef.current!.sendCardCreated(demoRoute(text, card, userId)); return }
    try {
      const res = await fetch(`${relayHttpUrl}/ai/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': sessionToken },
        body: JSON.stringify({
          text: `About "${card.title}": ${text}`,
          orgId,
          sender: { id: userId, role: 'member' },
          // The Worker writes its own words on a card — the title, the routing
          // line — and without this it writes them in English.
          readerLanguage: getLocale(),
        }),
      })
      const routed = await res.json()
      if (!res.ok) { setError(routed.message || t('Your AI could not route that.')); return }
      wsClientRef.current!.sendCardCreated({
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: routed.cardType || 'notification',
        status: 'pending',
        recipientUserID: routed.recipientUserID,
        title: routed.title || 'Decision needed',
        summary: routed.summary || '',
        context: routed.context || '',
        priority: routed.priority || 'medium',
        routingReason: routed.routingReason || '',
        agentRoute: routed.agentRoute || '',
        createdAt: new Date().toISOString(),
        sourceInstruction: text,
        ...(routed.business ? { business: routed.business } : {}),
        ...(routed.recommendation ? { recommendation: routed.recommendation } : {}),
      })
      addDebugLog(`Asked about ${card.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [relayHttpUrl, orgId, userId, sessionToken, addDebugLog])

  const handleDecision = useCallback((cardId: string, action: string, options?: any) => {
    wsClientRef.current!.sendDecision(cardId, action, options)
    addDebugLog(`Sent decision: ${cardId} → ${action}`)
  }, [addDebugLog])
  const handleRollback = useCallback((cardId: string) => {
    wsClientRef.current!.sendRollback(cardId)
    addDebugLog(`Rolled back: ${cardId}`)
  }, [addDebugLog])
  const handleNudge = useCallback((cardId: string) => {
    wsClientRef.current!.sendNudge(cardId)
    addDebugLog(`Nudged: ${cardId}`)
  }, [addDebugLog])

  const cards = Object.values(state.cardsById || {})
  const byUrgency = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>
  // What is waiting on me, most urgent first, then oldest first: the order
  // the AI would read them to you.
  const pendingCards = cards
    .filter((c) => c.status === 'pending' && c.recipientUserID === userId)
    .sort((a, b) => (byUrgency[a.priority] ?? 2) - (byUrgency[b.priority] ?? 2) || a.createdAt.localeCompare(b.createdAt))
  const decidedCards = cards
    .filter((c) => c.recipientUserID === userId && (c.status !== 'pending' || c.decision))
    .sort((a, b) => (b.decision?.decidedAt || b.createdAt).localeCompare(a.decision?.decidedAt || a.createdAt))
  const sentCards = cards
    .filter((c) => c.senderUserID === userId && c.recipientUserID !== userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const nameOf = (slug?: string) => businesses.find((b) => b.slug === slug)?.name
  // What my AI is doing with a decision I just made: pushing, opening the
  // PR, done. Shown for a minute after the decision, then it is history.
  const executing = cards.filter((c) =>
    c.decision?.action === 'approve' && c.decision.actorUserID === userId && c.evidence?.dryRun &&
    (c.evidence.execution || c.evidence.status === 'running') &&
    Date.now() - Date.parse(c.decision.decidedAt) < 60000 && Date.now() - Date.parse(c.evidence.finishedAt || c.decision.decidedAt) < 45000)

  return (
    // `screen-open` is what lets the rail stay on a laptop while a screen is
    // open: on a phone a screen owns the viewport and the tab bar goes away,
    // on a laptop navigation is a place on the page and disappearing would be
    // the app losing its own chrome.
    <div className={`shell${screen ? ' screen-open' : ''}`}>
      {mode === 'cards' ? (
        <Feed
          key={localeVersion}
          cards={pendingCards}
          userId={userId}
          businesses={businesses}
          focusCardId={focusCardId}
          onDecide={handleDecision}
          onAsk={handleAsk}
          onOpenGraph={(id) => { setGraphFocus(id); setScreen('graph') }}
        />
      ) : (
        <ClassicList
          key={localeVersion}
          pending={pendingCards}
          sent={sentCards}
          decided={decidedCards}
          businesses={businesses}
          onOpen={(id) => { setFocusCardId(id); switchMode('cards') }}
          onNudge={handleNudge}
        />
      )}

      <FleetAside
        state={state}
        userId={userId}
        onOpenAgents={() => setScreen('agents')}
        onOpenGraph={() => { setGraphFocus(null); setScreen('graph') }}
        onOpenCard={(id) => { setScreen(null); setFocusCardId(id); switchMode('cards') }}
      />

      <header className="topbar">
        <div className="mode-switch" role="tablist" aria-label={t('View')}>
          <button
            role="tab"
            aria-selected={mode === 'cards'}
            className={mode === 'cards' ? 'on' : ''}
            onClick={() => switchMode('cards')}
          >
            {t('Cards')}{pendingCards.length > 0 && <span className="mode-count">{pendingCards.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'classic'}
            className={mode === 'classic' ? 'on' : ''}
            onClick={() => switchMode('classic')}
          >
            {t('Classic')}
          </button>
        </div>
        <div className="topbar-right">
          <button className="fleet-button" onClick={() => setScreen('agents')} aria-label={t('Your team\'s AIs')} title={t('Your team\'s AIs')}>
            <Icon name="box" size={18} />
            {(() => { const n = Object.values(state.context || {}).reduce((k, c: any) => k + (c?.agent?.working?.length || 0), 0); return n > 0 ? <span className="fleet-count">{n}</span> : null })()}
          </button>
          <span className={`dot ${isConnected ? 'on' : 'off'}`} title={isConnected ? t('Connected') : t('Reconnecting…')} />
          <NotificationsButton httpBase={relayHttpUrl} sessionToken={sessionToken} />
          <button className="avatar-button" onClick={() => setScreen('profile')} aria-label={t('You')}>
            {(userId.replace(/^(u:|email:)/, '')[0] || '?').toUpperCase()}
          </button>
        </div>
      </header>

      <div className="toasts">
        {error && <div className="toast error" onClick={() => setError(null)}>{error}</div>}
        {notice && <div className="toast sent" onClick={() => setNotice(null)}><span className="ai-spark" aria-hidden="true">✦</span> {notice}</div>}
        {executing.map((c) => {
          const ev = c.evidence!
          const last = (ev.timeline || []).filter((s) => s.status !== 'done').slice(-1)[0] || (ev.timeline || []).slice(-1)[0]
          return (
            <div className={`toast exec ${ev.execution?.prUrl ? 'done' : ''}`} key={c.id}>
              <span className="ai-spark" aria-hidden="true">✦</span>
              <span className="toast-main">
                <strong>{t('Approved')} · {c.title}</strong>
                <span>{ev.execution?.prUrl ? t('Pull request #{n} is open', { n: ev.execution.number ?? '' }) : last?.label || t('Working')}</span>
              </span>
              {ev.execution?.prUrl && <a href={ev.execution.prUrl} target="_blank" rel="noopener noreferrer">↗</a>}
            </div>
          )
        })}
      </div>

      {panel === null && (
        <nav className="tabbar" aria-label={t('Main')}>
          <button
            className={mode === 'cards' ? 'tab on' : 'tab'}
            onClick={() => switchMode('cards')}
            data-tab="feed"
            aria-label={t('Feed')}
          ><Icon name="home" /></button>
          <button className="tab" data-tab="history" onClick={() => setScreen('history')} aria-label={t('History')}><Icon name="history" /></button>
          <button className="tab compose" data-tab="compose" onClick={() => setPanel('compose')} aria-label={t('Tell your AI')} aria-keyshortcuts="n">
            <span className="fab-face"><Icon name="plus" /></span>
          </button>
          <button className="tab" data-tab="graph" onClick={() => { setGraphFocus(null); setScreen('graph') }} aria-label={t('Decision graph')}><Icon name="graph" /></button>
          <button className="tab" data-tab="you" onClick={() => setScreen('profile')} aria-label={t('You')}><Icon name="you" /></button>
        </nav>
      )}

      {panel && <div className="scrim" onClick={() => setPanel(null)} />}

      {panel === 'compose' && (
        <div className="sheet sheet-bottom compose-sheet" role="dialog" aria-label={t('Tell your AI')}>
          <div className="sheet-title">{t('Tell your AI')}<button className="close" onClick={() => setPanel(null)} aria-label={t('Close')}>×</button></div>
          <p className="sheet-hint">{t('compose.hint')}</p>
          <CreateDecision
            relayHttpUrl={relayHttpUrl}
            orgId={orgId}
            userId={userId}
            sessionToken={sessionToken}
            autoFocus
            route={isDemo() ? (text) => demoRouteText(text, userId) : undefined}
            onSendCard={(card) => wsClientRef.current!.sendCardCreated(card)}
            onSent={(card) => setNotice(t("Sent to {name}'s AI. They will see it as a card; the answer comes back here.", { name: properName(card.recipientUserID) }))}
            onLog={addDebugLog}
            onDone={() => setPanel(null)}
          />
        </div>
      )}

      {panel === 'sent' && (
        <aside className="sheet sheet-side" role="dialog" aria-label={t('Sent by you')}>
          <div className="sheet-title">{t('Sent by you')} <button className="close" data-close="1" onClick={() => setPanel(null)} aria-label={t('Close')}>×</button></div>
          {sentCards.length === 0 && <p className="sheet-empty">{t('Nothing sent yet. Tell your AI something.')}</p>}
          {sentCards.map((card) => (
            <div key={card.id} className="sent-card">
              <div className="sent-card-head">
                <strong>{card.title}</strong>
                <span className={`sent-status ${card.status === 'pending' ? 'waiting' : 'done'}`}>
                  {card.status === 'pending'
                    ? `Waiting on ${card.recipientUserID.replace(/^(u:|email:)/, '').split('@')[0]}`
                    : (card.decision?.action || 'decided')}
                </span>
              </div>
              {card.business && <span className="business-tag">{nameOf(card.business) || card.business}</span>}
              <p className="sent-summary">{card.summary}</p>
              {card.decision?.replyText && <p className="sent-reply">“{card.decision.replyText}”</p>}
              {card.status === 'pending' && <button className="nudge-button" onClick={() => handleNudge(card.id)}>{t('Nudge')}</button>}
            </div>
          ))}
        </aside>
      )}

      {panel === 'done' && (
        <aside className="sheet sheet-side" role="dialog" aria-label={t('Decided')}>
          <div className="sheet-title">{t('Decided')} <button className="close" data-close="1" onClick={() => setPanel(null)} aria-label={t('Close')}>×</button></div>
          {decidedCards.length === 0 && <p className="sheet-empty">{t('No decisions yet.')}</p>}
          {decidedCards.map((card) => (
            <DecisionCard
              key={card.id}
              card={card}
              currentUserId={userId}
              businessName={nameOf(card.business)}
              onApprove={() => {}} onDecline={() => {}} onChoose={() => {}} onReply={() => {}}
              onAcknowledge={() => {}} onDelegate={() => {}}
              onRollback={() => handleRollback(card.id)}
              isPending={false}
            />
          ))}
        </aside>
      )}

      {panel === 'record' && (
        <RecordSheet httpBase={relayHttpUrl} orgId={orgId} sessionToken={sessionToken} onClose={() => setPanel(null)} />
      )}

      {/* The design's own screens. Each takes the viewport while it is open,
          which is what makes them screens and not sheets. */}
      {screen === 'team' && (
        <Team
          httpBase={relayHttpUrl}
          orgId={orgId}
          sessionToken={sessionToken}
          // They just walked out of this workspace, so there is nothing left
          // here to show them. Asking the server where they still belong is
          // the same question a sign-in asks.
          onLeft={() => { setScreen(null); onLeft() }}
          onClose={() => setScreen(null)}
        />
      )}
      {screen === 'graph' && (
        <Graph
          state={state}
          focusCardId={graphFocus}
          onOpenCard={(id) => { setScreen(null); setFocusCardId(id); switchMode('cards') }}
          onClose={() => setScreen(null)}
        />
      )}
      {screen === 'agents' && (
        <Agents
          state={state}
          userId={userId}
          members={Array.from(new Set(cards.flatMap((c) => [c.recipientUserID, c.senderUserID]).filter(Boolean)))}
          onOpenCard={(id) => { setScreen(null); setFocusCardId(id); switchMode('cards') }}
          onClose={() => setScreen(null)}
        />
      )}
      {screen === 'tools' && (
        <Tools httpBase={relayHttpUrl} orgId={orgId} sessionToken={sessionToken} onClose={() => setScreen(null)} />
      )}
      {screen === 'history' && (
        <History
          decided={decidedCards}
          sent={sentCards}
          businesses={businesses}
          userId={userId}
          onOpen={(id) => { setScreen(null); setFocusCardId(id); switchMode('cards') }}
          onClose={() => setScreen(null)}
        />
      )}
      {screen === 'notifications' && (
        <NotificationSettings httpBase={relayHttpUrl} sessionToken={sessionToken} onClose={() => setScreen(null)} />
      )}
      {screen === 'plans' && (
        <Plans httpBase={relayHttpUrl} sessionToken={sessionToken} onClose={() => setScreen(null)} />
      )}
      {screen === 'profile' && (
        <Profile
          httpBase={relayHttpUrl}
          orgId={orgId}
          userId={userId}
          sessionToken={sessionToken}
          businesses={businesses}
          pendingCount={pendingCards.length}
          decidedCount={decidedCards.length}
          onOpen={(where) => {
            if (where === 'record') { setScreen(null); setPanel('record') }
            else setScreen(where)
          }}
          onLocaleChange={() => setLocaleVersion((v) => v + 1)}
          onSwitchOrg={(next) => { setScreen(null); onSwitchOrg(next) }}
          onLogout={onLogout}
          onClose={() => setScreen(null)}
        />
      )}

      {showDebug && (
        <div className="debug-log">
          <h3>{t('Event log')}</h3>
          <div className="log-entries">
            {debugLog.map((entry, i) => (
              <div key={i} className="log-entry"><span className="log-time">{entry.timestamp}</span><span className="log-message">{entry.message}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
