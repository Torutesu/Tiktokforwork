// Drives the scripted demo (?demo) in a phone-sized Chromium, records a video
// and saves the screenshots the README and the deck use.
//   node scripts/demo-capture.mjs http://localhost:4173 ../docs/media
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2] || 'http://localhost:4173'
const out = process.argv[3] || '../docs/media'
mkdirSync(out, { recursive: true })
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
  recordVideo: { dir: out, size: { width: 430, height: 900 } },
})
const page = await context.newPage()
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) })
const wait = (ms) => page.waitForTimeout(ms)

await page.goto(`${base}/?demo`, { waitUntil: 'networkidle' })
await wait(900)
await shot('01-empty-feed')
await wait(1400)                       // the card lands
await shot('02-card-arrives')
await wait(2600)                       // graph answered, sandbox up
await shot('03-evidence-running')
await wait(4800)                       // tests ran
await shot('04-evidence-done')
await page.getByRole('button', { name: /team's AIs/i }).click()
await wait(600)
await shot('04b-fleet')
await page.getByRole('button', { name: /close/i }).first().click()
await wait(500)
await page.getByRole('button', { name: /approve/i }).first().click()
await wait(2600)                       // pushed, PR open
await shot('05-approved-pr-open')
await wait(3500)                       // the next request arrives, already knowing the first
await shot('06-second-card')
await wait(7000)
await shot('07-second-evidence')
await wait(1200)

await context.close()
await browser.close()
for (const f of readdirSync(out)) if (f.endsWith('.webm') && f !== 'demo.webm') renameSync(join(out, f), join(out, 'demo.webm'))
console.log('captured into', out)
