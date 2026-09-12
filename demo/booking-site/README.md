# Hotel Sakura — booking site

The booking site for Hotel Sakura, one of the businesses a small team runs.
Kept deliberately small: no dependencies, `node --test`, a single page.

```bash
npm test          # 12 tests, about a second
npm run dev       # http://localhost:3000
```

- `src/pricing.js` — rates, tax, and how a price is displayed (`PRICE_DISPLAY`)
- `src/rooms.js` — the rooms and a quote
- `src/payments.js` — what a guest can pay with
- `src/render.js` — the page
