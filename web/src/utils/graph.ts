// The organization's decision graph, as the screen draws it.
//
// The graph lives in Neo4j. The agent runner publishes the neighbourhood it
// works with as its context (`state.context[user].graph`), and that is what
// the screen prefers. When no agent is publishing — a demo, a team without
// a runner yet — the same graph is rebuilt from the cards on this client,
// which is also what seeds Neo4j in the first place, so the two agree.

import type { AppState, DecisionCard } from '../types/card'

export type NodeKind = 'Person' | 'Agent' | 'Business' | 'Decision' | 'Repo' | 'PR' | 'Desk' | 'Sandbox'

export interface GNode {
  id: string
  kind: NodeKind
  label: string
  props: Record<string, string | number | boolean | null | undefined>
  // Set for decisions: how it ended, for the ring colour.
  action?: string
  createdAt?: string
  cardId?: string
}
export interface GEdge { id: string; from: string; to: string; type: string }
export interface Graph { nodes: GNode[]; edges: GEdge[]; source: 'neo4j' | 'mirror'; at?: string }

export const KIND_COLOR: Record<NodeKind, string> = {
  Person: '#f5c542',
  Agent: '#c990c0',
  Business: '#57c7e3',
  Decision: '#f79767',
  Repo: '#8dcc93',
  PR: '#ecb5c9',
  Desk: '#4c8eda',
  Sandbox: '#0ea5e9',
}

function person(name?: string): string {
  const raw = (name || '').replace(/^(u:|email:)/, '').split('@')[0]
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ''
}

export function buildGraph(state: AppState): Graph {
  // 1. Prefer what an agent published from Neo4j.
  const published = Object.values(state.context || {})
    .map((c: any) => c?.graph)
    .filter((g) => g && Array.isArray(g.nodes) && g.nodes.length)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0]
  if (published) {
    const nodes: GNode[] = published.nodes.map((n: any) => ({
      id: String(n.id), kind: (n.kind || n.label || 'Decision') as NodeKind, label: String(n.name || n.title || n.id),
      props: n.props || {}, action: n.action, createdAt: n.createdAt, cardId: n.cardId,
    }))
    const edges: GEdge[] = published.edges.map((e: any, i: number) => ({ id: `e${i}`, from: String(e.from), to: String(e.to), type: String(e.type) }))
    return withAgents(state, { nodes, edges, source: 'neo4j', at: published.at })
  }
  // 2. Otherwise mirror the cards.
  const nodes = new Map<string, GNode>()
  const edges: GEdge[] = []
  const add = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id }
  const link = (from: string, to: string, type: string) => {
    const id = `${from}|${type}|${to}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, type })
  }
  const P = (login?: string) => (login ? add({ id: `person:${login}`, kind: 'Person', label: person(login), props: { login } }) : '')

  for (const c of Object.values(state.cardsById || {}) as DecisionCard[]) {
    const d = add({
      id: `decision:${c.id}`, kind: 'Decision', label: c.title, cardId: c.id,
      action: c.decision?.action, createdAt: c.createdAt,
      props: { type: c.type, status: c.status, priority: c.priority, createdAt: c.createdAt, decidedAt: c.decision?.decidedAt, note: c.decision?.note },
    })
    if (c.senderUserID) link(P(c.senderUserID), d, 'REQUESTED')
    if (c.recipientUserID) link(d, P(c.recipientUserID), 'ASSIGNED_TO')
    if (c.decision?.action) link(d, P(c.decision.actorUserID || c.recipientUserID), 'DECIDED_BY')
    if (c.business) link(d, add({ id: `business:${c.business}`, kind: 'Business', label: c.business.replace(/-/g, ' '), props: { slug: c.business } }), 'ABOUT')
    const repo = c.githubRepository || c.evidence?.graph?.repo
    if (repo) link(d, add({ id: `repo:${repo}`, kind: 'Repo', label: repo.split('/').pop() || repo, props: { fullName: repo } }), 'TOUCHES')
    const pr = c.evidence?.execution?.prUrl
    if (pr) link(d, add({ id: `pr:${pr}`, kind: 'PR', label: `PR #${c.evidence?.execution?.number ?? ''}`, props: { url: pr } }), 'PRODUCED')
    else if (c.githubIssueURL) link(d, add({ id: `issue:${c.githubIssueURL}`, kind: 'PR', label: `#${c.githubIssueNumber ?? ''}`, props: { url: c.githubIssueURL } }), 'SYNCED_TO')
    const sb = c.evidence?.dryRun?.sandboxId
    if (sb) {
      const s = add({ id: `sandbox:${sb}`, kind: 'Sandbox', label: sb, props: { branch: c.evidence?.dryRun?.branch, tests: c.evidence?.dryRun?.tests?.passed, status: c.evidence?.dryRun?.status } })
      link(s, d, 'CHECKED')
      if (c.evidence?.dryRun?.deskId) link(s, add({ id: `desk:${c.evidence.dryRun.deskId}`, kind: 'Desk', label: c.evidence.dryRun.deskId, props: {} }), 'FORKED_FROM')
    }
  }
  return withAgents(state, { nodes: [...nodes.values()], edges, source: 'mirror' })
}

/// Every teammate's AI and its machines, from the statuses agents publish.
function withAgents(state: AppState, g: Graph): Graph {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const edges = [...g.edges]
  const link = (from: string, to: string, type: string) => {
    const id = `${from}|${type}|${to}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, type })
  }
  for (const [user, ctx] of Object.entries(state.context || {})) {
    const a = (ctx as any)?.agent
    if (!a) continue
    const pid = `person:${user}`
    if (!nodes.has(pid)) nodes.set(pid, { id: pid, kind: 'Person', label: person(user), props: { login: user } })
    const aid = `agent:${user}`
    nodes.set(aid, { id: aid, kind: 'Agent', label: `${person(user)}'s AI`, props: { working: a.working?.length || 0, done: a.done || 0, at: a.at } })
    link(pid, aid, 'OWNS')
    if (a.desk) {
      const did = `desk:${a.desk.id}`
      nodes.set(did, { id: did, kind: 'Desk', label: a.desk.name || a.desk.id, props: { state: a.desk.state, id: a.desk.id } })
      link(aid, did, 'RUNS_ON')
      for (const w of a.working || []) {
        const sid = `sandbox:${w.sandboxId}`
        if (!nodes.has(sid)) nodes.set(sid, { id: sid, kind: 'Sandbox', label: w.sandboxId, props: { step: w.step, branch: w.branch } })
        link(sid, did, 'FORKED_FROM')
        if (nodes.has(`decision:${w.cardId}`)) link(sid, `decision:${w.cardId}`, 'CHECKING')
      }
    }
  }
  return { ...g, nodes: [...nodes.values()], edges }
}
