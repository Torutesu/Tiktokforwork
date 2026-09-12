// Neo4j Aura over the HTTPS Query API — no driver, works anywhere fetch does.
// If your Aura instance does not serve /db/<name>/query/v2, swap `run` for
// neo4j-driver (Bolt works from Node) and keep every other function as is.
import { env, has } from "./env.js";

export const enabled = () => has("NEO4J_URI") && has("NEO4J_PASSWORD");

export async function run(statement, parameters = {}) {
  const db = env("NEO4J_DATABASE", "neo4j");
  const auth = Buffer.from(`${env("NEO4J_USER", "neo4j")}:${env("NEO4J_PASSWORD")}`).toString("base64");
  const r = await fetch(`${env("NEO4J_URI").replace(/\/$/, "")}/db/${db}/query/v2`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Basic ${auth}` },
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

// One card → one Decision node with its people, business and repo.
export async function upsertCard(card, { repo } = {}) {
  await run(
    `MERGE (d:Decision {id:$id})
     SET d.title=$title, d.type=$type, d.status=$status, d.priority=$priority,
         d.createdAt=$createdAt, d.action=$action, d.decidedAt=$decidedAt, d.summary=$summary
     WITH d
     MERGE (to:Person {login:$recipient}) MERGE (d)-[:ASSIGNED_TO]->(to)
     WITH d
     FOREACH (_ IN CASE WHEN $sender IS NULL THEN [] ELSE [1] END |
       MERGE (from:Person {login:$sender}) MERGE (from)-[:REQUESTED]->(d))
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
      recipient: card.recipientUserID, sender: card.senderUserID || null, business: card.business || null,
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
