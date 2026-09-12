# TikTok for Work

An AI-native decision feed for teams. People talk only to their own AI. The AI
routes each request across the organization and hands it to the right person as
a **Decision Card** in a vertical, one-card-at-a-time feed. Swipe to decide. The
outcome syncs to GitHub.

This repository adds the part that makes a decision worth trusting: **every card
arrives with evidence, and an approval executes itself.**

> Approve it, and it is already done.

## What a card carries

```
┌──────────────────────────────────────────────────────────┐
│ APPROVAL · HOTEL SAKURA · high                           │
│                                                          │
│ Show tax-inclusive prices on the booking site            │
│                                                          │
│ Requested by Toru · owner                                │
│                                                          │
│ ✅ 14 tests passed · 2 files changed (+9 −3)             │
│ Verified in a Daytona sandbox in 41s                     │
│ Last similar decision: approved by you on Aug 30.        │
│ Yui has an open card touching the same repository.       │
│                                                          │
│         ✕ decline        ✎ revise        ✓ approve       │
└──────────────────────────────────────────────────────────┘
```

Before the recipient opens the card, their AI has already:

1. **Tried it.** A fresh, isolated **Daytona** sandbox clones the repository,
   applies the change, runs the tests, and reports the diff and the results.
2. **Remembered.** **Neo4j** holds the graph of people, businesses, decisions,
   repositories and pull requests. The AI asks it what was decided before, by
   whom, and whose open work this collides with, and writes that on the card.
When the recipient swipes right, the same sandbox pushes its branch, opens a
pull request, records the decision and the PR in the graph, and sends a result
card back to whoever asked.

## Architecture

```
┌──────────────┐  wss (AG-UI)  ┌────────────────────────────────┐
│ Feed clients │◄─────────────►│ Relay                          │
│ iOS · Web    │               │ per-org state · routing · GitHub│
└──────────────┘               └───────────────┬────────────────┘
                                               │ wss (AG-UI), joined as the recipient
                                    ┌──────────▼──────────┐
                                    │ agent/              │
                                    │ the recipient's AI  │
                                    └──┬───────────┬──────┘
                                       ▼           ▼
                                   Daytona       Neo4j
                                   one sandbox   decision graph
                                   per card      (Query API)
```

The relay already exposes everything the agent needs: a state snapshot on join,
JSON-patch deltas for every card, a tool-call result for every decision, and
two writes (`card_updated` by the card's recipient, `card_created` by any
member). The agent is a separate Node process that joins **as the recipient**,
which is exactly what lets it enrich that person's cards and nobody else's.

| Layer | Role | Why this and not something else |
|---|---|---|
| **Daytona** | One sandbox per card: clone, edit, test, and later push | Cards are created continuously and in parallel. Sub-second, disposable, fully isolated environments are what make "the evidence is there before you look" possible without a queue |
| **Neo4j** | The decision graph and its GraphRAG queries | "Who approved the last three decisions about this business, what PRs came out of them, and who is working on that code right now" is a multi-hop question. Rows cannot answer it; a graph answers it in one query |

## Repository layout

| Path | What |
|---|---|
| `agent/` | The runner: relay client, Daytona sandbox lifecycle, Neo4j graph, model client, smoke scripts |
| `docs/design.md` | Design rationale, data model, graph schema, sandbox procedure, demo walkthrough |
| `docs/feed-evidence-badges.md` | Optional: dedicated evidence badges in the web feed |

## Quick start

```bash
cd agent
npm install                  # the Daytona SDK is the only dependency; Node 22+
cp .env.example .env         # fill in the relay session, Daytona, Neo4j, the model endpoint, GitHub
npm run smoke:daytona        # create → exec → delete
npm run smoke:neo4j          # RETURN 1 and the schema constraints
npm run smoke:llm            # the model endpoint answers
npm start                    # preflight, then join the relay
```

The runner refuses to start until Daytona and Neo4j both answer. There is
deliberately no "skip if unconfigured" path: they are the execution and
context layers of the product, not add-ons.

## How a request flows

1. Toru tells their AI: "Show tax-inclusive prices on the hotel booking site."
2. The relay routes it to Tanaka, the approver, as an approval card.
3. Tanaka's AI (this runner) sees the card, queries the graph, attaches the
   context, spins up a sandbox, applies the change, runs the tests, attaches
   the results. Tanaka's feed updates in place.
4. Tanaka swipes right.
5. The runner pushes the branch from that sandbox, opens the PR, records the
   decision and PR in the graph, and sends Toru a card: "Approved. PR #12 is open."
6. Any other decision discards the sandbox and records the outcome in the graph.
