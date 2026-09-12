# Design

## The problem

The decision feed already solves *who* should decide and *where* the decision
lands. Two gaps remain, and they are the two places a small team still loses
time:

1. **A card has no evidence.** It says what is asked, not what will happen if
   you say yes. The approver opens GitHub, Slack and last month's notes to find
   out. The card has become a notification with a swipe on it.
2. **Approval is where the work starts, not where it ends.** Someone still has
   to write the change, run the tests and open the PR. Between "approved" and
   "started" a small team routinely loses two days.

The product's essential value, then, is **evidence and execution attached to
the decision itself.** Each gap maps to one infrastructure layer.

| Gap | What fills it | Layer |
|---|---|---|
| No "I tried it" before the decision | A disposable, isolated environment per card that clones, edits and tests | Daytona |
| No "we decided this before" or "this collides with" | A graph of people, businesses, decisions, repos and PRs, queried per card | Neo4j |

## The recipient's AI, made real

The relay's access rule is that **only a card's recipient may update it.** That
rule is what shapes the design: the agent joins the relay with the recipient's
session, so it *is* that person's AI. It may enrich their cards and nobody
else's, and it may create new cards as itself (the result card back to the
requester). Nothing in the relay or the clients changes. The agent is a
separate process that speaks the same AG-UI protocol as the feed clients.

```
new card for me     → graph context → sandbox dry-run → card_updated { evidence }
TOOL_CALL_RESULT approve → push branch → open PR → result card → graph
any other decision  → discard sandbox → graph
```

Evidence lands in two places at once: a structured `evidence` object on the
card, and short `[agent] …` segments appended to the card's `context` string.
The feed clients already split `context` on `" · "` and render each segment as
a bullet, so the evidence is visible with **no client change**. Dedicated
badges are an optional polish (`docs/feed-evidence-badges.md`).

## Evidence on a card

```jsonc
"evidence": {
  "dryRun": {
    "sandboxId": "…", "branch": "agent/card-abc12345",
    "filesChanged": 2, "insertions": 9, "deletions": 3,
    "tests": { "passed": 14, "failed": 0, "raw": "…last 40 lines…" },
    "status": "passed" | "failed" | "error",
    "editSummary": "Multiply displayed prices by 1.10 and label them tax-inclusive",
    "durationMs": 41000
  },
  "graph": {
    "summary": "3 prior decisions on hotel-sakura; the last was approved by tanaka on Aug 30. Yui's open card #c9 touches the same repository.",
    "related":   [{ "cardId": "…", "title": "…", "action": "approve", "decidedAt": "…", "by": "tanaka" }],
    "conflicts": [{ "cardId": "…", "title": "…", "recipient": "yui" }]
  },
  "execution": { "prUrl": "https://github.com/…/pull/12", "number": 12, "pushedAt": "…" }
}
```

A failed dry-run is still evidence. "The tests break" is exactly what an
approver wants to know before saying yes, so the card shows it rather than
hiding it.

## Graph model (Neo4j)

```
(:Person {login, name, role})
(:Business {slug, name})
(:Decision {id, title, type, status, priority, createdAt, action, decidedAt})
(:Repo {fullName})
(:PR {url})

(Person)-[:MEMBER_OF]->(Org)
(Person)-[:REQUESTED]->(Decision)
(Decision)-[:ASSIGNED_TO]->(Person)
(Decision)-[:DECIDED_BY {action, at, note}]->(Person)
(Decision)-[:ABOUT]->(Business)
(Decision)-[:TOUCHES]->(Repo)
(Decision)-[:PRODUCED]->(PR)
```

The graph is seeded from the relay's state snapshot on join (every card the
org has) and kept current from then on. Two queries run per card:

```cypher
// Precedent: decided cards about the same business, newest first
MATCH (d:Decision {id:$id})-[:ABOUT]->(b:Business)<-[:ABOUT]-(p:Decision)
WHERE p.id <> d.id AND p.action IS NOT NULL
OPTIONAL MATCH (p)-[r:DECIDED_BY]->(who:Person)
RETURN p.id, p.title, p.action, r.at, who.login ORDER BY r.at DESC LIMIT 5

// Collision: open cards that touch the same repository, and who holds them
MATCH (d:Decision {id:$id})-[:TOUCHES]->(r:Repo)<-[:TOUCHES]-(o:Decision)-[:ASSIGNED_TO]->(p:Person)
WHERE o.id <> d.id AND o.action IS NULL
RETURN o.id, o.title, p.login
```

The rows go to the model for a one-sentence summary in the reader's language;
the raw rows stay on the card for a client that wants to render them.

## Sandbox procedure (Daytona)

One sandbox per card, kept alive until the card is decided.

1. `daytona.create({ language: "typescript" })`
2. `sandbox.git.clone(repoUrl, "/home/daytona/repo", …)` with the agent's GitHub credentials
3. `git checkout -b agent/card-<id>`
4. `git grep -il` for the instruction's words picks up to three files; the model
   returns `{ path, find, replace }` edits; each is applied with `fs.uploadFile`
   and committed
5. `npm ci && npm test`; exit code and the last 40 lines become the evidence
6. `git diff --shortstat` gives files changed, insertions, deletions
7. On approve: `git push` from the same sandbox, then the GitHub API opens the PR.
   On anything else, or on timeout: `sandbox.delete()`

Sandbox creation and command execution use the official TypeScript SDK; the
call signatures in `agent/src/daytona.js` match the SDK's type definitions.

## Model calls

The agent makes two kinds of model call, both structured and small:

- **Patch proposal**: given the instruction and up to three files, return JSON
  edits.
- **Graph summary**: given the precedent and collision rows, return one sentence.

Both go to any OpenAI-compatible `/v1` endpoint (`LLM_BASE_URL`, `LLM_MODEL`).

## Demo walkthrough

| Beat | Screen | What to say |
|---|---|---|
| 1 | Toru's feed, empty | Small teams open three tools before an approval and wait two days after it. This turns both into one swipe |
| 2 | Toru types the instruction | Toru talks only to their AI. The AI routes it to Tanaka, the approver |
| 3 | Tanaka's feed: the card lands, then evidence appears on it a few seconds later. A terminal shows the sandbox log beside it | Before Tanaka looked, their AI tried it in a fresh sandbox and asked the graph what was decided before and who this collides with |
| 4 | Tanaka swipes right | Read the evidence, decide once |
| 5 | Toru's feed: "Approved. PR #12 is open." The PR page | The approval executed itself. Nobody waited for someone to start |
| 6 | The graph in Neo4j Browser | Every decision becomes context for the next one |

`DEMO_CACHE=1` serves a stored dry-run for an instruction already run once,
so rehearsals do not wait on a clone and a test run. Keep it off for the one
live run; the moment the evidence appears is the demo.

## Risks and the fallback that keeps each layer in place

| Risk | Fallback |
|---|---|
| `npm ci` is slow in the sandbox | Use a demo repository with no dependencies (`node --test`). Rehearse with the cache |
| Session token expired (`sign-in-required` on join) | Sign in again in the web client and copy the new token |
| The Neo4j instance does not serve the HTTP Query API | Swap `run()` in `neo4j.js` for `neo4j-driver` over Bolt; every other function stays |
| The model's JSON is malformed | Both calls are JSON-only; `response_format: json_object` plus a fence strip handles the common cases. A failed proposal still yields a clone-and-test dry-run |
| The model's patch breaks the tests | That is evidence. The card says so and the approver decides with it |

## Hypotheses this design lets us test

1. **Cards with evidence are decided faster than cards without.** Show two
   people the same card with and without evidence and time the decision.
2. **"Approve means execute" is welcome, not alarming.** If approvers hesitate
   because a PR will open on their swipe, keep the push behind the approval as
   it is now. If they do not, open the PR before the decision.
3. **Precedent on the card changes the decision.** On the third card about a
   business, does the approver read "last time we decided…"? If not, the
   graph's value is the record, not the prompt.
