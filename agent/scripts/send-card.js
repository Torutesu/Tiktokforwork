// Send one Decision Card into the org as the configured user, for testing.
//   AGENT_USER_ID=<login> AGENT_SESSION_TOKEN=<token> node scripts/send-card.js <recipient login> "<title>" "<summary>"
import "../src/env.js";
import { Relay } from "../src/relay.js";
const [recipient, title, summary = "", business = ""] = process.argv.slice(2);
if (!recipient || !title) { console.error("usage: send-card.js <recipient> <title> [summary] [business]"); process.exit(1); }
const relay = new Relay({ log: console.log });
relay.onSnapshot = () => {
  const card = relay.createCard({ recipientUserID: recipient, type: "approval", title, summary, priority: "high", context: `Repository: ${process.env.TARGET_REPO || "-"}`, ...(business ? { business } : {}) });
  console.log("sent", card.id, "→", recipient);
  setTimeout(() => process.exit(0), 1500);
};
relay.connect();
