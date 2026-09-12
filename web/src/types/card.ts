export type CardType = 'approval' | 'delegation' | 'notification' | 'task' | 'revision'
export type CardStatus = 'pending' | 'approved' | 'rejected' | 'revised' | 'delegated' | 'completed'
export type CardPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Decision {
  action: string
  optionId?: string
  note?: string
  replyText?: string
  actorUserID: string
  decidedAt: string
}

export interface DecisionCard {
  id: string
  recipientUserID: string
  senderUserID: string
  type: CardType
  title: string
  summary: string
  context: string
  status: CardStatus
  priority: CardPriority
  createdAt: string
  githubIssueNumber?: number
  githubIssueURL?: string
  githubRepository?: string
  agentRoute?: string
  routingReason?: string
  sourceInstruction?: string
  labels?: string[]
  revisionNote?: string
  sourceApp?: string
  sourceDetail?: string
  originalBody?: string
  originalLanguage?: string
  videoURL?: string
  decision?: Decision
  // The card in other languages, keyed by locale ("ja"), written by the relay
  // for the recipient. The top-level fields stay in the sender's language.
  localized?: Record<string, { title: string; summary?: string; context?: string }>
  // Which of the org's businesses this decision belongs to, by slug.
  business?: string
  // What the AI would advise, and why. A starting point the person can
  // ignore, never a decision — the card still waits for them.
  recommendation?: { action: 'approve' | 'decline' | 'revise'; reason?: string }
  // Who asked, stamped by the relay from the org's own membership table so a
  // client cannot name someone else.
  requestedBy?: { login?: string; name?: string; role?: string; avatarUrl?: string; quote?: string; sourceUrl?: string }
  // What the recipient's AI found out before they looked: a dry-run in a
  // sandbox, the decision graph's precedent and collisions, and, after an
  // approval, what was executed. Written by the agent runner, only ever for
  // the card's own recipient.
  evidence?: Evidence
}

export type EvidenceLayer = 'daytona' | 'neo4j' | 'github' | 'ai'

export interface EvidenceStep {
  at: string
  label: string
  detail?: string
  status: 'running' | 'done' | 'failed'
  layer?: EvidenceLayer
}

export interface DryRun {
  sandboxId?: string
  deskId?: string
  forked?: boolean
  previewUrl?: string
  branch?: string
  bootMs?: number
  filesChanged?: number
  insertions?: number
  deletions?: number
  tests?: { passed: number; failed: number; raw?: string }
  status: 'passed' | 'failed' | 'error'
  editSummary?: string
  files?: string[]
  durationMs?: number
  error?: string
}

export interface GraphContext {
  summary?: string
  related?: Array<{ cardId: string; title: string; action?: string; decidedAt?: string; by?: string }>
  conflicts?: Array<{ cardId: string; title: string; recipient?: string }>
  business?: string
  repo?: string
}

export interface Execution {
  prUrl?: string
  number?: number
  branch?: string
  pushedAt?: string
  error?: string
}

export interface Evidence {
  status?: 'running' | 'done' | 'failed'
  startedAt?: string
  finishedAt?: string
  timeline?: EvidenceStep[]
  dryRun?: DryRun
  graph?: GraphContext
  execution?: Execution
}

export interface Business {
  slug: string
  name: string
}

export interface AppState {
  cardsById: Record<string, DecisionCard>
  // Each member's context, keyed by user id. An agent runner writes its own
  // status under `agent`: which machine it lives on and what it is doing.
  context?: Record<string, { agent?: AgentStatus; [key: string]: any }>
  [key: string]: any
}

export interface AgentStatus {
  user: string
  desk: { id: string; name?: string; state?: string } | null
  working: Array<{ cardId: string; sandboxId: string; branch?: string; step?: string }>
  done: number
  at: string
}

export interface User {
  id: string
  name: string
  avatar: string
}
