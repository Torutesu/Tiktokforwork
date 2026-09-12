import React, { useEffect, useMemo, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force'
import type { AppState } from '../types/card'
import { buildGraph, KIND_COLOR, type GNode, type GEdge, type NodeKind } from '../utils/graph'
import { useT } from '../utils/i18n'
import './Graph.css'

interface Props {
  state: AppState
  focusCardId?: string | null
  onOpenCard: (id: string) => void
  onClose: () => void
}

type SimNode = GNode & { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }
type SimEdge = { id: string; type: string; source: SimNode; target: SimNode }

const R: Record<NodeKind, number> = { Decision: 21, Person: 19, Agent: 17, Business: 19, Repo: 16, PR: 14, Desk: 15, Sandbox: 12 }
const ACTIVE_EDGES = new Set(['CHECKING', 'CHECKED', 'FORKED_FROM', 'RUNS_ON'])
const KINDS: NodeKind[] = ['Person', 'Agent', 'Decision', 'Business', 'Repo', 'PR', 'Desk', 'Sandbox']

function short(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

/// The organization as Neo4j holds it: people, their AIs and machines,
/// businesses, decisions, repositories and pull requests, with the
/// relationships between them. Drag, zoom, tap a node to see its
/// neighbourhood; decisions being checked right now pulse.
export const Graph: React.FC<Props> = ({ state, focusCardId, onOpenCard, onClose }) => {
  const t = useT()
  const graph = useMemo(() => buildGraph(state), [state])
  const svgRef = useRef<SVGSVGElement>(null)
  const simNodes = useRef<Map<string, SimNode>>(new Map())
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<string | null>(focusCardId ? `decision:${focusCardId}` : null)
  const [filter, setFilter] = useState<NodeKind | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const size = useRef({ w: 800, h: 600 })
  const sim = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)
  const drag = useRef<{ node?: SimNode; pan?: { x: number; y: number; vx: number; vy: number }; moved: boolean } | null>(null)

  // Keep positions across renders: a node that already sits somewhere stays
  // there when a new one arrives; only the newcomer settles in.
  const nodes: SimNode[] = useMemo(() => {
    const { w, h } = size.current
    return graph.nodes.map((n) => {
      const prev = simNodes.current.get(n.id)
      const sn: SimNode = prev ? Object.assign(prev, n) : { ...n, x: w / 2 + (Math.random() - 0.5) * 80, y: h / 2 + (Math.random() - 0.5) * 80 }
      simNodes.current.set(n.id, sn)
      return sn
    })
  }, [graph])
  const edges: SimEdge[] = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return graph.edges.map((e: GEdge) => ({ id: e.id, type: e.type, source: byId.get(e.from)!, target: byId.get(e.to)! })).filter((e) => e.source && e.target)
  }, [graph, nodes])

  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (el) size.current = { w: el.clientWidth, h: el.clientHeight }
    const { w, h } = size.current
    const s = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance((e) => (e.type === 'OWNS' || e.type === 'RUNS_ON' ? 50 : e.type === 'FORKED_FROM' ? 40 : 95)).strength(0.6))
      .force('charge', forceManyBody().strength(-420))
      .force('center', forceCenter(w / 2, h / 2))
      .force('x', forceX(w / 2).strength(0.03))
      .force('y', forceY(h / 2).strength(0.03))
      .force('collide', forceCollide<SimNode>().radius((d) => R[d.kind] + (d.kind === 'Decision' ? 34 : 22)))
      .alpha(sim.current ? 0.5 : 1)
      .on('tick', () => setTick((k) => k + 1))
      .on('end', () => { if (!focusCardId) fit() })
    sim.current = s
    return () => { s.stop() }
  }, [nodes, edges])

  // Fit every node into the canvas, with a margin, once the layout has settled.
  const fit = () => {
    const ns = [...simNodes.current.values()]
    if (!ns.length) return
    const { w, h } = size.current
    const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y)
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60
    const k = Math.min(1.4, Math.max(0.35, Math.min(w / (maxX - minX), h / (maxY - minY))))
    setView({ k, x: (w - (minX + maxX) * k) / 2, y: (h - (minY + maxY) * k) / 2 })
  }

  // Centre on the focused decision once it has a position.
  useEffect(() => {
    if (!focusCardId) return
    const n = simNodes.current.get(`decision:${focusCardId}`)
    if (!n) return
    const { w, h } = size.current
    setView({ x: w / 2 - n.x * 1.15, y: h / 2 - n.y * 1.15, k: 1.15 })
  }, [focusCardId, graph.nodes.length])

  // ---- interaction: pan, zoom, drag, select
  const toGraph = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left - view.x) / view.k, y: (e.clientY - rect.top - view.y) / view.k }
  }
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const p = toGraph(e)
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)))
    const rect = svgRef.current!.getBoundingClientRect()
    setView({ k, x: e.clientX - rect.left - p.x * k, y: e.clientY - rect.top - p.y * k })
  }
  const onPointerDown = (e: React.PointerEvent, node?: SimNode) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    if (node) {
      node.fx = node.x; node.fy = node.y
      sim.current?.alphaTarget(0.25).restart()
      drag.current = { node, moved: false }
    } else {
      drag.current = { pan: { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }, moved: false }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.moved = true
    if (d.node) { const p = toGraph(e); d.node.fx = p.x; d.node.fy = p.y }
    else if (d.pan) setView((v) => ({ ...v, x: d.pan!.vx + (e.clientX - d.pan!.x), y: d.pan!.vy + (e.clientY - d.pan!.y) }))
  }
  const onPointerUp = (e: React.PointerEvent, node?: SimNode) => {
    const d = drag.current
    drag.current = null
    if (d?.node) { d.node.fx = null; d.node.fy = null; sim.current?.alphaTarget(0) }
    if (!d?.moved) setSelected(node ? (selected === node.id ? null : node.id) : null)
    void e
  }

  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const e of edges) { d.set(e.source.id, (d.get(e.source.id) || 0) + 1); d.set(e.target.id, (d.get(e.target.id) || 0) + 1) }
    return d
  }, [edges])
  const radius = (n: SimNode) => R[n.kind] + Math.min(6, (degree.get(n.id) || 0) * 0.8)
  const sel = selected ? simNodes.current.get(selected) : undefined
  const neighbours = useMemo(() => {
    const s = new Set<string>()
    if (!selected) return s
    for (const e of edges) { if (e.source.id === selected) s.add(e.target.id); if (e.target.id === selected) s.add(e.source.id) }
    return s
  }, [selected, edges])
  const dim = (n: SimNode) => (filter && n.kind !== filter) || (selected && selected !== n.id && !neighbours.has(n.id))
  const recent = (n: SimNode) => n.createdAt && Date.now() - Date.parse(n.createdAt) < 20000
  const counts = useMemo(() => KINDS.map((k) => ({ kind: k, n: nodes.filter((x) => x.kind === k).length })).filter((c) => c.n), [nodes])
  const selEdges = sel ? edges.filter((e) => e.source.id === sel.id || e.target.id === sel.id) : []

  return (
    <div className="screen graph-screen">
      <div className="screen-head graph-head">
        <button className="back" onClick={onClose} aria-label={t('Close')}>‹</button>
        <span className="head-title">{t('Decision graph')}</span>
        <span className={`graph-source ${graph.source}`}>
          <i />{graph.source === 'neo4j' ? t('Neo4j · live') : t('Neo4j mirror')}
        </span>
      </div>
      <div className="graph-legend">
        {counts.map((c) => (
          <button key={c.kind} className={`label-pill ${filter === c.kind ? 'on' : ''}`} style={{ ['--c' as any]: KIND_COLOR[c.kind] }} onClick={() => setFilter(filter === c.kind ? null : c.kind)}>
            <i />{c.kind} <b>{c.n}</b>
          </button>
        ))}
        <span className="graph-counts">{nodes.length} {t('nodes')} · {edges.length} {t('relationships')}</span>
      </div>

      <div className="graph-canvas" data-tick={tick}>
        <svg ref={svgRef} onWheel={onWheel} onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={(e) => onPointerUp(e)} onPointerCancel={(e) => onPointerUp(e)}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#5a5a66" />
            </marker>
            <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#e6e6ef" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map((e) => {
              const hi = (selected && (e.source.id === selected || e.target.id === selected)) || (hover && (e.source.id === hover || e.target.id === hover))
              const faded = (selected && !hi) || (filter && e.source.kind !== filter && e.target.kind !== filter)
              const active = ACTIVE_EDGES.has(e.type) && (e.source.kind === 'Sandbox' || e.target.kind === 'Sandbox')
              const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y
              const len = Math.hypot(dx, dy) || 1
              const ux = dx / len, uy = dy / len
              const x1 = e.source.x + ux * (radius(e.source) + 2), y1 = e.source.y + uy * (radius(e.source) + 2)
              const x2 = e.target.x - ux * (radius(e.target) + 5), y2 = e.target.y - uy * (radius(e.target) + 5)
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI
              const flip = angle > 90 || angle < -90
              return (
                <g key={e.id} className={`edge ${hi ? 'hi' : ''} ${faded ? 'faded' : ''} ${active ? 'active' : ''}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={hi ? 'url(#arrow-hi)' : 'url(#arrow)'} />
                  {(hi || view.k > 0.75) && (
                    <text x={mx} y={my} transform={`rotate(${flip ? angle + 180 : angle} ${mx} ${my})`} dy="-5" textAnchor="middle">{e.type.replace(/_/g, ' ')}</text>
                  )}
                </g>
              )
            })}
            {nodes.map((n) => (
              <g
                key={n.id}
                className={`node kind-${n.kind} ${selected === n.id ? 'selected' : ''} ${dim(n) ? 'dim' : ''} ${recent(n) ? 'recent' : ''} ${n.action ? `act-${n.action}` : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, n) }}
                onPointerUp={(e) => { e.stopPropagation(); onPointerUp(e, n) }}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                {recent(n) && <circle className="pulse" r={radius(n) + 6} />}
                {(selected === n.id || hover === n.id) && <circle className="halo" r={radius(n) + 9} fill={KIND_COLOR[n.kind]} />}
                <circle className="disc" r={radius(n)} fill={KIND_COLOR[n.kind]} />
                {n.kind === 'Decision' && n.action && <circle r={radius(n) + 3.5} className="ring" />}
                {n.kind === 'Decision' && !n.action && <circle r={radius(n) + 3.5} className="ring open" />}
                <text className="glyph" dy="0.35em" textAnchor="middle">{n.kind === 'Person' ? n.label[0] : n.kind === 'Agent' ? '✦' : n.kind === 'Decision' ? (n.action === 'approve' ? '✓' : n.action === 'decline' ? '✕' : '?') : n.kind === 'PR' ? '⇡' : n.kind === 'Desk' ? '▣' : n.kind === 'Sandbox' ? '▢' : n.kind === 'Repo' ? '{ }' : '◆'}</text>
                <g className="tag" transform={`translate(0 ${radius(n) + 16})`}>
                  <rect x={-(short(n.label, n.kind === 'Decision' ? 24 : 16).length * 3.3 + 8)} y="-9" width={short(n.label, n.kind === 'Decision' ? 24 : 16).length * 6.6 + 16} height="18" rx="9" />
                  <text className="name" dy="0.35em" textAnchor="middle">{short(n.label, n.kind === 'Decision' ? 24 : 16)}</text>
                </g>
              </g>
            ))}
          </g>
        </svg>
        {nodes.length === 0 && <div className="graph-empty">{t('Nothing in the graph yet. The first decision will draw it.')}</div>}
      </div>

      {sel && (
        <aside className="node-panel">
          <header>
            <span className="np-kind" style={{ background: KIND_COLOR[sel.kind] }}>{sel.kind}</span>
            <strong>{sel.label}</strong>
            <button className="np-close" onClick={() => setSelected(null)} aria-label={t('Close')}>×</button>
          </header>
          <dl>
            {Object.entries(sel.props).filter(([, v]) => v !== undefined && v !== null && v !== '').slice(0, 8).map(([k, v]) => (
              <React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>
            ))}
          </dl>
          {selEdges.length > 0 && (
            <ul className="np-rels">
              {selEdges.slice(0, 8).map((e) => {
                const other = e.source.id === sel.id ? e.target : e.source
                const out = e.source.id === sel.id
                return (
                  <li key={e.id} onClick={() => setSelected(other.id)}>
                    <span className="np-rel">{out ? '→' : '←'} {e.type}</span>
                    <span className="np-other"><i style={{ background: KIND_COLOR[other.kind] }} />{short(other.label, 28)}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <pre className="np-cypher">{`MATCH (n:${sel.kind} {${sel.kind === 'Decision' ? `id: "${sel.cardId}"` : sel.kind === 'Person' ? `login: "${sel.props.login}"` : `name: "${sel.label}"`}})-[r]-(m)\nRETURN n, r, m`}</pre>
          {sel.cardId && <button className="pill-btn np-open" onClick={() => onOpenCard(sel.cardId!)}>{t('Open the card')} ›</button>}
        </aside>
      )}
    </div>
  )
}
