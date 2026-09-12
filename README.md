# TikTok for Work

**An AI-native communication OS for you, your AI agents, and your team.**

Slack and Notion were great. They were built for humans typing to humans. Work
now happens between people *and* their AI agents, and the tools have not
caught up: an agent cannot sit in a channel, a decision cannot be swiped, and
nothing that gets approved starts moving on its own.

TikTok for Work starts over. You talk only to your own AI. It routes what you
need across the organization and hands it to the right person as a
**Decision Card** in a vertical, one-at-a-time feed. Swipe to decide. The
outcome lands in GitHub, in the decision graph, and in the requester's feed.

> Approve it, and it is already done.

Every card arrives with evidence: **your AI has already tried the change in
its own cloud computer and asked the organization's graph what happened last
time.** Every approval executes itself.

<p align="center">
  <img src="docs/media/04-evidence-done.png" width="260" alt="A Decision Card with evidence: tests passed, files changed, forked in 184 ms, open the preview">
  <img src="docs/media/04a-graph.png" width="260" alt="The decision graph: people, their AIs and machines, businesses, decisions, repositories">
  <img src="docs/media/04b-fleet.png" width="260" alt="Your team's AIs: one desk sandbox per agent, one sandbox per decision being checked">
</p>

*Demo video: [`docs/media/demo.webm`](docs/media/demo.webm) (35 s). Run it
yourself with `?demo` on the web client, no backend needed.*

## What is on a card

```
APPROVAL · HOTEL SAKURA · high
Show tax-inclusive prices on the booking site
Requested by Toru · owner

✦ Your AI checked this                          Done in 6.4 s
  [■ Daytona sandbox] [● Neo4j graph]
  ✓ Asked the decision graph          3 precedents · 1 collision     NEO4J
  ✓ Forked my desk into a fresh sandbox   184 ms                     DAYTONA
  ✓ Applied 2 edits                   src/pricing.ts, PriceTag.tsx   AI
  ✓ Ran the test suite                npm test · 14 passed, 0 failed DAYTONA
  ✓ Started a preview of the change                                  DAYTONA
  ✅ 14 tests passed · 2 files +9 −3 · Forked in 184 ms · ▶ Open the preview
  You approved 2 of the last 3 decisions about Hotel Sakura, most recently
  12 days ago. Yui has an open card touching the same repository.

        ✕ decline                 ✓ approve
```

Swipe right: the same sandbox pushes its tested branch, a pull request opens,
the decision and the PR are written to the graph, and the requester gets a
card back. Swipe left: the sandbox is deleted and the decision is recorded.
Either way, the next card about this business already knows.

## Every agent has its own computer

This is the part Daytona makes possible.

```
                 Person ──OWNS──▶ Agent ──RUNS_ON──▶ Desk (persistent sandbox)
                                                        │ fork, ~200 ms
                                          Sandbox ◀─────┘   one per decision
                                             │  clone already there, deps already installed
                                             ├─ apply the model's edits
                                             ├─ npm test
                                             ├─ serve a preview  → link on the card
                                             └─ approve → git push → PR   /  else → delete
```

| Daytona feature | What it does here | Where you see it |
|---|---|---|
| Persistent sandbox per agent (`desk-<user>`, never auto-stopped) | The agent's own machine. The runner itself is deployed into it (`npm run deploy:desk`) | Fleet screen: **DESK desk-tanaka · started** |
| `daytona.fork(desk)` | One sandbox per decision, with the checkout and `node_modules` already in place. A dry-run is edit + test, not clone + install | "Forked my desk into a fresh sandbox · 184 ms" |
| `process.executeCommand`, `fs.uploadFile` | Apply the proposed edits, run the tests, read the diff stats | "Applied 2 edits", "14 passed, 0 failed" |
| `getPreviewLink(port)` | The changed app, served from the fork, one tap from the card | **▶ Open the preview** |
| Labels + `list()` | Which agent is checking which decision on which machine | Fleet screen counts, graph `Sandbox` nodes |
| Kept alive until decided | Approve pushes the exact branch that was tested; anything else deletes the fork | "Pushed the tested branch" → "Pull request #12 is open" |

Why not CI or a laptop: cards are created continuously and in parallel. A
queue would put the evidence *after* the decision. Sub-second, disposable,
forkable machines are what make "the evidence is there before you look" a
user experience rather than a promise.

## Decisions become context for the next decision

This is the part Neo4j makes possible.

```
(:Person)-[:OWNS]->(:Agent)-[:RUNS_ON]->(:Desk)<-[:FORKED_FROM]-(:Sandbox)-[:CHECKED]->(:Decision)
(:Person)-[:REQUESTED]->(:Decision)-[:ASSIGNED_TO]->(:Person)
(:Decision)-[:DECIDED_BY {action, at}]->(:Person)
(:Decision)-[:ABOUT]->(:Business)     (:Decision)-[:TOUCHES]->(:Repo)     (:Decision)-[:PRODUCED]->(:PR)
```

Two queries run for every card, in milliseconds, and their answer is written
on it in one sentence:

```cypher
// Precedent: what did we decide about this business, and who decided?
MATCH (d:Decision {id:$id})-[:ABOUT]->(b)<-[:ABOUT]-(p:Decision)
WHERE p.id <> d.id AND p.action IS NOT NULL
OPTIONAL MATCH (p)-[r:DECIDED_BY]->(who)
RETURN p.title, p.action, r.at, who.login ORDER BY r.at DESC LIMIT 5

// Collision: whose open work touches the same code right now?
MATCH (d:Decision {id:$id})-[:TOUCHES]->(r)<-[:TOUCHES]-(o:Decision)-[:ASSIGNED_TO]->(p)
WHERE o.id <> d.id AND o.action IS NULL
RETURN o.title, p.login
```

The **Decision graph** screen draws the org the way Neo4j holds it: people,
their AIs and machines, businesses, decisions (ringed green or red by how
they ended), repositories, pull requests. Drag, zoom, tap a node for its
properties and relationships, and the Cypher that would fetch it. The agent
publishes the live neighbourhood from Neo4j; a client with no agent running
draws the same graph from its own cards.

## Architecture

```
┌──────────────┐  wss (AG-UI)  ┌──────────────────────────────────┐
│ Feed clients │◄─────────────►│ Relay (Cloudflare Workers)       │──▶ GitHub
│ web/ · iOS   │               │ Durable Objects · D1 · routing   │
└──────────────┘               └───────────────┬──────────────────┘
                                               │ wss, joined as the recipient
                                 ┌─────────────▼─────────────┐
                                 │ agent/  — the recipient's │   runs on its own
                                 │ AI, one process per person│   Daytona desk
                                 └──────┬─────────────┬──────┘
                                        ▼             ▼
                                    Daytona         Neo4j
                                    desk + forks    decision graph
```

The relay's access rule, that only a card's recipient may update it, is what
shapes the design: the agent joins **as the recipient**, so it may enrich
that person's cards and nobody else's, and create result cards as itself.
Evidence is a structured `evidence` object on the card plus plain-text
segments in `context`, so older clients still show it. The agent also
publishes its status and the live graph as the user's context, which every
teammate's screen receives.

## Repository layout

| Path | What |
|---|---|
| `web/` | The feed: React + TypeScript, AG-UI over WebSocket. Evidence panel, decision graph, fleet screen, `?demo` mode |
| `agent/` | The runner: relay client, Daytona desk and forks, Neo4j graph and queries, model client, smoke and deploy scripts |
| `relay/` | Cloudflare Worker: per-org Durable Object, D1, routing, GitHub sync, notifications. 380 tests |
| `docs/design.md` | Design rationale, data model, sandbox procedure, demo walkthrough |
| `docs/media/` | Screenshots and the demo video |
| `deck/` | The pitch deck |

## Run it

**The feed, no backend (demo mode)**

```bash
cd web && npm install && npm run dev
# open http://localhost:3000/?demo
```

**The feed against the deployed relay**

```bash
cd web && cp .env.example .env    # VITE_API_HOST points at the relay
npm run dev
```

**The agent** (Daytona and Neo4j are required; it will not start without them)

```bash
cd agent && npm install && cp .env.example .env
npm run smoke:daytona     # create → exec → delete
npm run smoke:neo4j       # RETURN 1, schema
npm run smoke:llm         # model endpoint
npm start                 # preflight, make the desk, join the relay
npm run deploy:desk       # or: run the agent inside its own Daytona desk
```

Sign in to the web feed as the person whose AI this is and copy
`sessionToken`, `userId`, `orgId` from Local Storage into `.env`. Two people,
two processes.

**The relay**

```bash
cd relay && npm install && npm test && npx wrangler dev
```

## Status

Working: feed, routing, real-time relay, GitHub sync, per-business filing,
evidence panel, decision graph, fleet screen, demo mode; agent with desk,
fork, edits, tests, preview, push, PR, result card; Neo4j schema, seeding,
precedent and collision queries, live graph publishing.

Verified end to end on real infrastructure: a card sent through the deployed
relay reaches the recipient's agent, which answers from Neo4j (precedent and
collisions), boots a sandbox from its Daytona desk's snapshot in 4–6 s, runs
the demo site's 12 tests, serves a signed preview link, and writes it all on
the card in about 10 s. The approval is detected from the relay's state
patch and the execution steps continue the same timeline; with GitHub
credentials the tested branch is pushed and the pull request opened.

A note on forks: `daytona.fork()` is not offered on every plan, so the desk
is snapshotted once (`sandbox.createSnapshot`) and per-decision sandboxes
boot from that snapshot with the checkout and dependencies already there. A
plan with forks uses them automatically.

Next: blast radius (which other open decisions an approval changes), several
forks per decision trying alternatives in parallel, dry-runs for non-code
decisions, and graph-informed routing.
