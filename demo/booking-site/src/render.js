import { ROOMS } from './rooms.js';
import { displayPrice } from './pricing.js';
import { enabledMethods } from './payments.js';

export function page() {
  const rooms = ROOMS.map((r) => {
    const p = displayPrice(r.rate);
    return `<li class="room"><h3>${r.name}</h3><p class="price">${p.text} / night</p><p class="meta">up to ${r.guests} guests</p></li>`;
  }).join('\n');
  const pay = enabledMethods().map((m) => `<li>${m.name}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hotel Sakura · Book a room</title>
<style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:0;background:#faf7f2;color:#2b2320}
header{padding:32px 24px 8px}h1{margin:0;font-weight:600;letter-spacing:-.02em}
.rooms{list-style:none;padding:0 24px;display:grid;gap:12px;max-width:720px}
.room{background:#fff;border:1px solid #eee5dc;border-radius:14px;padding:16px 18px}
.room h3{margin:0 0 6px;font-weight:600}.price{margin:0;font-size:18px;color:#b3473b}.meta{margin:4px 0 0;color:#8a7f78;font-size:13px}
.pay{padding:8px 24px 40px;color:#8a7f78;font-size:13px}.pay ul{display:inline;padding:0;list-style:none}.pay li{display:inline;margin-right:10px}
</style></head><body>
<header><h1>Hotel Sakura</h1><p>Book a room · 桜ホテル</p></header>
<ul class="rooms">
${rooms}
</ul>
<section class="pay">Pay with: <ul>${pay}</ul></section>
</body></html>`;
}
