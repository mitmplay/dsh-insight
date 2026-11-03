# Reference — Driving a Glass Over Raw CDP (the orphaned-glass DO-path)

Companion to SKILL.md. Read when the `mcp__glass-browser__browser_*`
tools cannot reach the glass you need (brain re-homed, preset entry
stale) or when you need evidence the MCP tools cannot produce (stack
traces, per-frame scroll curves, wire-call counts). The KB companion
(`dev/feature-contract-scenario/glass-browser-verification.md`,
"2026-10-28 additions II") carries the WHY; this file is the HOW, every
pattern battle-tested 2026-10-28 on the operator's own glass (port 9400,
three session ids, one investigation — the floor-steal RCA).

## 0. The rules that outrank every pattern

1. **NO NESTING.** Never open the host DSI inside a glass tab to "drive
   the GUI". The host GUI's gestures belong to the OPERATOR; you verify
   effects through the glass CDP and ask the operator to click. (Operator
   correction 2026-10-28: "do not nest DSI".)
2. **A re-homed glass is not dead.** `mcpHealth: "down", mcpError:
   "brain re-homed to a newer glass"` means the MCP tools left — the
   chromium and its CDP port are still fully alive and still may be the
   browser the operator's panel mirrors.
3. **Re-resolve the port every session.** `GET /api/browser` rows carry
   `port`; the registry cycles whenever the operator re-chips. A
   hardcoded port verifies a ghost.
4. **Instrument BEFORE the gesture.** A counter armed after the click
   proves nothing.

## 1. Resolve the target

```sh
curl -s http://127.0.0.1:5175/api/browser
# → {"sessions":[{"id":"…","port":9400,"mcpHealth":"…"}]}
curl -s http://127.0.0.1:<port>/json/list
```

Pick the DSI-under-test page: `type === "page"`, URL contains
`127.0.0.1:5175`. Its `title` is the FOCUSED SESSION's name — DSI sets
`document.title` to it, so the title flipping IS a focus probe. Ignore
`browser_ui` rows (Omnibox Popup) and the `data:text/html` placeholder.

## 2. Connect (playwright-core over CDP — real input, real pages)

```js
import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
const page = browser.contexts()[0].pages().find(p => p.url().includes('5175'));
```

This gives real `locator.click()` gestures (pointerdown included — the
activation verb) and `page.evaluate` into the live page. Raw-CDP
alternatives for the same doors: `Runtime.evaluate` (+`userGesture:
true`), `Input.dispatchMouseEvent/KeyEvent`, `Page.captureScreenshot`.

## 3. Arm the instrumentation (one `page.evaluate`, before acting)

```js
await page.evaluate(() => {
  window.__ev = []; window.__sl = [];
  const vp = document.querySelector('[data-testid=panels-viewport]');
  // (a) rAF scroll sampler — CDP round-trips miss the smooth-scroll curve
  let last = vp.scrollLeft;
  const sample = () => { const s = vp.scrollLeft;
    if (s !== last) { last = s; window.__sl.push({ t: Math.round(performance.now()), sl: Math.round(s * 10) / 10 }); }
    requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
  const proto = Element.prototype;
  // (b) scroll watches with STACKS — the stack frame names the guilty component
  if (!proto.__watched) { proto.__watched = true;
    const siv = proto.scrollIntoView, sto = proto.scrollTo;
    proto.scrollIntoView = function (...a) {
      if (this.closest('[data-testid=panels-viewport]'))
        window.__ev.push({ t: Math.round(performance.now()), kind: 'scrollIntoView',
          d: (this.getAttribute?.('data-testid') ?? this.tagName),
          stack: new Error().stack.split('\n')[2]?.trim() });
      return siv.apply(this, a); };
    proto.scrollTo = function (...a) {
      if (this.matches?.('[data-testid=panels-viewport]'))
        window.__ev.push({ t: Math.round(performance.now()), kind: 'floor.scrollTo', d: JSON.stringify(a[0]) });
      return sto.apply(this, a); }; }
  // (c) fetch shim — negative evidence (zero POSTs) kills hypotheses
  if (!window.__fw) { window.__fw = true; const of_ = window.fetch;
    window.fetch = function (...a) {
      const u = String(a[0]);
      if (u.includes('/viewport') || u.includes('/activate') || u.includes('/tabs'))
        window.__ev.push({ t: Math.round(performance.now()), kind: 'fetch', d: u.split('/').pop() });
      return of_.apply(this, a); }; }
  // (d) selection timestamps
  new MutationObserver(() => window.__ev.push({ t: Math.round(performance.now()), kind: 'selection' }))
    .observe(document.querySelector('[data-testid=panels-row]'), { attributes: true, attributeFilter: ['class'], subtree: true });
});
```

Notes: arm once (the `__watched`/`__fw` guards) — HMR reloads wipe
everything and the guards re-arm cleanly; the stack slice `[2]` is the
first APP frame (skip the wrapper).

## 4. Gesture, then read the verdict

Perform the REAL gesture (`locator.click()` on the panel header), wait
OUT past at least one poll cadence (the tabs poll is 2000 ms — a 2s wait
verifies nothing), then:

```js
const out = await page.evaluate(() => ({
  sl: document.querySelector('[data-testid=panels-viewport]').scrollLeft,
  sel: document.querySelector('.panels-row [data-testid=panel-column].selected')
        ?.getBoundingClientRect().toJSON(),
  vp:  document.querySelector('[data-testid=panels-viewport]').getBoundingClientRect().toJSON(),
  ev: window.__ev, samples: window.__sl }));
```

Verdict = NUMBERS: selected rect fully inside viewport rect? scroll trace
monotonic (reveal settles) or snapped back (a steal)? which stack frames
appear? Report before/after pairs and the gates passed; adjectives are not
verification.

## 5. Geometry facts that bite

- The floor viewport's left edge is NOT page x=0 (the sidebar rail sits
  left of it) — compare column rects against `panels-viewport`'s OWN
  rect, never against the page.
- `getBoundingClientRect` is transform-true (zoom included); `clientWidth`
  is layout px. At floor zoom ≠ 1 the two disagree — use the rect.
- A 12px glass resize you did not cause is usually the mirror's
  viewport-sync, not your gesture — check the fetch shim before claiming it.

## 6. Worked example

The full live trace that convicted the tab-strip floor steal (instrument
→ gesture → stack frame → fix → re-trace) is in
`dev/kb/rca/2026-10-28 - RCA — The Tab Chip That Rearranged the Room
(A Strip's Scroll Walked Into the Floor).md`.
