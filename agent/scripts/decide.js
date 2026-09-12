// Decide a card as the configured user, the way a feed client does (tool_result).
//   node scripts/decide.js <cardId> approve|decline
import "../src/env.js";
import { Relay } from "../src/relay.js";
const [cardId, action = "approve"] = process.argv.slice(2);
const relay = new Relay({ log: () => {} });
relay.onSnapshot = () => {
  relay.send("tool_result", { content: { cardId, action, actorUserID: relay.userId, decidedAt: new Date().toISOString() } });
  console.log(action, cardId, "as", relay.userId);
  setTimeout(() => process.exit(0), 1500);
};
relay.connect();
