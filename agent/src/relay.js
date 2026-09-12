// The runner's connection to the relay, speaking AG-UI over WebSocket
// exactly like web-react/src/services/WebSocketClient.ts. It joins as ONE user
// (the recipient whose AI it is), keeps { cardsById } in sync from
// STATE_SNAPSHOT / STATE_DELTA, and lets the caller react to new cards and to
// decisions (TOOL_CALL_RESULT).
//
// Two writes are needed and both are allowed by the relay for this identity:
//   card_updated  — only the recipient may send it; we ARE the recipient's AI.
//   card_created  — any member, stamped as the sender; used for result cards.

import { env } from "./env.js";

function applyPatch(state, ops) {
  for (const op of ops) {
    const parts = op.path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let target = state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) target[parts[i]] = {};
      target = target[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (op.op === "remove") delete target[last];
    else target[last] = op.value; // add / replace
  }
}

export class Relay {
  constructor({ onCard, onDecision, log = console.log }) {
    this.state = { cardsById: {} };
    this.onCard = onCard;
    this.onDecision = onDecision;
    this.log = log;
    this.userId = env("AGENT_USER_ID");
    this.orgId = env("ORG_ID");
    this.seen = new Set();
    this.decided = new Set();
    this.ready = false;
  }

  connect() {
    const url = new URL(env("RELAY_WS"));
    url.searchParams.set("orgId", this.orgId);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        payload: { userId: this.userId, orgId: this.orgId, protocol: "agui/1", sessionToken: env("AGENT_SESSION_TOKEN") },
      }));
    };
    ws.onmessage = (m) => this.handle(JSON.parse(m.data));
    ws.onclose = () => {
      this.log("relay closed, reconnecting in 3s");
      this.ready = false;
      setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = (e) => this.log("relay error", e?.message || e);
    return this;
  }

  handle(ev) {
    switch (ev.type) {
      case "RUN_ERROR":
        this.log("RUN_ERROR", ev.message, ev.code);
        if (ev.code === "sign-in-required" || ev.code === "not-a-member") process.exit(1);
        if (/too many messages/i.test(String(ev.message)) && this.lastSent && this.lastSent.tries < 5) {
          const again = { ...this.lastSent, tries: this.lastSent.tries + 1 };
          this.sendGapMs = Math.min(2000, (this.sendGapMs || 350) * 2);
          setTimeout(() => { this.queue.unshift(again); this.pump(); }, 1500);
        }
        return;
      case "STATE_SNAPSHOT":
        this.state = ev.snapshot?.cardsById ? ev.snapshot : { cardsById: ev.snapshot || {} };
        for (const id of Object.keys(this.state.cardsById)) this.seen.add(id);
        this.ready = true;
        this.log(`joined ${this.orgId} as ${this.userId}: ${this.seen.size} cards in snapshot`);
        this.onSnapshot?.(this.state);
        return;
      case "STATE_DELTA": {
        const before = new Set(Object.keys(this.state.cardsById));
        // A decision arrives as a state patch (the card gains `decision`);
        // the TOOL_CALL_RESULT echo only accompanies answers that named
        // their tool call. So decisions are noticed here, by comparison.
        const decidedBefore = new Map(Object.entries(this.state.cardsById).map(([id, c]) => [id, c.decision?.action || null]));
        applyPatch(this.state, ev.delta || []);
        for (const [id, card] of Object.entries(this.state.cardsById)) {
          if (!before.has(id) && !this.seen.has(id)) {
            this.seen.add(id);
            if (card.recipientUserID === this.userId && !card.decision?.action) this.onCard?.(card);
            continue;
          }
          const now = card.decision?.action || null;
          if (now && now !== decidedBefore.get(id) && card.recipientUserID === this.userId && !this.decided.has(`${id}:${now}`)) {
            this.decided.add(`${id}:${now}`);
            this.onDecision?.(card, card.decision);
          }
        }
        return;
      }
      case "TOOL_CALL_RESULT": {
        // { toolCallId, content: JSON string of the decision } — the relay echoes
        // every decision in the org. We act on decisions for cards we enriched.
        let content = ev.content;
        try { content = typeof content === "string" ? JSON.parse(content) : content; } catch {}
        const cardId = content?.cardId || content?.id;
        const card = cardId ? this.state.cardsById[cardId] : undefined;
        const action = content?.action || content?.decision?.action || card?.decision?.action;
        if (card && action && card.recipientUserID === this.userId && !this.decided.has(`${cardId}:${action}`)) {
          this.decided.add(`${cardId}:${action}`);
          this.onDecision?.(card, { ...(card.decision || {}), action });
        }
        return;
      }
      default:
        return;
    }
  }

  // Every message goes through one queue, spaced out, so a burst of evidence
  // steps never trips the relay's per-socket rate limit and drops the last,
  // most important, write. A message the relay refuses for pace is retried.
  send(type, payload) {
    this.queue ||= [];
    this.queue.push({ type, payload, tries: 0 });
    this.pump();
  }

  pump() {
    if (this.pumping || !this.queue?.length) return;
    this.pumping = true;
    const next = () => {
      const msg = this.queue.shift();
      if (!msg) { this.pumping = false; return; }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastSent = msg;
        this.ws.send(JSON.stringify({ type: msg.type, payload: msg.payload }));
      } else {
        this.queue.unshift(msg);
        this.pumping = false;
        return;
      }
      setTimeout(next, this.sendGapMs || 350);
    };
    next();
  }

  // The latest evidence for a card wins: writes for the same card that are
  // still waiting in the queue are replaced, not appended.
  sendLatest(type, payload, key) {
    this.queue ||= [];
    const i = this.queue.findIndex((m) => m.key === key);
    const msg = { type, payload, key, tries: 0 };
    if (i >= 0) this.queue[i] = msg; else this.queue.push(msg);
    this.pump();
  }

  // Attach evidence to a card we own. The whole card is re-sent (the relay
  // persists data as JSON, unknown fields survive) plus the context line the
  // existing UI already renders as bullets when split on " · ".
  attachEvidence(card, evidence, contextBits = []) {
    const latest = this.state.cardsById[card.id] || card;
    const baseContext = (latest.context || "").split(/\s+·\s+/).filter((s) => !s.startsWith("[agent]"));
    const context = [...baseContext, ...contextBits.map((b) => `[agent] ${b}`)].join(" · ");
    const updated = { ...latest, context, evidence: { ...(latest.evidence || {}), ...evidence } };
    // Keep our own state current so the next write builds on this one even
    // before the relay echoes it back.
    this.state.cardsById[card.id] = updated;
    this.sendLatest("card_updated", { card: updated }, `card:${card.id}`);
    return updated;
  }

  // A brand-new card, from this user's AI, to someone else (e.g. the original sender).
  createCard({ recipientUserID, type = "notification", title, summary, context = "", priority = "medium", business, labels }) {
    const card = {
      id: `card-${crypto.randomUUID()}`,
      recipientUserID,
      senderUserID: this.userId,
      type, title, summary, context, priority,
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(business ? { business } : {}),
      ...(labels ? { labels } : {}),
      routingReason: "Result of an executed decision",
      agentRoute: `${this.userId}'s AI → ${recipientUserID}'s AI`,
    };
    this.send("card_created", { card });
    return card;
  }

  // This agent's own status, as the user's context: `/context/<user>` on
  // every client's state. It is how the fleet view knows what each teammate's
  // AI is doing on which machine.
  sendContext(context) {
    this.sendLatest("context_updated", { context }, "context");
  }

  async members() {
    const r = await fetch(`${env("RELAY_HTTP")}/members?orgId=${encodeURIComponent(this.orgId)}`, {
      headers: { "x-session-token": env("AGENT_SESSION_TOKEN") },
    });
    if (!r.ok) throw new Error(`GET /members ${r.status}`);
    return r.json();
  }
}
