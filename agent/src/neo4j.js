// Neo4j Aura over the HTTPS Query API — no driver, works anywhere fetch does.
// If your Aura instance does not serve /db/<name>/query/v2, swap `run` for
// neo4j-driver (Bolt works from Node) and keep every other function as is.
import { env } from "./env.js";

export async function run(statement, parameters = {}) {
  const db = env("NEO4J_DATABASE", "neo4j");
  const auth = Buffer.from(`${env("NEO4J_USER", "neo4j")}:${env("NEO4J_PASSWORD")}`).toString("base64");
  const r = await fetch(`${env("NEO4J_URI").replace(/\/$/, "")}/db/${db}/query/v2`, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json", authorization: `Basic ${auth}`,
      // Neo4j on a Daytona sandbox is reached through its preview link, which
      // wants the sandbox's preview token on every request.
      ...(env("NEO4J_PREVIEW_TOKEN", "") ? { "x-daytona-preview-token": env("NEO4J_PREVIEW_TOKEN") } : {}),
    },
    body: JSON.stringify({ statement, parameters }),
  });
  if (!r.ok) throw new Error(`neo4j ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const body = await r.json();
  if (body.errors?.length) throw new Error(`neo4j: ${body.errors[0].message}`);
  const fields = body.data?.fields || [];
  return (body.data?.values || []).map((row) => Object.fromEntries(row.map((v, i) => [fields[i], v])));
}

export async function ensureSchema() {
  for (const q of [
    "CREATE CONSTRAINT person_login IF NOT EXISTS FOR (p:Person) REQUIRE p.login IS UNIQUE",
    "CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT business_slug IF NOT EXISTS FOR (b:Business) REQUIRE b.slug IS UNIQUE",
    "CREATE CONSTRAINT repo_name IF NOT EXISTS FOR (r:Repo) REQUIRE r.fullName IS UNIQUE",
  ]) await run(q);
}

export async function upsertMembers(orgId, members) {
  await run(
    `MERGE (o:Org {id:$orgId})
     WITH o UNWIND $members AS m
     MERGE (p:Person {login:m.login}) SET p.name = coalesce(m.name, m.login), p.role = m.role
     MERGE (p)-[:MEMBER_OF]->(o)`,
    { orgId, members: members.map((m) => ({ login: m.login || m.id, name: m.name, role: m.role })) }
  );
}

// A readable name for a login like "u:tanaka@demo.example" → "Tanaka".
function pretty(login) {
  const raw = String(login || "").replace(/^(u:|email:)/, "").split("@")[0];
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null;
}

// One card → one Decision node with its people, business and repo.
export async function upsertCard(card, { repo, orgId } = {}) {
  await run(
    `MERGE (d:Decision {id:$id})
     SET d.title=$title, d.type=$type, d.status=$status, d.priority=$priority,
         d.createdAt=$createdAt, d.action=$action, d.decidedAt=$decidedAt, d.summary=$summary
     WITH d
     MERGE (o:Org {id:$orgId})
     MERGE (to:Person {login:$recipient}) SET to.name = coalesce(to.name, $recipientName)
     MERGE (d)-[:ASSIGNED_TO]->(to) MERGE (to)-[:MEMBER_OF]->(o)
     WITH d, o
     FOREACH (_ IN CASE WHEN $sender IS NULL THEN [] ELSE [1] END |
       MERGE (from:Person {login:$sender}) SET from.name = coalesce(from.name, $senderName)
       MERGE (from)-[:REQUESTED]->(d) MERGE (from)-[:MEMBER_OF]->(o))
     FOREACH (_ IN CASE WHEN $business IS NULL THEN [] ELSE [1] END |
       MERGE (b:Business {slug:$business}) MERGE (d)-[:ABOUT]->(b))
     FOREACH (_ IN CASE WHEN $repo IS NULL THEN [] ELSE [1] END |
       MERGE (r:Repo {fullName:$repo}) MERGE (d)-[:TOUCHES]->(r))
     FOREACH (_ IN CASE WHEN $action IS NULL THEN [] ELSE [1] END |
       MERGE (who:Person {login:$actor})
       MERGE (d)-[x:DECIDED_BY]->(who) SET x.action=$action, x.at=$decidedAt, x.note=$note)`,
    {
      id: card.id, title: card.title || "", type: card.type || "task", status: card.status || "pending",
      priority: card.priority || "medium", createdAt: card.createdAt || null, summary: (card.summary || "").slice(0, 500),
      orgId: orgId || "org",
      recipient: card.recipientUserID, recipientName: pretty(card.recipientUserID),
      sender: card.senderUserID || null, senderName: card.requestedBy?.name || pretty(card.senderUserID),
      business: card.business || null,
      repo: repo || card.githubRepository || null,
      action: card.decision?.action || null, actor: card.decision?.actorUserID || card.recipientUserID,
      decidedAt: card.decision?.decidedAt || null, note: card.decision?.note || card.decision?.replyText || null,
    }
  );
}

export async function recordPR(cardId, prUrl) {
  await run(
    `MATCH (d:Decision {id:$cardId}) MERGE (pr:PR {url:$prUrl}) MERGE (d)-[:PRODUCED]->(pr)`,
    { cardId, prUrl }
  );
}

// The GraphRAG part: what the approver would otherwise go and look up.
export async function contextFor(cardId) {
  const related = await run(
    `MATCH (d:Decision {id:$id})-[:ABOUT]->(b:Business)<-[:ABOUT]-(p:Decision)
     WHERE p.id <> d.id AND p.action IS NOT NULL
     OPTIONAL MATCH (p)-[r:DECIDED_BY]->(who:Person)
     RETURN p.id AS cardId, p.title AS title, p.action AS action, r.at AS decidedAt, who.login AS by
     ORDER BY r.at DESC LIMIT 5`,
    { id: cardId }
  );
  const conflicts = await run(
    `MATCH (d:Decision {id:$id})-[:TOUCHES]->(r:Repo)<-[:TOUCHES]-(o:Decision)-[:ASSIGNED_TO]->(p:Person)
     WHERE o.id <> d.id AND o.action IS NULL
     RETURN o.id AS cardId, o.title AS title, p.login AS recipient LIMIT 5`,
    { id: cardId }
  );
  return { related, conflicts };
}

/// The whole neighbourhood the org works in, small enough to publish as
/// context: every node and relationship reachable from this org's people.
/// The feed's graph screen draws exactly this when an agent is running.
export async function neighborhood(orgId, { limit = 300 } = {}) {
  const rows = await run(
    `MATCH (p:Person)-[:MEMBER_OF]->(:Org {id:$orgId})
     MATCH (p)-[*0..2]-(n)
     WITH DISTINCT n LIMIT $limit
     MATCH (n)-[r]-(m)
     WHERE NOT n:Org AND NOT m:Org
     RETURN DISTINCT
       elementId(n) AS nid, labels(n)[0] AS nkind, properties(n) AS nprops,
       type(r) AS rtype, startNode(r) = n AS out,
       elementId(m) AS mid, labels(m)[0] AS mkind, properties(m) AS mprops
     LIMIT $edges`,
    { orgId, limit, edges: limit * 3 }
  );
  const nodes = new Map();
  const edges = new Map();
  const put = (id, kind, props) => {
    if (nodes.has(id)) return;
    const name = props.name || props.title || props.login || props.slug || props.fullName || props.url || id;
    const node = { id, kind, name, props: {} , action: props.action, createdAt: props.createdAt };
    for (const [k, v] of Object.entries(props)) if (["id","title","login","name","slug","fullName","url","type","status","priority","role","action","createdAt","decidedAt","note"].includes(k) && v != null) node.props[k] = v;
    if (kind === "Decision") node.cardId = props.id;
    nodes.set(id, node);
  };
  for (const r of rows) {
    put(r.nid, r.nkind, r.nprops || {});
    put(r.mid, r.mkind, r.mprops || {});
    const [from, to] = r.out ? [r.nid, r.mid] : [r.mid, r.nid];
    edges.set(`${from}|${r.rtype}|${to}`, { from, to, type: r.rtype });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], source: "neo4j", at: new Date().toISOString() };
}
