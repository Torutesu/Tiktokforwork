// A scripted stand-in for the relay. Same callbacks, same sends, no socket:
// the events arrive on a timer and look exactly like the ones the relay and
// the agent runner produce. `?demo` in the URL turns it on.
//
// The script is one afternoon in a small team: a request arrives for the
// approver, their AI checks it in a sandbox and in the graph, the approver
// swipes, a PR opens, and the next request already knows about the first.

import type { AppState, DecisionCard, Business, Evidence } from '../types/card'
import { buildGraph } from '../utils/graph'

// The graph as Neo4j would return it for this org, from the cards.
function mirrorGraph(state: AppState) {
  const g = buildGraph({ ...state, context: undefined })
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.label, props: n.props, action: n.action, createdAt: n.createdAt, cardId: n.cardId })),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
  }
}

export const DEMO_USER = 'tanaka'
export const DEMO_ORG = 'demo/booking-site'
export const DEMO_REPO = 'your-org/booking-site'
export const DEMO_BUSINESSES: Business[] = [
  { slug: 'hotel-sakura', name: 'Hotel Sakura' },
  { slug: 'cafe-honmachi', name: 'Cafe Honmachi' },
]

export function isDemo(): boolean {
  try { return new URL(window.location.href).searchParams.has('demo') } catch { return false }
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const DAY = 86400000

function precedent(): DecisionCard[] {
  return [
    {
      id: 'card-demo-p1', type: 'approval', status: 'approved', priority: 'medium',
      recipientUserID: DEMO_USER, senderUserID: 'toru', business: 'hotel-sakura',
      title: 'Add a cancellation fee after 48 hours', summary: 'Booking terms for Hotel Sakura.',
      context: '', createdAt: iso(13 * DAY), githubRepository: DEMO_REPO,
      decision: { action: 'approve', actorUserID: DEMO_USER, decidedAt: iso(12 * DAY) },
    },
    {
      id: 'card-demo-p2', type: 'approval', status: 'approved', priority: 'low',
      recipientUserID: DEMO_USER, senderUserID: 'toru', business: 'hotel-sakura',
      title: 'Show room photos in the booking flow', summary: '',
      context: '', createdAt: iso(31 * DAY), githubRepository: DEMO_REPO,
      decision: { action: 'approve', actorUserID: DEMO_USER, decidedAt: iso(30 * DAY) },
    },
    {
      id: 'card-demo-p3', type: 'approval', status: 'rejected', priority: 'medium',
      recipientUserID: DEMO_USER, senderUserID: 'toru', business: 'hotel-sakura',
      title: 'Require a deposit for group bookings', summary: '',
      context: '', createdAt: iso(45 * DAY), githubRepository: DEMO_REPO,
      decision: { action: 'decline', actorUserID: DEMO_USER, decidedAt: iso(44 * DAY), note: 'Not until the season is over.' },
    },
    {
      id: 'card-demo-yui', type: 'task', status: 'pending', priority: 'medium',
      recipientUserID: 'yui', senderUserID: 'toru', business: 'hotel-sakura',
      title: 'Redesign the checkout page', summary: 'New layout for the payment step.',
      context: '', createdAt: iso(2 * DAY), githubRepository: DEMO_REPO,
    },
  ]
}

const FIRST: DecisionCard = {
  id: 'card-demo-1', type: 'approval', status: 'pending', priority: 'high',
  recipientUserID: DEMO_USER, senderUserID: 'toru', business: 'hotel-sakura',
  title: 'Show tax-inclusive prices on the booking site',
  summary: 'Every price on Hotel Sakura\'s booking pages should include the 10% consumption tax, with the label updated to say so.',
  context: 'Repository: your-org/booking-site · Deadline: before the autumn campaign',
  createdAt: iso(0), githubRepository: DEMO_REPO,
  sourceInstruction: 'Show tax-inclusive prices on the hotel booking site before the autumn campaign',
  routingReason: 'Tanaka approves changes to Hotel Sakura',
  agentRoute: "Toru's AI → Tanaka's AI",
  requestedBy: { login: 'toru', name: 'Toru', role: 'owner', quote: 'Show tax-inclusive prices on the hotel booking site before the autumn campaign' },
}

const SECOND: DecisionCard = {
  id: 'card-demo-2', type: 'approval', status: 'pending', priority: 'medium',
  recipientUserID: DEMO_USER, senderUserID: 'toru', business: 'hotel-sakura',
  title: 'Accept Suica at checkout',
  summary: 'Add Suica as a payment option next to cards on the booking site.',
  context: 'Repository: your-org/booking-site',
  createdAt: iso(0), githubRepository: DEMO_REPO,
  sourceInstruction: 'Let guests pay with Suica at checkout',
  routingReason: 'Tanaka approves changes to Hotel Sakura',
  agentRoute: "Toru's AI → Tanaka's AI",
  requestedBy: { login: 'toru', name: 'Toru', role: 'owner', quote: 'Let guests pay with Suica at checkout' },
}

type Step = { at: number; run: () => void }

export class DemoClient {
  private state: AppState = { cardsById: {} }
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private approvedFirst = false

  onStateChange?: (state: AppState) => void
  onCardCreated?: (card: DecisionCard) => void
  onCardUpdated?: (card: DecisionCard) => void
  onCardDeleted?: (cardId: string) => void
  onPresence?: (userId: string, status: string) => void
  onError?: (message: string) => void
  onRefused?: (message: string, code?: string) => void
  onToolCallResult?: (toolCallId: string, result: any) => void
  onConnectionChange?: (isConnected: boolean) => void

  private agent(user: string, patch: Partial<import('../types/card').AgentStatus>) {
    const context = { ...(this.state.context || {}) }
    const prev = context[user]?.agent
    context[user] = { ...(context[user] || {}), agent: { user, desk: { id: `sb-desk-${user}`, name: `desk-${user}`, state: 'started' }, working: [], done: 0, ...(prev || {}), ...patch, at: new Date().toISOString() } }
    // What the runner publishes from Neo4j after every change: the org's
    // neighbourhood. In the demo it is derived from the same cards Neo4j
    // would have been seeded with, and stamped as the live graph.
    if (user === DEMO_USER) context[user].graph = { ...mirrorGraph(this.state), source: 'neo4j', at: new Date().toISOString() }
    this.state = { ...this.state, context }
    this.emit()
  }

  async connect(): Promise<void> {
    for (const c of precedent()) this.state.cardsById[c.id] = c
    this.agent('toru', { done: 4 })
    this.agent(DEMO_USER, { done: 2 })
    this.agent('yui', { working: [{ cardId: 'card-demo-yui', sandboxId: 'sb-yui-1', step: 'running tests' }], done: 1 })
    this.emit()
    this.onConnectionChange?.(true)
    this.onPresence?.('toru', 'online')
    this.schedule([
      { at: 1400, run: () => this.arrive(FIRST) },
      ...this.investigate(FIRST.id, 2200, { related: 3, conflicts: 1, edits: ['src/pricing.ts', 'src/components/PriceTag.tsx'], tests: 14, files: 2, ins: 9, del: 3 }),
    ])
  }

  disconnect(): void { for (const t of this.timers) clearTimeout(t); this.timers = [] }

  private schedule(steps: Step[]) { for (const s of steps) this.timers.push(setTimeout(s.run, s.at)) }
  private emit() { this.onStateChange?.({ ...this.state, cardsById: { ...this.state.cardsById } }) }
  private card(id: string) { return this.state.cardsById[id] }
  private patch(id: string, fn: (c: DecisionCard) => DecisionCard) {
    const c = this.card(id); if (!c) return
    this.state.cardsById[id] = fn({ ...c }); this.agent(DEMO_USER, {}); this.onCardUpdated?.(this.state.cardsById[id])
  }
  private arrive(card: DecisionCard) {
    const c = { ...card, createdAt: new Date().toISOString() }
    this.state.cardsById[c.id] = c; this.agent(DEMO_USER, {}); this.onCardCreated?.(c)
  }
  private step(id: string, label: string, opts: { detail?: string; layer?: any; status?: 'running' | 'done' | 'failed'; finishPrev?: boolean } = {}) {
    this.patch(id, (c) => {
      const ev: Evidence = { status: 'running', startedAt: new Date().toISOString(), ...(c.evidence || {}) }
      const timeline = [...(ev.timeline || [])]
      if (opts.finishPrev !== false && timeline.length && timeline[timeline.length - 1].status === 'running') {
        timeline[timeline.length - 1] = { ...timeline[timeline.length - 1], status: 'done' }
      }
      timeline.push({ at: new Date().toISOString(), label, detail: opts.detail, layer: opts.layer, status: opts.status || 'running' })
      return { ...c, evidence: { ...ev, timeline } }
    })
  }
  private finish(id: string, fn: (ev: Evidence) => Evidence) {
    this.patch(id, (c) => {
      const ev = c.evidence || {}
      const timeline = (ev.timeline || []).map((s) => (s.status === 'running' ? { ...s, status: 'done' as const } : s))
      return { ...c, evidence: fn({ ...ev, timeline, status: 'done', finishedAt: new Date().toISOString() }) }
    })
  }

  /// The agent runner's work on a card, on a timer.
  private investigate(id: string, start: number, o: { related: number; conflicts: number; edits: string[]; tests: number; files: number; ins: number; del: number }): Step[] {
    const t0 = start
    const first = id === FIRST.id
    return [
      { at: t0, run: () => this.step(id, 'Asked the decision graph', { detail: 'precedent · collisions · who decided last time', layer: 'neo4j' }) },
      { at: t0 + 900, run: () => this.patch(id, (c) => ({
        ...c,
        evidence: {
          ...c.evidence,
          timeline: (c.evidence?.timeline || []).map((s, i, a) => (i === a.length - 1 ? { ...s, status: 'done' as const, detail: `${o.related} precedents · ${o.conflicts} collision` } : s)),
          graph: {
            business: 'hotel-sakura', repo: DEMO_REPO,
            summary: first
              ? 'You approved 2 of the last 3 decisions about Hotel Sakura, most recently 12 days ago. Yui has an open card touching the same repository.'
              : 'You approved a pricing change on this site just now. The checkout page Yui is redesigning is where this lands.',
            related: first
              ? [
                  { cardId: 'card-demo-p1', title: 'Add a cancellation fee after 48 hours', action: 'approve', decidedAt: iso(12 * DAY), by: DEMO_USER },
                  { cardId: 'card-demo-p2', title: 'Show room photos in the booking flow', action: 'approve', decidedAt: iso(30 * DAY), by: DEMO_USER },
                  { cardId: 'card-demo-p3', title: 'Require a deposit for group bookings', action: 'decline', decidedAt: iso(44 * DAY), by: DEMO_USER },
                ]
              : [
                  { cardId: FIRST.id, title: FIRST.title, action: 'approve', decidedAt: iso(0), by: DEMO_USER },
                  { cardId: 'card-demo-p1', title: 'Add a cancellation fee after 48 hours', action: 'approve', decidedAt: iso(12 * DAY), by: DEMO_USER },
                ],
            conflicts: [{ cardId: 'card-demo-yui', title: 'Redesign the checkout page', recipient: 'yui' }],
          },
        },
      })) },
      { at: t0 + 1300, run: () => { this.step(id, 'Forked my desk into a fresh sandbox', { layer: 'daytona' }); this.agent(DEMO_USER, { working: [{ cardId: id, sandboxId: `sb-${id.slice(-6)}`, step: 'forking' }] }) } },
      { at: t0 + 1550, run: () => this.step(id, `Checked out agent/card-${id.slice(-8)}`, { detail: 'repository and dependencies already on the desk', layer: 'daytona' }) },
      { at: t0 + 1550, run: () => this.patch(id, (c) => ({ ...c, evidence: { ...c.evidence, timeline: (c.evidence?.timeline || []).map((s) => s.label.startsWith('Forked') ? { ...s, status: 'done' as const, detail: '184 ms · checkout and node_modules already there' } : s) } })) },
      { at: t0 + 3200, run: () => this.step(id, `Applied ${o.edits.length} edits`, { detail: o.edits.join(', '), layer: 'ai' }) },
      { at: t0 + 4200, run: () => { this.step(id, 'Ran the test suite', { detail: 'npm test', layer: 'daytona' }); this.agent(DEMO_USER, { working: [{ cardId: id, sandboxId: `sb-${id.slice(-6)}`, step: 'npm test' }] }) } },
      { at: t0 + 5600, run: () => this.step(id, 'Started a preview of the change', { detail: 'served from the sandbox', layer: 'daytona' }) },
      { at: t0 + 6400, run: () => this.finish(id, (ev) => ({
        ...ev,
        timeline: (ev.timeline || []).map((s) => (s.label === 'Ran the test suite' ? { ...s, detail: `npm test · ${o.tests} passed, 0 failed` } : s)),
        dryRun: {
          sandboxId: 'sb-' + id.slice(-6), deskId: `sb-desk-${DEMO_USER}`, forked: true, branch: `agent/card-${id.slice(-8)}`, bootMs: 184,
          previewUrl: `https://3000-sb-${id.slice(-6)}.proxy.daytona.work/`,
          filesChanged: o.files, insertions: o.ins, deletions: o.del,
          tests: { passed: o.tests, failed: 0 }, status: 'passed', files: o.edits,
          editSummary: first ? 'Prices are multiplied by 1.10 at render time and labelled "tax included"; the two PriceTag tests were updated to match.' : 'Suica added to the payment method list, with a stubbed handler behind a feature flag.',
          durationMs: 6400,
        },
      })) },
    ]
  }

  /// A decision on a card. Approve on the first card executes: the sandbox
  /// pushes, a PR opens, the requester hears back, and the next request
  /// arrives already knowing about this one.
  sendDecision(cardId: string, action: string, options?: { replyText?: string; note?: string }): void {
    const c = this.card(cardId); if (!c) return
    const status = action === 'approve' ? 'approved' : action === 'decline' ? 'rejected' : action === 'reply' ? 'pending' : 'completed'
    this.patch(cardId, (x) => ({ ...x, status: status as any, decision: { action, actorUserID: DEMO_USER, decidedAt: new Date().toISOString(), replyText: options?.replyText, note: options?.note } }))
    this.onToolCallResult?.(`tc-${cardId}`, { cardId, action })
    if (action !== 'approve' || !c.evidence?.dryRun) return
    const n = cardId === FIRST.id ? 12 : 13
    this.schedule([
      { at: 300, run: () => this.step(cardId, 'Pushed the tested branch', { detail: c.evidence?.dryRun?.branch, layer: 'daytona' }) },
      { at: 1400, run: () => this.step(cardId, `Opened pull request #${n}`, { layer: 'github' }) },
      { at: 2000, run: () => { this.finish(cardId, (ev) => ({ ...ev, execution: { prUrl: `https://github.com/${DEMO_REPO}/pull/${n}`, number: n, branch: ev.dryRun?.branch, pushedAt: new Date().toISOString() } })); this.agent(DEMO_USER, { working: [], done: (this.state.context?.[DEMO_USER]?.agent?.done || 0) + 1 }) } },
      { at: 2300, run: () => this.arrive({
        id: `card-demo-result-${n}`, type: 'notification', status: 'pending', priority: 'low',
        recipientUserID: 'toru', senderUserID: DEMO_USER, business: 'hotel-sakura',
        title: `Approved: ${c.title}`, summary: `Tanaka approved it and PR #${n} is open.`,
        context: `https://github.com/${DEMO_REPO}/pull/${n} · tests ${c.evidence?.dryRun?.tests?.passed ?? 0} ✅`,
        createdAt: new Date().toISOString(), routingReason: 'Result of an executed decision', agentRoute: "Tanaka's AI → Toru's AI",
      }) },
    ])
    if (cardId === FIRST.id && !this.approvedFirst) {
      this.approvedFirst = true
      this.schedule([
        { at: 4200, run: () => this.arrive(SECOND) },
        ...this.investigate(SECOND.id, 5000, { related: 2, conflicts: 1, edits: ['src/payments/methods.ts'], tests: 15, files: 1, ins: 6, del: 0 }),
      ])
    }
  }

  sendRollback(cardId: string): void {
    this.patch(cardId, (c) => ({ ...c, status: 'pending', decision: undefined, evidence: c.evidence ? { ...c.evidence, execution: undefined } : undefined }))
  }
  sendNudge(_cardId: string): void {}
  sendSetBusiness(cardId: string, business: string | null): void { this.patch(cardId, (c) => ({ ...c, business: business || undefined })) }
  sendCardCreated(card: any): void { this.arrive({ ...card, senderUserID: DEMO_USER }) }
  getState(): AppState { return this.state }
  getCard(cardId: string): DecisionCard | null { return this.card(cardId) || null }
}

/// The router, for the "ask anything" bar in demo mode.
export function demoRoute(text: string, about: DecisionCard, userId: string): DecisionCard {
  return {
    id: `card-demo-ask-${Date.now()}`, type: 'notification', status: 'pending', priority: 'medium',
    recipientUserID: 'toru', senderUserID: userId, business: about.business,
    title: `About "${about.title}"`, summary: text, context: '',
    createdAt: new Date().toISOString(), sourceInstruction: text, agentRoute: "Tanaka's AI → Toru's AI",
  }
}
