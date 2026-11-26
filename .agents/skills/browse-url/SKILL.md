---
name: browse-url
description: "Open and drive an ARBITRARY URL in a NEW tab of the operator's REAL Chrome via @opencode/browse (mcp__browse__* tools): search, click, screenshot, read, with their logins, in a named Chrome profile. Use when the prompt says my Chrome, real browser, logged in as me, a Chrome profile name, asks to add, pair or switch one, or names no browser while mcp__browse__* tools are held. NOT for a glass panel (glass-url, glass-dsi) or setup (dsi-browse-setup). Reserved keyword /browse-url."
---

# browse-url — drive a URL in the operator's real Chrome

Companion KB: `dev/feature-contract-scenario/browser-driver-dispatch.md`
(the why, with a source for every rule below). Siblings: `glass-url` (a
disposable browser in a glass panel), `glass-dsi` (verify DSI work),
`dsi-browse-setup` (install, wiring, the first pairing).

## The dispatch rule — one question, asked in two steps

**Before any browser work, decide the driver. Say the choice in one line
when the prompt left it open.**

1. **Which browser tools does this session hold?** Only that makes a driver
   available.
   - `mcp__browse__*` held → browse is available (this skill).
   - `mcp__glass-browser__browser_*` held → glass-by-tools is available.
   - Neither → browse is not wired (`dsi-browse-setup`), and glass is
     reachable only by the `glass-url` scripts after the operator opens a
     panel. Say so; do not work around it.
2. **What does the prompt ask for?**

| The prompt says | Skill |
|---|---|
| my Chrome, real browser, logged in as me, my tabs, a Chrome profile name, or a login the page needs | `browse-url` (this skill) |
| a URL and nothing else, in a session that holds only `mcp__browse__*` | `browse-url`: the only driver there |
| glass, a glass panel, a disposable browser | `glass-url` (needs a panel: the operator's Browser chip) |
| the DSI workspace, "verify it live on the glass" | `glass-dsi` |
| both drivers held and nothing said | ask once which browser; do not guess (KB Q6) |
| no browser connected, or a call fails "not paired" | `dsi-browse-setup` |

## Rule 1 — this is the operator, not a sandbox

The tab carries their logins, their sessions, their name. Sort the task
before the first tab:

- **Free:** open, search, read, scroll, screenshot.
- **Hand back to the operator:** anything that needs them: login, 2FA,
  captcha, payment, a bot challenge. `handoff(...)` inside `execute`, or
  stop and ask. Never solve or retry-loop a challenge.
- **Ask first, in the conversation:** anything that cannot be taken back or
  is done in their name: send, post, submit, buy, delete, change an account
  or a setting. One sentence on what will happen, then wait for the OK.

## Rule 2 — name the browser on every tab

Browse's default browser is "the first connected one". It is not a setting,
and with two profiles paired it was the older pairing (KB C8). So:

- **Always pass `browser` on `tabs new`.**
- **Which one:** read `~/.dsi/resources/browse-profiles.json`. Use the
  profile the prompt names (match `chromeName`, then `alias`, then
  `chromeDir`); names that differ only by case must match exactly, and if
  two profiles fit, ask. No profile named → `defaultAlias`.
- **The registry is a name map, not the truth about pairing.** Check the id
  against `mcp__browse__status` before using it.
- **A different profile is a different human identity.** If the wanted
  profile is missing there, or its entry has `browser: null`, do not fall
  back to another one on your own: say which profile is missing and go to
  "Add or switch a Chrome profile" below.

## The flow — inspect, act, verify

**Between calls, re-check `tabs list`.** A tab is yours only while you
are the one using it. If its URL is not one you navigated to, or a new tab
appeared with yours as its `opener`, the operator has taken it: stop
driving it, do not close it, keep it, and ask what they want done with
it. Keep it by opening the same `id` again with `keepOpen: true`: the
reply says `existed: true` and nothing is navigated (2026-11-26, 18:02).
Without that, browse closes the tab once no call has used it for a
while, and that clock counts agent calls, not the operator's reading.
(2026-11-26, 17:57: four seconds after one call, a tab this skill opened
was on a blog article; the next call navigated it away.)

1. **Status first.** `mcp__browse__status`. No browser connected → hand off
   (`dsi-browse-setup` Gate 4: one code). Stop.
2. **Open one tab, named.** `mcp__browse__tabs` with `action: "new"`, an
   `id` of your own (lowercase, digits, dashes), the `browser`, the `url`.
   The reply echoes `browser`: if it is not the id you passed, stop and
   report.
3. **Fingerprint.** The first read is the liveness check: the title and the
   first line of body text. A page can keep its title and still refuse
   you: Hacker News answered "Sorry, we're not able to serve your requests
   this quickly." under the title "Hacker News" (2026-11-26, 17:57). A
   failed site is not a failed browser: if a site fails to load or answers
   with a refusal, try once on a second site; two failures → stop and
   report. Never click the page's own reload to get past a refusal.
4. **Inspect before choosing.** In `mcp__browse__execute` with `tab`:
   `snapshot()` gives refs (`ref("e12")`), then `getByRole(...)`, then CSS.
5. **Act, then verify with a fresh read**: `page.url()`, `page.title()`, a
   new snapshot. A click that returned is not proof.
6. **Close what you opened.** `mcp__browse__tabs` with `action: "close"`.
   Never drive or close a tab marked `lent`, one the operator took, or one
   you did not open, unless asked.

```js
// read (tolerant of pages without a <main>)
return { url: page.url(), title: await page.title(), text: await page.evaluate(() => document.body.innerText.slice(0, 2000)) };
// see what is on the page: comes back as an outline with refs
return await snapshot();
// act on a ref, then verify with a fresh read
await ref('e12').click(); return { url: page.url(), title: await page.title() };
// screenshot
return await page.screenshot();
```

## Add or switch a Chrome profile

Browse cannot tell you which Chrome profile a browser is: it refuses
`chrome://` pages (KB C12). A profile is known only from the pairing handoff,
and it is written down in the registry.

**Add ("mint") — one code per run, typed in by the operator:**

1. **Find the folder from Local State, not from the registry.** The
   registry's `chromeDir` is a guess written down once from what the
   operator said; Chrome's own `Local State` is the truth about which
   folder a profile name lives in. Read
   `~/Library/Application Support/Google/Chrome/Local State`, key
   `profile.info_cache`, and match the wanted profile name there first.
   If it disagrees with the registry's `chromeDir`, fix the registry entry
   and say so — before probing anything.
2. **The profile must have the browse extension — probe the folder Local
   State named.** Check
   `~/Library/Application Support/Google/Chrome/<chromeDir>/Extensions/mfnicocicmmlkpjnaffgihfjhdgjkdjg`.
   A failed check on a guessed path diagnoses the guess, not the thing:
   `ls` failing means *that folder* has no extension, never *the named
   profile* has none. Before reporting "not installed", `find` the
   extension id across all profile folders (`find
   "~/Library/Application Support/Google/Chrome" -maxdepth 3 -name
   mfnicocicmmlkpjnaffgihfjhdgjkdjg`) and name which folder you probed and
   which profile it actually belongs to (2026-11-26: the registry said
   `wharsojo → Profile 3`; Local State said `Profile 2 = wharsojo`,
   `Profile 3 = wharsojo.dev` — one `ls` on the wrong folder produced a
   firm "not installed"). Missing for real → `browse extension` says
   where to get it; the operator installs it in that profile.
3. **Mint once, in the background:** `browse pair --wait-seconds 600`.
4. **Hand the code over** with the steps: Extensions menu → browse →
   Options → "Pair with a code" → the code → Connect. Ask the operator to
   name the profile they used.
5. **Collect the job.** Exit 0 and `✓ Paired Chrome on <name>` → continue.
   Exit 1 and `! Pairing not confirmed` → the ten minutes ran out: stop
   and report. A new code is a new run.
6. **Verify.** `browse pair --list` shows a new row; `mcp__browse__status`
   lists it as connected.
7. **Record it.** Fill or add the registry entry: `alias`, `chromeName`,
   `chromeDir`, `browser`, `paired`. This is the only place the name is
   written down.
8. **Prove it.** Open one tab with that `browser` and ask the operator
   which window it appeared in.

**Switch:**

- **For one request:** use that profile's `browser` id (Rule 2).
- **For good:** set `defaultAlias` in the registry. To change the default,
  never revoke other profiles: a revoke costs that profile a new pairing.

**Remove:** `browse pair --revoke <id>`, then set `browser` to `null` in the
entry. Say the cost first, and never revoke unasked.

## Traps (each cost a round on 2026-11-26)

- `browse pair --help` is not help: it starts a real pairing wait. Only
  `<tool> --help` is.
- `chrome://` pages are refused.
- Browse's default is "first connected" (Rule 2).
- A failed site is not a failed browser, and a refusal can keep its title
  (flow step 3).
- The operator can take your tab between two calls: re-check `tabs list`
  before the next one.
- The registry says paired and `status` says not connected: that profile's
  Chrome is closed or asleep. Ask the operator to open it.
- A registry note from an earlier session that agrees with your fresh wrong
  probe is the same mistake written down, not corroboration (2026-11-26: the
  "no browse extension" note and the failed `ls` were one error twice).
- A failed check on a guessed path diagnoses the guess: report which folder
  you probed and which profile it actually is, never "not installed in
  <profile>" from one `ls` (mint step 1-2).

## Stop-loss

- **A refusal is an answer:** handoff, refused navigation, expired code, a
  browser that is not connected. Report and stop.
- **One pairing attempt per run. One second site after a failed load.**
- **The goal met is done:** report in words; no extra tab "to be sure".
- **Tabs:** close what you opened.

## Report

Which profile and tab ids you opened, what you read (verbatim), what you
clicked, what you closed, and any tab you left open and why. Say anything
you did not verify.
