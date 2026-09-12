# agent/ — the recipient's AI

A Node process that joins the relay as one user and acts as that user's AI:
it attaches sandbox dry-runs and graph context to every Decision Card that
person receives, and turns an approval into a pushed branch and a pull request.
Design and data model: [../docs/design.md](../docs/design.md).

**Daytona and Neo4j are required.** On start the runner checks both (and the
model endpoint) and exits if any does not answer. There is no "skip if
unconfigured" branch anywhere in this directory.

## Run

```bash
npm install                  # the Daytona SDK is the only dependency; Node 22+
cp .env.example .env
npm run smoke:daytona        # create → exec → delete
npm run smoke:neo4j          # RETURN 1 and the schema constraints
npm run smoke:llm            # the model endpoint answers "ready"
npm start
```

## The session token

Sign in to the web feed **as the recipient** (say, Tanaka). In DevTools →
Application → Local Storage copy `sessionToken`, `userId` and `orgId` into
`AGENT_SESSION_TOKEN`, `AGENT_USER_ID` and `ORG_ID`.

The relay lets only a card's recipient update it, so the runner must hold the
recipient's session. To run two people's AIs, run two processes with two
`.env` files.

## What it does

| Relay event | Runner |
|---|---|
| `STATE_SNAPSHOT` on join | Upsert members and every card into Neo4j |
| `STATE_DELTA` with a new card for this user | Query precedent and collisions in Neo4j → `card_updated`. Then clone / edit / test in a Daytona sandbox → `card_updated` again |
| `TOOL_CALL_RESULT` approve | Push the branch from that sandbox → open the PR → result card to the requester → `PRODUCED` edge in the graph |
| any other decision | Delete the sandbox, record the decision in the graph |

Evidence goes on the card as `card.evidence` (JSON) and as `[agent] …`
segments at the end of `card.context`. The feed splits `context` on `" · "`
and renders bullets, so the evidence shows with no client change.

## Demo insurance

`DEMO_CACHE=1` returns the stored dry-run for an instruction that has already
run once (`.cache/dryrun.json`). No sandbox is created, so approve → push does
not work in that mode. Rehearse with the cache; run the real thing once, live.

## Verified and still to verify

- Verified against `@daytonaio/sdk` 0.211.2 type definitions:
  `process.executeCommand(cmd, cwd?, env?, timeoutSec?)`,
  `git.clone(url, path, branch?, commitId?, username?, password?)`,
  `fs.uploadFile(Buffer, remotePath)`, `sandbox.delete()`, `daytona.create({ language })`.
- Not yet run end to end: `npm run smoke:daytona` proves the key and the
  sandbox lifecycle on the day.
- The Neo4j HTTP Query API path `/db/<name>/query/v2`: `npm run smoke:neo4j`
  proves it. If the instance does not serve it, swap `run()` for
  `neo4j-driver` over Bolt and keep every other function.
