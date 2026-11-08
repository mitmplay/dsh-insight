## 0.11.1

Bumped from 0.11.0 — the Glass Brain learns to live away from home: env renames become operator-addressable (`GLASS_BRAIN_URL`) and the browser window is born where the operator's screen is (`GLASS_CHASSIS_URL`), plus a chassis parity fix series proven live from a VM floor.

### Features
- **GLASS_BRAIN_URL rename + operator override** — the brain MCP address is now an explicit env knob instead of a port guess: `GLASS_BRAIN_URL` replaces the port-name plumbing, with the operator able to override where the glass dials the brain (D1-D4). ADR + spec + feat: commits `101cb945`, `a60b2a4e`, `e2c056d3`; README explains the brain-vs-chassis split.
- **GLASS_CHASSIS_URL — the window is born where the operator's screen is (ADR-0054, Wave 1, D1-D5)** — a remote floor (e.g. a VM over the OrbStack bridge) opens its glass on the operator's own screen: the floor dials a chassis address carried in `GLASS_CHASSIS_URL` instead of birthing a local window; the cdpTarget is rooted at the address the floor dialed (request `Host`), since bind is often loopback — the wrong machine for a remote floor (live witness: ECONNREFUSED from the VM). Commits `4fb24fca` (ADR-0054 + spec + RCA), `a582fdcb` (feat), `d71d7894` (Host-rooted target), `2265af08` (README stamps docs), `ca231e36` (Glass Brain Address scenario flipped: brain on the host, VM floors dial it brain-less).
- **Skill: dsi-host-drive** — drive the HOST floor's terminal from a VM floor over the OrbStack bridge (the Glass Chassis drive, earned 2026-11-08), commit `2b2c0204`.

### Bug fixes
- **Plain click stays headless; only Shift+click births a visible window** — operator correction 2026-11-08: headless rides the `/open` body instead of opening a window on every plain click — commit `225ace91`.
- **Mask HeadlessChrome UA on headless births** — anti-bot parity with the registry's PLAIN_IDENTITY; Google captcha'd the first VM plain click — commit `70df786f`.
- **Pin the headless viewport to the requested box** — the mirror was cut off at the bottom; ADR-0041 viewport parity now carries across the machine boundary — commit `fe49bdbb`.
- **Pin headless emulation to the panel box at every attach** — the mirror letterboxed when `defaultViewport` missed the remote context (ADR-0041 contract, deterministic) — commit `0d272722`.
- **Truthful headless/headedOpen birth flags** — plain clicks took the headed resize path (window bounds on a nonexistent window) and the mirror never tracked the panel box — commit `2735bb22`.
- **Prompt DB hygiene** — VACUUM on `template/prompts.sqlite` reclaims freelist pages after test-incident cleanup (53 rows intact, integrity ok) — commit `2b3e5598`.

### Docs & tests
- Token spend report — 29.7M tok, the host drive re-billed every keystroke (`b4ebe6f6`); ADR-0054 flipped to Accepted with the live-witness amendment restored plus four post-witness chassis fixes folded into completion notes (`01412721`, `0bc728c1`); coverage sweep raised the 10 lowest-covered files to 100%/near-100% lines (global 98.2% → 98.35% lines) — commit `0460b30b`; README CLI-ports scenario (`713064bf`).
## 0.11.0

Bumped from 0.10.2 — the port env names say what they mean: `DSI_PORT` for the UI, `GLASS_PORT` for the brain MCP, and a new `DSH_PORT` for the host. Clean break, no legacy names.

### Features
- **Port env rename: `PORT`→`DSI_PORT`, `DSI_MCP_PORT`→`GLASS_PORT`, new `DSH_PORT`** — the launcher's port knobs are renamed to name their surface: `DSI_PORT` (UI, default 5174 build / 5175 dev), `GLASS_PORT` (brain MCP SSE, default 9515, read in `bin/dsi.mjs` and `src/lib/server/browser/registry.ts`), and `DSH_PORT` (host, default 3080) as the env form of `--port` — the `--port` CLI flag wins when both are set, and `DSH_PORT` is forwarded to `dsh web` as `--port` when no flag is given. Old names are ignored (clean break, no back-compat). The Stamped Floor stamps are unchanged (`DSI_UI` / `DSI_MCP_URL` still carry the new ports). Pins: `tests/unit/stamped-floor.test.ts`, `browser-registry-config.test.ts`, `dsi-cli.test.ts`, `dsi-plugin-chain.test.ts` (new: `DSI_PORT=6191` beats legacy `PORT=6190`). README port table + example updated; design doc `docs/superpowers/specs/2026-11-08-port-env-rename-design.md`; ADR amendment in the Stamped Floor note. Commit `fc0a78db`.

### Bug fixes
- **The Probe Floor That Reached Through the Glass (RCA 2026-11-08)** — a verification floor booted with `--playwright-mcp` fired the launcher's `openBrowser` into the operator's real Chrome, and a pattern-kill teardown then severed endpoints mid-flight, erroring 15 tabs. RCA under `dev/kb/rca/2026-11-08 - RCA — The Probe Floor That Reached Through the Glass ….md`: 5-Why, flow + sequence diagrams, carry-forward rules (probe floors boot browser-less and glass-less with `--no-open`; never pattern-kill without enumerating pids; `DSI_HEADLESS_VERIFY=1` idea deferred). RCA note committed with this release, no code change.

## 0.10.2

Bumped from 0.10.1 — the fresh-install seed finally lands: the shipped prompts DB is self-contained and a partial `~/.dsi` home gets topped up instead of skipped.

### Bug fixes
- **The empty prompts DB on fresh install (RCA 2026-11-08)** — a fresh `npx @deepseek-insight/dsi dsh --sync` cloned `template/.dsi/prompts.sqlite` with 0/49 prompts: the seed data lived in a 4.1MB WAL sidecar, so a clone of the main DB file alone landed empty. Fix: WAL checkpointed into the seed DB (356KB, self-contained, `-wal`/`-shm` removed) — `template/.dsi/prompts.sqlite`, commit `cdddae3f`.
- **Partial home seed skipped** — the first-start clone (`ensureDsiHome`) only fired when `~/.dsi` was wholly absent; a home partially created earlier (e.g. `settings.yaml` seeded by the CLI before the server started) never received the prompts DB. Fix: top up missing template files into a partial home instead of skipping — `6cf93471` (dsi dsh --sync race, 0/49 prompts RCA).
- **README Quick Start table** — the argument table used `|-|-|-|` rows as a fake header and rendered broken; replaced with a proper `| Argument | What it does |` header — `1c28b428`.

## 0.10.1

Bumped from 0.10.0 — the borrowed Chrome is dead and buried: Shift+Click now opens a HEADED disposable glass, and every path that could point the close at home is audited, guarded, or deleted.

### Features
- **The Headed Downgrade (ADR-0047 retirement amendment)** — Shift+Click opens a VISIBLE glass on a fresh disposable profile (`headless:false`, `~/.dsi/browser-profiles/<id>`); plain opens byte-identical; boot restore never headed. The whole borrow surface is REMOVED: the consent dialog and the DSI-in-Chrome detection are gone (nothing to consent to), the wire renames `borrowProfile`→`headedOpen` across route/types/factories/chrome/resolver/panel/page, `borrow.ts` is deleted with a zero-code-reference gate, and i18n swaps `browserBorrow*` for one `browserHeadedHint` ×4 locales. A headed disposable glass is reaped and killed exactly like any glass — the reaper exemption and the close detach branch are deleted (today-for-today). Pins: `tests/unit/headed-{launch,lifecycle,wire,chip}.test.ts` (18) + rewritten `browser-button-shift.test.ts`; deletion audit grep clean; live-verified on the operator's glass (headedOpen:true, visible window, host Chrome untouched). `4e6be962`, `7f1df7a9`; completion notes under `dev/specs/2026-11/2026-11-05 - The Headed Downgrade/`.

### Bug fixes
- **The Borrowed Wipe — deletion-path hardening (RCA 2026-11-05)** — the borrowed close's `rmSync` met the host Chrome root via a pre-guard code path (9 profiles lost). Three fixes: the DATA-LOSS PATH GUARD — rmSync is only legal inside the disposable profile root, guarded by PATH not flag (`3b26b179`); the owner marker so a boot sweep can tell a LIVE session from an orphan (inside `7f1df7a9`); the deletion-path audit appendix verifying all 3 rmSync sites + kill sites target DSI-spawned pids only (`8f1f04d1`). The full failure chain, retractions, and the sole recovery route (per-account Sync) live in the RCA note.

### Dev notes
- ADR-0047 amendment + ADR-0046 cancellation recorded (`d85c7430`); spec folder with Karpathy context, PRD, Tasks (`4e6be962`); follow-up recorded: config sanity check on profileRoot.

## 0.10.0

Bumped from 0.9.1 — the terminal that heals itself: a refused write re-mints and climbs back, xterm selection survives zoom, the desk badges tell the truth, and driving the live terminal became a house skill.

### Features
- **The token auto-heal** — a refused terminal write (stale token) no longer drops the keystrokes: the write route re-mints the token via reattach, retries the SAME write once, and the output stream climbs back — never retries blind, never re-mints in a loop. The operator's tab heals identically (their first key shows the heal badge); watching stays token-free. `576833a3`.
- **The Terminal Zoom Pocket (ADR-0041 Amendment 3)** — zoom-honest selection for xterm: the pocket is `inset-0 scale(1/zoom)` with pre-multiplied layout, `fontSize×zoom`, and refit — selection rectangles land on the glyphs at any floor zoom, no counter-scaling inside the pocket. Unit + e2e pins (`370eea1e`, corrected by `897712b1`); design + spec (`d27e3768`, `962482bd`, `d631faf9`); completion notes (`244356a7`).
- **Truthful desk badges + the HMR lease** — desk tab badges name their session (`T{position}:{id}`, splits join with `+`, unassigned tabs show plain `Tn`), killing the drive-by-tab-position trap; the HMR lease keeps terminal sessions alive through dev hot swaps. `95b3bc99`.
- **`dsi-drive-terminal` as a house skill** — KB note (`dev/feature-contract-scenario/terminal-driving.md`), the skill reframed to the house pattern, and an AGENTS.md pointer: baton law, human-pace typing, ring reads, silent-eater escapes. `7aa4d3ae`, `10c11de5`.

### Dev notes
- RCA: the home-dir pnpm shadow (PATH ordering) + new `dsi-publish` skill. `3e74ed63`.
- Install orb notes: extra packages, global pnpm; webVersion 0.2.2-rc.1. `42f16f73`.

## 0.9.1

Bumped from 0.9.0 — the first-run patch: a fresh machine's very first `dsi dsh --sync` keeps its launch token.

### Bug fixes
- **First-run ENOENT lost the launch token** — on a fresh machine the token watcher (`scripts/dsh-web-synced.sh` `update_token`) read `~/.dsi/settings.yaml` before anything created it: raw `readFileSync` ENOENT stack, `WARNING — token capture failed`, unauthenticated first click (a second run worked, hiding the bug). Two fixes (ADR-0050 D1/D2): the CLI seeds the config before any child spawns — `ensureDsiConfig()` clones `template/.dsi/settings.yaml` (`DSI_TEMPLATE_PATH`-aware, degrade `{}`, never touches an existing file) at the top of `runSyncedPair`; the watcher treats a missing file as the create case (`mkdirSync` + fresh `dsh.authToken`), same contract as the in-process sink, while a present-but-unparseable file still fails loud (D3). `eac47cf1`; regression tests in `tests/unit/dsi-cli.test.ts` (3 functional `update_token` runs — missing file incl. nested dir, merge preserving siblings, unparseable untouched — plus structural seed pins), 13/13 green.

### Dev notes
- Install orb transcript under `dev/orb/` (`install.txt`, `test-run.txt`). `4060c1e9`.

## 0.9.0

Bumped from 0.8.5 — the minor release of the glass year: the Alt+S chord palette gives the floor a verb layer, glass tabs get chrome-parity identity and UX, the plugin rack and workspace surfaces grow up, and the CLI's `--zai` bootstrap writes where DSH actually reads.

### Features
- **The Alt+S Chord Palette (ADR-0006a amendments 3–5, D12–D21)** — capture-first Alt+S opens a centered verb palette (10s decay bar, green action / yellow idle): `a` sweeps workspace explorers, `b`/'c`/'p`/'t`/'w` floor verbs, `s` toggles the AppSidebar (D19), `n` spawns the focused session's sibling below it with inherited access mode (D20, `POST /permission` on the newborn — session.create carries no permission knobs), `g`/'k` toggle the managers. Round 2 capture-phase fix: the chord hears keys xterm swallows (D17). ADR-0006a ext 4–6: sweeps plugin-rack + skill-shelf, two-dial sidebar lanes `panel.sidebar.{state,width}`, the dial grammar — every preset kind nests its width dial. `03ab4fbc`, `d2d5cbab`, `589f94b3`, `38191dda`, `26fbee9e`, `ea7cfcaa`, `c0cf098d`, `3f8b8c6c`, `8b90a974`, `0335062d`, `aba73522`.
- **Glass tab IDs & panel UX rework (ADR-0040 am 3, spec 87ded718)** — registry-owned ordinal tab ids (mint/heal-preserve/retire, never reused), wire exposes `tabId` (list, open, close-by-ordinal), shared tab-grammar parser (one grammar, two doors: brain + omnibox), chrome-like strip with ordinal badges, focused-URL placeholder + web-search fallback, live zoom slider in the provenance row, long-press history on back/forward (CDP navigation dropdown, true history travel), Alt+N position switching, title/session line + `t{index}:{id}` badges, copy-URL prefix icon. `b2392cbf`, `558942c1`, `115b7851`, `a47ef922`, `5a68dfbf`, `255609d1`, `238f65a0`, `2f753b44`, `f0758d2b`, `bac6d36b`, `39fd618d`, `4fb55317`, `21286bc3`, `190182af`, `6bfad3cc`, `764c01da`.
- **Glass identity & ownership (ADR-0045 am 3–4)** — a glass's owner is its OPENER panel (`openedBy`), not any page-global capture; ownerSessionId registry fact with owner-aware re-bind; per-tab v2 identity keys retire the fleet-poisoned v1 entries; explicit driver identity via `--owner-session`/`GLASS_OWNER_SESSION`; reload and HMR re-adopt keep the glass through bare reloads and dependency-module churn; the Guest's Tab — browser-scoped birth discovery + registry guest admission. RCA "The Key That Cleaned Itself Away" pins the forgery class. `c8b38112`, `81fe6ced`, `2d3233f4`, `5637721f`, `84f1f58b`, `61ca7713`, `8b442766`, `b0f68a22`, `e4cd12fd`, `be852136`.
- **The Ghost Glass death handshake** — `close()` announces, the panel believes, the orphan dies: death broadcast at connect, `offDeath` wired, a 404 on `/tabs` reads as death; reload button on glass strips (DSH 0.2.2-alpha.2). `cc7c1dc8`, `846f5765`, `86cdb70e`, `d118b2a2`.
- **The zoom knob is LAYOUT SCALE (ADR-0041 am 2 + ADR-0048)** — CSS zoom retired; the resize ladder speaks layout-viewport units; the settle gate fires viewport sync once per gesture (jitter + bars gone, operator-confirmed). Two-Glass-Zooms KB separates PanelsZoom floor zoom from Glass content zoom. `155f4738`, `2e132cc2`, `bc5c6626`, `54b2ec7a`, `e1286392`, `e25af7b9`.
- **Plugin rack: tabs + symmetric uninstall selection (ADR amendment IV)** — one shared SegmentedTabs pill (three consumers), both doors (available/installed) speak checkboxes + batch bar, per-row verb and Installed badge deleted, bounce-recovery note on remount via sessionStorage marker, door-scoped selection reset on tab switch. `a88ac9a1`, `24b5bd05`, `b9a6a8fb`, `8ab738a3`, `21b47370`, `f66efde0`.
- **Explorer toggle & icon tabs (PRD/Tasks/RCA)** — hide/show the tree lane via toolbar toggle intent, persisted in panel prefs, auto-reveal when no file surface can host the toggle; icon-only preview/edit tabs (Eye/Pencil); The Single Edit — one Edit verb, draft-gated Save, md Monaco highlighting; toolbar extracted into `toolbar/` components; ADR-0047 — only the mount effect buries its editor. `095bf2d9`, `e3fd3ac4`, `70806db6`, `e67086be`, `0bac3c66`, `52f249b1`, `a1b0ef52`, `ec7c9efc`, `47f05cb7`, `ca30a6c9`.
- **Terminal Desk: grown-up tab strip + honest resize** — scrollable tablist, sticky clear with three scope verbs (Clear all / Clear jobs / Clear terminals, fresh-T1), PTY resize wired end-to-end (session.resize + registry fence + send-route + client onResize) so the shell winsize matches the fitted viewport — the right prompt no longer clips. `3abb1077`.
- **Workspace-file + terminal strips** — workspace-file grown-up tab strip (scroll-into-view on activePath, sticky clear with blanket confirm, dirty-tab tint); desk mirror publishes only on content change. `791b5292`, `9f52b943`, `a6a64d1c`.
- **The glass hands split + refusal contract (ADR-0045)** — `dsi-glass` verifies DSI live, `glass-url` drives the web; `yt --play` consumes every term (D9), `eval --b64` honors the url-substring the header promised (D10), the Stop-Loss Law (D11: a refusal is an answer). Live gates: b64+substring resolves the named tab, all-terms refusal with candidate list. `17bac45a`, `d6586685`, `dd86ebea`, `d6521b3c`, `55cf48cb`, `4292888e`.
- **Conversation surfaces** — injected image-carrying messages render as prompt bubbles with a key/value table trio; bubbles keep their action row + timestamp; `<path>` blocks render as clickable file links (absolute root-level links pinned); attachment reads carry the full image ref (DSH 0.2.2 verify-by-ref); `/new --title <title>` names the session at birth; Suggest Strip single-line preview (ADR-0044 the Quiet Verdict); chip & model menus close on outside click and Escape. `21cc2514`, `c4b8fdbb`, `1bc06ea3`, `5361c227`, `2a34fce2`, `5304c7b6`, `b7534b90`, `3772a0c5`, `f5f2b12a`, `0afdf866`.
- **Chip Label Promotion** — goal, tool-goal, time-context promoted to tailored producers. `3ae2a875`.
- **`dsi --zai` writes the profile patch (D7–D10)** — the CLI bootstrap writes `~/.dsh/profiles/<profile>/cordis.patch.yml` directly (the legacy `settings.yaml` is DSH's import-tombstoned past — every run re-created it and the next boot re-imported); logic extracted to `bin/lib/zai-patch.mjs`; 9 functional + 4 structural tests, live two-run gate PASS. ADR amendment D7–D10 + spec. `becc20a5`.
- **Coverage waves** — every sub-80% file lifted over the per-file threshold: file-toolbar arms 100%, settings-monaco 100% (51 tests), registry/conversation/engine sweeps, +49 branch/function tests, flake hardening; `test:coverage` exits 0. `93235f32`, `fe35630f`, `c347678a`, `04c42709`, `04c79a53`, `ab6b5d53`, `e986707a`.

### Bug fixes
- **Duplicate attachmentId crashed the floor** — two images with the same id in one prompt threw `each_key_duplicate`; MessageImages renders the distinct set (first occurrence wins); operator sha pinned by unit test. `7acb0cca`.
- **StripTip re-anchors when the strip moves** — search narrowing (SC#1→SC#2) no longer strands the tip at the stale rect (ResizeObserver on `.suggest-strip` + window resize + capture scroll, torn down with the effect). `9b980f9b`.
- **Desk mirror-publish infinite loop** — the mirror published on every assignment; now only on content change, page sink is a plain record + version counter. `a6a64d1c`.
- **The honest empty tail** — a settled JobTail never says waiting (ADR-0049); job-tail empty state goes through paraglide (four tongues). `995044a1`, `c1e4fa83`.
- **Chord permission inheritance** — `n` inherits the focused session's access mode; `GET /api/dsh/session/[id]/permission` for the chord's history-tail + live projections. `38191dda`, `26fbee9e`, `ea7cfcaa`.
- **Playwright scrollbar veto** — headless `--hide-scrollbars` default vetoed via `ignoreDefaultArgs` + a launch-time bar-footprint gate: the glass mirror keeps scroll behavior. `84cf40a1`, `33ed13a7`, `7d8ab14e`.
- **Floor scroll steal** — tab-strip reveal no longer scrolls the floor. `cd276e13`.
- **Session zoom re-arms the init script** — navigation can no longer repaint config zoom. `e30815c2`.
- **History menu** — titles visible on light dropdown (dark token leak), long-press release race closed (pending-open suppresses the click), menu markup deduped. `c358fe31`, `c7baaa81`, `c7baaa81`.
- **Type hygiene** — `pnpm check` errors 31 → 0 across three waves (registry + conversation floors, glass-url skill JSDoc types, stale gate-failing tests + de-trapped config readers). `2cc00afa`, `2495341b`, `3f7036fa`, `57893227`.
- **Markdown grammar teardown trap** — EnvironmentTeardownError after vitest teardown stubbed at the source. `32396205`.

### Docs & skills
- **KB/RCA**: The Proof That Lied (verification-theater process failure, 4 flowcharts + 2 sequences), The Answer That Bought Another Round (the refusal contract), The Key That Cleaned Itself Away, the Two Glass Zooms, glass-zoom-scales settle-gate scenario, orphaned-glass raw-CDP driving path, browser-manager refresh (headless default correction, tab identity/grammar). `50e44f11`, `181e0b3a`, `056a8f07`, `4292888e`, `55cf48cb`, `be852136`, `e1286392`, `54b2ec7a`, `181e0b3a`, `6cab80f0`, `7d8ab14e`.
- **chore**: .gitignore sorted into labeled sections with layman comments; `.superpowers` sdd/ ledgers committed as work records (glass-tab-ids ledger waves closed on operator gates). `f3c717ba`, `5cedc48f`, `bdd91ac4`, `2ac6b9d3`, `c36a2c0f`.

## 0.8.5

Bumped from 0.8.4 — the glass tab strip heals itself (created tabs land last, focus, and the mirror follows), the floor grows the Subagent Anchor popup, and the toolbar + conversation header speak one spacing grammar.

### Features
- **The Subagent Anchor Popup (ADR, Accepted)** — one anchor button with a live badge opens every sub-agent's ledger as a popup: endpoint join, first-sight clock, header + token-sum footer, row click adopts the helper onto the floor, close-all red trash-bin. ADR amendments (a)–(f) through three review rounds; unit suites + header regression; i18n Total Tokens via paraglide (en/zh/es/id). `44872899`, `a023e8d6`, `bdc9baf0`, `1c1d9402`, `afab3175`, `208dd912`, `3fd0e7d7`, `587da498`.
- **Glass tab strip: created tabs land LAST, focus, and the mirror follows** — registry `tabOrder` (creation order; the phantom title-sort comment replaced), `context.on('page')` auto-activates newborn tabs (ADR-0040 D5 narrowed: CREATION followed, brain SWITCHES still not), the stream route re-binds via the new `onActiveChange` seam (boundary frame pushed), and the panel's 2s strip poll re-attaches on external pointer drift (zombie SSE self-heal). ADR-0040 amendment 2, PRD §8, Tasks wave A. `b7fd7adf`.
- **Glass registry self-heals stale CDP handles** — `healHandles`: when `listTabs` enumerates empty over live pages (brain churn), fresh sessions replace dead handles and the pointer remaps; the strip poll triggers it with no operator action. Tasks A.6. `fc41c239`.
- **Workspace-file toolbar reload verb + icon UX** — draft-safe `refreshFile` behind a reload icon before the capture slot; busy spinner in flight, check-mark after, idle decay (CanvasCopyButton parity). `1b611dfe`, `a08cfee0`.
- **Operator-configurable glass width bounds** — the browser panel honors configured min/max widths. `e6526774`.
- **Explorer drag frame (ADR-0043)** — floor drag paints once per rAF frame and settles into panel-prefs at mouseup; the explorer tree lane is fixed-px and the parent resizes only the file region. `fa66e4ad`, `0146f2e0`.

### Bug fixes
- **ConversationHeader joins the spacing grammar** — row `gap-3` → `gap-1` (0.25rem) matching the toolbar grammar and both clusters' internal gaps; raw-source pin test (gap-1 present, no gap-3 remnant); glass-verified. `627f3d94`.
- **File toolbar spacing grammar** — uniform 0.25rem row gap restated in tablists, 1.5rem control height, bordered-chip icon buttons across file + explorer toolbars; raw-source pin test. `c1be548e`.
- **Identity-guarded file fetch** — a floor drag no longer refetches/re-parses the open file per width write. `b38010f7`.
- **The honest red chip** — a tool result reads its own wire (mapper three-seat ok + resultText fallback; ledger-cut fixture gate). `d79280c8`.
- **i18n Total Tokens** — the footer invoked the getter as a string; paraglide `totalTokens` now actually renders (unit asserts invocation). `587da498`.
- **svelte-check clean** — 62 type errors → 0. `b447933e`.
- **Coverage floor cleared** — SubagentPopup branches 60.78→88.23, settings-monaco →100; five new suites, 56 tests. `9cabfbf3`.

### Docs & skills
- **dsi-gb-verifier skill** (new) — drive the operator's own Glass Browser over MCP; carries the circularity rule and the one-correct-open-flow lessons. `a08cfee0`, `b7fd7adf`.
- **KB**: glass-browser verification surface rewrite; browser-manager + chip mechanics walkthrough; explorer split mechanics; sub-agent feature-contract-scenario. `4f8eff12`, `d33719e7`, `f199fc08`, `1e2335ef`.

# Releases

## 0.8.4

Bumped from 0.8.3 — the operator grows the glass's tab set themselves: the strip's `+` opens a blank tab (the birth state again), and the test floor survives the vitest 4 / Node 26 drift.

### Features
- **The Operator's Blank Page (ADR-0042, Accepted)** — a `+` chip at the end of the glass tab strip: clicking it opens a BLANK tab through the existing `/opentab` seam with an ABSENT url (never a literal `about:blank` in the grammar), the registry does `Target.createTarget` ONLY (no navigate — the documented chrome-error race stays dodged), and the boundary frame comes from `activate()`, inheriting the first-frame seed contract (ADR-0040 D4) by reuse. The address bar (no focus grab) drives the blank face; the context menu's open-link/image share the same client function. The blank tab is an ordinary tab: close it via the strip ✕ and the original re-activates, session survives. Unit pins `browser-tab-element-routes.test.ts` (absent/empty → blank, non-string still 400), `browser-registry-gap-sweep.test.ts` (blank path creates without navigating), `browser-panel-tabs.test.ts`; e2e `browser-plus-tab.spec.ts` (4/4 — create-active, address-bar DOM truth, close + survivor, kill ladder frees the port) with the ADR-0040 regression suite still 4/4. `d432aaba`.

### Bug fixes
- **Green test floor after vitest 4 / Node 26 drift** — 590 failures traced to test-infra storage drift (module-state isolation lost), not product code; the storage was rebuilt so the per-file isolation assumptions hold again. `497464de`; RCA `c41bd133`.
- **Browser-surface coverage over the 80% floor** — per-file coverage raised across all browser unit surfaces (routes, registry, panel). `5e8503e4`.

## 0.8.3

Bumped from 0.8.2 — the glass learns to follow tabs (the many-faced glass), measure honestly (the zoom-honest glass), and the developer turn gets its own stream entry.

### Features
- **The Many-Faced Glass (ADR-0040)** — per-tab relays with an active-tab pointer and a tab strip on the panel: strip always visible (2s poll + refresh-on-frame so brain-opened tabs appear without remount), active tab as blue pill with dark text, close X on every tab, context menu closes on outside click. New routes `/api/browser/[id]/tabs`, `opentab`, `closetab`, `activate`, `element`; e2e `browser-tabs.spec.ts`, unit pins `browser-panel-tabs.test.ts`, `browser-registry-tabs.test.ts`, `browser-tabs-routes.test.ts`. `22d9219f`, `37adc524`, `060b809d`, `7370c42e`.
- **DSI context menu in the glass** — native menus never render in screencast, so the glass renders its own right-click menu from an element-data pass: opentab, copy, send right-click to the page. `55d3d4fd`, `b368a059`, `6d68c9b7`; pinned in `browser-panel-contextmenu.test.ts`.
- **The Zoom-Honest Glass (ADR-0041, Accepted)** — the viewport measures the transform-true rect (page-prefs store is the single authority), zoom changes re-arm the measure, and a viewport POST on a silent page seeds the ring (seed-after-resize, no stale-aspect letterbox). Root cause of the small mirror was the fixed launch viewport pin: `viewport: null` for headed, Playwright-API headless. `72fe050a`..`5444124f`; e2e 08 zoom re-converge, `browser-panel-viewport.test.ts`, `browser-registry-resize-seed.test.ts`.
- **The Developer Turn (ADR-0027b)** — developer/message maps to its own stream entry: host-event-catalog, mapper turn-grouping, and a DeveloperMessageRow that reads like a message, not a chip; pins in `dsh-event-catalog.test.ts`, `developer-message-row.test.ts`, `dsh-events*.test.ts`. `e9d4fa3c`.
- **KB — browser-manager sizing rewrite** — one coherent flow (birth / window-follows / re-assert / zoom drift / repaint / belt-and-braces) replacing the viewport-follow notes. `9603389b`, `08bb3d73`.

### Bug fixes
- Small/cut-off mirror suite — lazy-attached tabs get the panel viewport at attach (`31775f3f`); self-heal forces a viewport re-sync when frame and panel sizes drift (`19d03f98`); viewport-follow resizes the WINDOW (headed centered emulation rendered a small mirror) for a native 1:1 (`d6d031f3`); birth size matches the panel 730x830 so the first render is native (`d36b31a4`); the open POST accepts a measured birth size and self-heals frame/panel mismatch (`5fcf716a`); ADR-0041 root-cause fix removes the launch viewport pin (`eb8332e6`).
- Brain re-homes to the newest glass — agent tabs land in the watched panel instead of an orphaned old one. `e6057238`.
- Lazy attach retries the pages scan — raw-CDP tabs no longer race the first verb. `e07a7a48`.
- Active tab label was white-on-white; strip sorts by title (CDP exposes no tab order). `8be0cafe`.
- A11y: close X contrast — red-on-blue failed, close X is blue-100 on blue for the active tab. `040042c2`.
- One attachStream owns the SSE lifecycle — ctx open/close re-syncs like strip-activate, no double streams. `03d91fb4`.

## 0.8.2

Bumped from 0.8.1 — the Glass Close Ladder lands (the trash kills, everything else folds), and the frame pipe learns its second dial.

### Features
- **The Glass Close Ladder (ADR, Accepted)** — exactly two things kill a glass: the header 🗑 (BrowserClosed: wire close + panel removed + slot pruned in one stroke) and the idle reaper. The opener's close and the glass column close FOLD, never kill; sidebar rows cannot kill. `019ff596`, `69952197`, `28d319b6`, `7cb1cca8`; headed demo spec `0dadb3de` (trash removes panel + SidebarOpenPanels row).
- **The Frame Pacer (ADR-0039)** — `browser.screencastMaxFps` (default 15, clamp 1..60): Chrome skips frames at the SOURCE via `everyNthFrame`, so skipped frames are never JPEG-encoded; the relay ring/ack/seed and input chain untouched. Pacing pins 15→2, 30→1, 7→4, 1→30 in `browser-relay-mock.test.ts`; wiring pin in `browser-proxy-verbs.test.ts` (29/29 green). `51d27881`.
- **The first frame is a contract** — a starved screencast birth left the glass frozen on "waiting for frames…" forever; `open()` now seeds the relay ring via `Page.captureScreenshot` after a grace window (`BrowserRelay.seed()`). RCA 2026-10-23 The First Frame That Never Knocked; `c1bb3a2a`.
- **A focused glass clamps inserts** — promoting an agent while the glass holds floor focus lands the newcomer at the opener's family block head, never wedged between opener and glass; pinned in `panel-placement.test.ts`. `beea5bf2`.
- **KB — Browser Manager feature-contract-scenario** — the surface got its first feature/contract/scenario note (kill authority, fold ladder, state table, open question pointing at ADR-0038); later rewritten as the two-dials frame-pipe contract (size × rate) including the measured `maxFps: 1` feedback-lag trap. `f938029a`, `c392e927`, `bc5c48c4`.

### Bug fixes
- Ghost summon adopted the wrong family — summoning a spine ghost now adopts its opener (the glass never lands as an orphan), the ghost is ALWAYS the first child under its opener, and pinned children land AFTER the ghost, never between opener and ghost. `b8d5a4eb`, `41a5c96c`, `eacf8f5d`, `8aca533e`.
- The glass persona dropped its fake Windows/New_York UA/timezone/locale overrides (self-consistent host Mac Chrome now); an initial fix + its 100%-branch test were reverted when the approach shifted to ADR-0038 hands-not-evasions. `8cd90fc7`, `9d80f9a0`, `4f16ce38`.
- Captcha launch hardening — consistent persona, site-isolation off, dev-shm (later superseded by ADR-0038's human-in-the-glass ruling). `0176b3d3`, `31392f9c`.

## 0.8.1

Bumped from 0.8.0 — the Glass Fold ships, and the floor ControlBar moves into the sidebar rail.

### Features
- The Glass Fold (ADR-0037) — closing a browser panel FOLDS it like a sub-agent: the session survives as a folded-glass row, the boot restore skips folded entries (a glass never comes back uninvited), and ONE summon seam brings it back (boot + sidebar row click). `0e70d1b`, `a81e7ec`, `23b35c8`; regression pins in `family-render-glass-first.test.ts`, e2e `04/reload-02` rewritten to fold semantics.
- The floor ControlBar now lives in the sidebar rail — hosted by `AppSidebarHeaderAction` (expanded header cluster) and by `AppSidebar`'s collapsed stub before the Restart button; the tray portals to `document.body` pinned under the trigger's viewport rect so the rail's overflow clipping and the zoom transform can never cut it off; `panelWidth`/`zoom`/`resize-all` stay page-owned, bound through the sidebar chain. `5bde03c`; portal-aware updates in `tray-buttons.test.ts`, `panels-row.test.ts`, `page-floor-interactions.test.ts`.
- Folded glasses nest in the Sessions spine under their opener when the opener holds no panel (synthetic `origin: browser` rows; the row click summons the glass; pills/presets census untouched) — `62e5146`; regression pair in `browser-family-rows.test.ts`.

### Bug fixes
- The summoned glass dropped BELOW its ghost siblings — the browser roster row shipped no `siblingIndex`, so the sibling merge read it as Infinity and every ghost flushed first; the summoned glass now carries the folded glass's wire slot (-1), a kind flip never reorders. `a1abbc9`; regression pair in `browser-family-rows.test.ts` (red-first).
- The folded glass vanished entirely after the last panel closed — the roster gated on open panels and `familyRenderOrder` never reached a ghost whose parent is not a panel; orphan ghost clusters now render as their own block and the roster survives on ghosts. `62e5146`; orphan-ghost pin in `family-render-glass-first.test.ts`.
- The spine's glass row wore the wrong costume (fork-green lineage line, plain glyph) — glass rows now ship the roster's costume: the glass glyph and the muted spawned line. `786b368`.
- ADR-0018 boundary: the layout→panels ControlBar crossing is frozen in `frozen-crossings.json` (operator sign-off, commit 5bde03c).

## 0.8.0

Bumped from 0.7.0 — the Job Follower Tab (ADR-0035): click a live job in the roster and watch its output in a -J terminal tab on the TerminalDesk, with reload persistence and an operator-controlled autoClose roster.

### Features
- **Job Follower Tab (ADR-0035)**: roster click opens a terminal tab named T<n> (continuing the shell-tab increment) with the job's command as tooltip, rendering the command as code lines (72237aa, a11e1ec); roster click with no terminal panel launches the desk, then replays the tab (03c417c)
- Settled job tabs linger 25s before auto-close — operator grace period (740883c); unowned job tabs close at settle, tabs suffixed -J (e0e552e)
- `jobs.autoClose` in ~/.dsi/settings.yaml (default false) — with it off, the desk never auto-closes a -J tab (clear button only, cancel pending closes when the condition un-applies, D3 final); roster rows gain a right-aligned clear button, all rows clickable (4945d90, 495cc5e); JobsButton renders the idle roster count when jobs exist but none live (aa7ee55)
- **-J tabs survive hard reload (D5)**: they ride the desk mirror — clamp keeps job-only mirrors, rebuild re-opens follows (18f3c06)
- `&&` chains render one command per line with the required bash continuation backslash (4efe44f)
- Headed Playwright driver: new session, prompt, click last roster job, -J tab, hard reload, stream recovery (7f987e9)

### Bug fixes
- Dot-separated jobfollow stream ids — dashes in session/job ids broke frame routing, tabs never settled (live RCA) (d86ab62)
- Command block rendered via join expression — Svelte text showed a literal backslash-n between lines (8b7a676); command labels carry literal backslash-n escapes, normalized before line-splitting (f55f03f)
- Settled job tab closes when the roster has no active jobs (ADR-0035 D3 amendment) (485459f)
- Unknown-job wording corrected — the registry drops records on owner-scope disposal (evidenced, not purge) (d6e347c)
- Docs: ADR/PRD/Tasks/Karpathy amended to as-built (1d2b689); KB note on the Jobs-to-Terminal click-to-open lifecycle, every field scenario, specs verified (55ecbb1); registry contract cited for settled retention — 16KB ring trim, stays listed (0e471f6)

## 0.7.0

Bumped from 0.6.21 — the Glass era: the browser comes to the floor. Three feature waves — Glass Browser (ADR-0029), Sticky Glass session persistence (ADR-0030) and the Glass Proxies header/panel split (ADR-0031) — plus a minor-bump's worth of coverage floors.

### Features
- **Glass Browser (ADR-0029, waves 1–4)**: browser session manager + CDP relay with /api/browser routes (20c4d64); BrowserPanel glass — CDP screencast mirror with scaled rAF-coalesced input, floor species + opener chip, navigate/page routes (e0760b8); MCP wiring via pinned @playwright/mcp child with health tracking, stable brain port 9515 + scan-range fallback (d01ee86, be2ff53, 6e7bfd3); letterbox-aware containedRect cursor mapping (2251fb1); ADR-0029 Accepted with amendments F1–F5 (5b63b03, 4388bfc)
- **Sticky Glass session persistence (ADR-0030, waves 1–3)**: browser: section in settings.yaml (headless default true, brainPort/mcpPin/profileRoot/maxSessions/idleMs) with per-create registry config and idle reaper (1e1543f); re-bind-or-open resolver — persisted session id in localStorage, BrowserPanel detach-only onDestroy + re-bind remount (490469b); floor boot auto-restores a live browser panel across hard reload, with reload-resilience e2e and the D8 port-freed gate (eb5fa57, 3e1c3d1, bcbb087, a827771)
- **Glass Proxies (ADR-0031, the Header Speaks, the Panel Acts)**: BrowserHeader and BrowserContent extracted from BrowserPanel (f4b6b0a); header proxy controls (e0c380b); address-bar header order + panel-following viewport route /api/browser/[id]/viewport (9495be3); config knobs for screencast quality, headless sound and tab-strip header (e9807a7); ADR-0031 Accepted with amendments 1–6

### Bug fixes
- YouTube playback hardening: --enable-automation dropped, navigator.webdriver masked, channel chrome with bundled-chromium fallback for full codecs/Widevine (db1ecec)
- Brain speaks streamable-http (SDK 1.25 handleRequest — the handlePost/Get/DeleteRequest trio doesn't exist and threw → empty 200s); listen(server, port) arg fix; mcpError surfaced (6e7bfd3)
- Playwright default --mute-audio dropped — the real headless sound fix, after the playback-probe verdict + player-error witness (07ecce4, ec20ad4)
- Captcha-legible screencast + profile cleanup (c9a5008)
- Wave 3 boot crash: --playwright-mcp flag lived in the --sync branch scope; startDsiDevServer read an undefined var (0bc5949)
- SSE identity-encoding vs preview gzip buffering, occlusion/offscreen compositor flags, guaranteed first paint (e0760b8)
- Reload restore no longer steals floor focus — openBrowserPanel grows keepSelection (bcbb087)
- Coverage floors: 8 Glass Browser files lifted over the 80% gate, test:coverage exit 0 (796a5ff); BrowserPanel branch coverage to 98.6% via five addendum suites A–E (bded743); 9 stale test pins realigned to post-W3/ADR-0030/31 contracts — full test:coverage green (8befb39); ~2.6k lines of new browser-panel/proxy/viewport/session-resolver suites (5599f02)

## 0.6.21

Bumped from 0.6.20 — the Deliverables Anchor lands (ADR-0027f): deliverables attached to messages surface as an anchor leaf with a one-line popup readout, and the header agent chip gains its Bot icon.

### Features
- Deliverables Anchor (ADR-0027f): deliverables reducer, payload lane and store key (f692fef); DeliverablesButton leaf mounted on the floating anchor with the SILENT_TYPES hand-off (a8bc4c3); popup rows collapse to one line — bare filename, hover title + CopyButton for the full path, description label in active fg (618d694, 47e7e2b); popup shrinks to content via fitWidth opt-in on the shared container, InjectedShelfPopup opts in too (d1be661, 01d4db1)
- Header: agent chip gets a Bot icon; copy-id action moves outside the chip (bb44a8a)

### Bug fixes
- Coverage: GoalSheet 80% gate fixed — 4 new direct-mount suites pin the branch matrix (7 tests) and the stale vitest exclude path corrected from anchor/goal/GoalSheet.svelte to bar/goal-bar/ after the bar/ move (e017418); DeliverablesPopup leaf tests lift branch coverage 66.7% → 83.3% across 5 suites / 18 tests (b9a4e07)

## 0.6.20

Bumped from 0.6.19 — the anchor split reaches the macro and goal surfaces: MacroRunSheet renamed MacroBar with MacroChip + MacroSheet extracted, GoalBar homed under anchor/goal; coverage floor hardened to zero violations across the family.

### Features
- Macro surface split (a5633a2): MacroRunSheet renamed **MacroBar**, MacroChip + MacroSheet extracted into `components/anchor/macro`; GoalBar moved to `components/anchor/goal` — the floating-anchor family now follows the one-component-per-leaf layout convention; spec docs and rename audit updated to match

### Bug fixes
- Coverage floor: GoalSheet branch coverage was 62.5% only from Svelte-compiler `??` interpolation fallback arms on required GoalResultGoal fields (goal.phase, roundsStarted, maxGoalRounds) — provably unreachable via the public API; 6 direct-mount contract tests added (`tests/unit/components/anchor/goal/goal-sheet.test.ts`) and the file excluded per the documented pattern (TokenCounter, PlanButton) (b6e85c4)
- Coverage floor: UserMessageJumper + UserMessagesButton relocated to `anchor/user-messages/` (old common/buttons + common/layout copies removed); 32 new tests across user-message-jumper-logic, user-message-jumper-branches, back-to-the-edge-button suites lift both above the 80% floor (UserMessageJumper 100% all metrics, BackToTheEdgeButton branches 92.85%); stale floating-anchor imports fixed, dead common/layout test deleted (b8c2a7b)
- Verified `pnpm test:coverage` exit 0 — 438 files / 5432 tests, zero files below 80% (b8c2a7b)

## 0.6.19

Bumped from 0.6.18 — the anchor-leaf family finishes its layout migration: every floating-anchor leaf (Plan, Inject, Jobs) now lives under `components/anchor/` with its popup split out as its own component.

### Features
- Anchor layout migration: PlanButton/PlanPopup moved to `components/anchor/plan` (4e811ad); InjectedShelfPopup extracted from InjectedShelfButton (af5348d); JobsButton moved to `components/anchor/job` with JobsPopup extracted as its own component hosting the shared JobRosterList in the Popup Shell (19d92e0)

### Bug fixes
- svelte-check: fetchMock typed via `Parameters<typeof fetch>` clearing the remaining type errors (b7025c3)
- Launcher: browser open gated on the host actually listening — no more tab racing the port (129c0be)
- Coverage thresholds: types-only files (app.d.ts, types.ts), CSS, Monaco worker bootstraps, and the frozen ADR-0022 prompts/db.ts re-export seam excluded as 0%-report noise — the 80% floor now measures only real logic (19d92e0)
- `dsh webVersion` pinned to 0.2.1-alpha.5 with release KB note (96e803e)

## 0.6.18

Bumped from 0.6.17 — Job Badge feature completion (ADR-0026) hardened: svelte-check at zero errors, BC-7 page-owned roster cadence, and coverage over the 80% per-file floor.

### Features
- Job Badge feature wave (ADR-0026): job.list/job.kill relay, refcounted roster store with listener registry, `/api/dsh/jobs` route (344184d); RowJobBadge on owner rows with kill arm→confirm popover and sidebar DOM contract tests (d7061f4); JobsButton on the floating anchor with shared JobRosterList readout and virgin-session fill fix (741ed40)
- The Roster Mirror — job roster served from a job/list stream cache in the relay, retiring the unary call the host refuses (218d9d0, RCA 2026-10-17); roster store consumes the mirror pending flag — honest darkness, never a blanked set (385bad9)
- Roster status as icons — RUNNING spins, words become tooltips (57daa48, operator request); JobsButton popup hosted in FloatingAnchorContainerPopup per Popup Shell ADR (3a2d446)

### Bug fixes
- svelte-check: 41 type errors across 18 files fixed, type-level only — zero errors, zero warnings at `pnpm check` (d66d3c0)
- BC-7 timer contract: roster-store's client `setInterval(2000)` retired — `watch()` is refcount-only plus immediate first load; `refreshWatched()` rides the page-owned 5000ms spine tick in spine-feed `loadOnce()`; pinned by tests/unit/a2a-chip.test.ts, conversation-page.test.ts (3×5000ms intervals) and a "watch schedules ZERO setInterval" pin in jobs-roster-store.test.ts (d66d3c0)
- i18n: JobsButton raw-copy `title` moved to paraglide `jobsLiveTitle_one/_other` keys across en/es/id/zh — ui-i18n-clean repo scan back to zero violations (d66d3c0)
- Route-test contracts: floor/restart and plugins/host-bounce are POST-only by design — tests use namespace imports asserting GET is undefined (d66d3c0)
- Coverage floor: JobRosterList branches 70%→95%, functions 75%→100% (new tests/unit/job-roster-list.test.ts, 14 tests); RowJobBadge branches 72.72%→100% (row-job-badge.test.ts 7→13 tests) — `pnpm test:coverage` exit 0, 5400 tests, no floor violations (737f255)


## v0.6.17

Bumped from v0.6.16 — the embedded host becomes a window and a verb: the cordis lens reads the living plugin tree (ADR-0024), and the host-level bounce keeps vite alive through an in-place re-boot (ADR-0025), proven on the real floor.

### Features

- **The cordis lens — named queries + structured census (ADR-0024, fbb1a87)** — with `DSH_HOST_INTROSPECT=1` the embedded host boots via `runProfile` directly, captures the live Cordis root, and exposes a lens: introspection named queries plus a 15-second structured census print (grouped per block, degrading per block); the KB note documents reading the tree through it. `createLens` is exported on the host surface.
- **Host-level bounce verb (ADR-0025 Wave 1, 593fd8a)** — `bounceDshHost()` stops ONLY the embedded host, waits for the port, and re-boots in place while the vite process never dies; typed fallback result (`no-handle`, `port-held`, `boot-failed`, `in-progress`) so callers can degrade; re-entry guarded; pinned by `tests/unit/vite-dsh-host.test.ts`.
- **Host-bounce route + chain fork (ADR-0025 Wave 2, 0445c43)** — `POST /api/plugins/host-bounce` (localhost-only, 409 no-verb/failure, 403 remote) calls the surface verb; the plugin-restart chain now forks: in-process floors POST the live route (2 tries, 1 s window) and skip the whole-floor sweep on success — pair/build/unreachable keep today's sweep byte-for-byte. Both fork branches pinned by `hostBounceDecision` twins.
- **In-process floors boot WITH the bounce handle (d2b90df)** — `devModeEnv('in-process')` now sets `DSH_HOST_INTROSPECT=1` by default: a runCli boot has no stop handle, so the bounce verb could never exist on the default floor (real-floor gate finding; also lights the ADR-0024 lens by default).
- **Fresh launch URL after a bounce (D4 amended, ec89036)** — the launch token is minted inside the host process (`dsh-client-connection` `processLaunchToken`, a private WeakMap on the cordis root — no preset seam), so same-token re-boot is unimplementable DSI-side; the chain instead reads the NEW token from the sink and prints a launch URL that works on first click (loaded pages keep working via the durable signed cookie). `launchUrl`/`tokenFromSettings` twins pin it.

### Bug fixes

- **The bounce chain POSTed the wrong port (d2b90df)** — the host-bounce route is a DSI (vite) route; the chain dialed `DSH_HOST_PORT` (3080) and hit the auth fence/404. New pure `floorUiPort` resolves PORT env → vite `--port` arg → 5175 (all three arms unit-pinned).
- **pgrep went blind to the vite floor (cf4c725)** — `pgrep -f` exited 1 for the RUNNING vite process on the live floor, so the chain misread the mode and swept floors it could have host-bounced; floor discovery now parses one `ps -eo pid=,command=` dump via the pure `parseDevFloorPids` twin.
- **Inspector flags took the wrong ride (e24b3f0)** — inspector args ride the dsi CLI arguments, not node execArgv, across process restarts.
- **Cordis lens tree missed registry-runtime fibers (d96344a)** — `tree()` now enumerates them; the KB open question is answered.
- **Real-floor RCA: the "session-record poisoning" wedge (fa9d85c)** — the dead session's confirmed-DSH-bug diagnosis was disproven by its own ledger: all 43 `missing required property "description"` rejections were calls genuinely missing the argument; no harness state was corrupted. RCA note with ledger forensics in `dev/kb/rca/`.

## v0.6.16

Bumped from v0.6.15 — the DSH host moves in-process (DSI boots its own host with token intercept and bounce), the restart verb finally works end to end, and context chips escape the fold.

### Features

- **In-process DSH host embed (waves 1–4, cb468d5, 0635978, f500b49, 3472ea4, c05a374)** — DSI's dev CLI (`--dev`) boots the DSH host inside the Vite process: dsh entry resolver + GO-verdict spike, vite-dsh-host plugin with token intercept (literal-s stderr split + `DSI_DSH_DEBUG` seam), process-level restart-safe host lifecycle with fiber-dispose stop and unmanaged-port guard, and `DSH_HOST_INTROSPECT` boot path owning the Cordis root (260 plugins live). Proven by a 5/5 e2e in-process floor wave (shape, 401 wall, token sink, page-to-host RPC pin, zero-orphan teardown).
- **Bounce restores the floor MODE (6cdd316, b3d3d9a)** — `DSI_DEV_MODE` is read via `ps -E` into a `resolveBounceMode` enum so a delayed re-serve relaunches in the same floor mode; `/api/floor/mode` route + bounce-inspect tests pin it.
- **Restart verb: POST /api/floor/restart + RestartButton (c893f65, 4e53038, 20dbecd)** — port takeover + delayed re-serve from the sidebar; i18n across 4 locales, RestartButton component tests, and pending waitPortFree boot guard landed in vite-dsh-host.
- **Escaped Injection: context chips never fold (ADR-0022, b19689a, a8ffe58, 064814e)** — injection chips in a chips-run escape the "N tool calls · M messages" fold: a strip above the think pills, expanded fold clusters join the escape row, unknown-event notices join the family with a work-row badge matching the disclosure count.
- **New DX skills: dsi-ports + dsi-restart (1224073, 7067bfd)** — live port inventory with purpose + memory (Port Ledger KB), and floor restart with a before/after port+pid+RSS delta report; dsi-thin skill removed as redundant.
- **Dev inspector: --inspect forwards to the vite child argv (f336860)** — one debugger for DSI + the embedded DSH host.
- **ContextInjectionChip homed with the chip family** — `ContextInjection.svelte` moved to `src/lib/components/message/chips/ContextInjectionChip.svelte` alongside ToolCallChip/SystemPromptChip; all import sites and the 92-test component suite green.

### Bug fixes

- **DSH_HOST_PORT fed dshBase (ffd90a5)** — the in-process page dialed 3080 while the host booted elsewhere; the base now reads the host's actual port.
- **Token intercept missed announces (0e9d465)** — literal-s split + stderr streaming fixed announce capture; `DSI_DEV` isolated in restart-chain tests.
- **Realm-proof debug handle (9bdba2d)** — `process.__DSH_HOST__` is visible from every inspector VM context.
- **peekIcon never reached ToolPeekButton (ba3cf4d)** — the glyph was passed as `peekIcon` but the prop is named `icon`; ToolPeekButton now switches glyphs (regression of ADR-0022 I3).
- **Injection escape strip order (fa76024)** — the strip renders ABOVE the think pills instead of underneath them.

## v0.6.15

Bumped from v0.6.14 — the theme token wave finishes (every gradient rides the layer) and the per-file 80% coverage floor holds across the five weakest files.

### Features

- **Panels split into focused modules (2632556)** — `components/panels/` decomposed into `workspace-explorer`, `workspace-file`, `monaco`, and `common/file-icons`, so each panel owns its file; existing panel tests retargeted and green.
- **Per-file 80% coverage floor lifted on the five weakest files (6a6fe3b)** — new regression tests: `workspace-file-tabs.test.ts`, `explorer-git-events.test.ts` (+102 lines), `file-write-route.test.ts`, `git-file-head-route.test.ts`, `terminal-stream-coverage.test.ts` (189 lines).

### Bug fixes

- **Dark gradient ramp gains perceptible spread (285cea6)** — the dark gradient was visually flat; the token ramp now steps noticeably between stops.
- **Every hardcoded gradient background rides the token layer (99618b0, c150555)** — sub-agent tints and the Monaco theme join the token layer, so gradients follow the active light/dark palette instead of staying fixed.

## v0.6.14

Bumped from v0.6.13 — the Three-State Lamp theme wave lands (dark palette, theme toggle, pre-paint), and file-link/markdown fixes harden chat surfaces.

### Features

- **Three-state theme: light / dark / system (458d8db, 9b404ed, daf4382, 29d8876)** — ADR-0023 token sweep plus the wave: full dark palette with scoped hljs highlighting and a contrast gate (w1), the theme-prefs module with a pre-paint script so the palette applies before first paint, no flash (w2), and the footer toggle placed before the LanguageMenu with dark-paint fixes (w3).
- **Terminal on by default (5426aae)** — `terminal.enabled` flips to `true`; `terminal.theming` follows `data-theme`.

### Bug fixes

- **Mermaid diagrams: two full color sets + theme-flip re-render (d1b1ffa)** — diagrams get light/dark palettes and re-render on theme flip instead of keeping stale colors.
- **Markdown code skins ride the token layer (f1d4d24)** — md-content code blocks use theme tokens, so they follow the active palette.
- **Markdown link destinations with spaces use the CommonMark angle form (648bb23)** — `[label](<path with spaces.md>)` so spaced file links resolve; pinned by `tests/unit/file-link-shapes.test.ts` (6 tests) and `tests/unit/components/composer/new-chat-button.test.ts` (14 tests).
- **Chat verb toggle goes icons-only (uncommitted, 2026-10-11)** — `chat-mode-toggle` in `NewChatButton.svelte` renders lucide `Plus`/`Replace` glyphs instead of text labels; `title` + `aria-pressed` keep it accessible; svelte-autofixer clean, 14/14 unit tests green.
- **Agent docs: file links are workspace-root-relative (c39fb67) and non-trivial tasks follow the dsi-adr → dsi-spec → dsi-task flow (1a4edd0)** — AGENTS.md rules so assistant links resolve from any host cwd.

## v0.6.13

Bumped from v0.6.12 — the plugin rack's per-source block becomes its own component, and the installed badge finds a right-aligned home on both shelves.

### Features

- **PluginManagerSection extracted** (790bdf5) — the per-source block of `PluginManagerPanel.svelte` (collapsible source header + row list, former ln 338–385) is now `PluginManagerSection.svelte`; the panel stays the state owner and hands in `source/collapsed/stars/tab/selected/busyId/floorBounce` plus `ontoggle/ontoggleselect/onremove`. The shared wire types `RackPlugin`/`RackSource` are exported from the section's `<script module>` and imported by the panel (single type home, no duplication). All `data-testid`s preserved; scoped `.rack-source*`/`.rack-row*` CSS moved with the markup.

### Bug fixes

- **Installed badge lives with the uninstall verb** (790bdf5) — the `rack-badge` moved from the row body into `PluginManagerUninstall`, and the badge+uninstall cluster pins to the row's right end (`margin-left: auto`); behavior unchanged for uninstalled rows (nothing renders on the right).
- **Skills shelf badge one-line layout** (790bdf5) — `.shelf-badge` had no flex layout, so the `Check` icon and text wrapped onto separate lines inside the pill; now `inline-flex` + `gap: 0.15rem` + `white-space: nowrap`, and the markup collapsed to a whitespace-free one-liner so `textContent` stays exactly the badge text (pinned by `tests/unit/settings-skills-item.test.ts`, all 4 skills-shelf suites green).

## v0.6.12

Bumped from v0.6.11 — canvas-copy capture lands in the panel floor, and the type/test/coverage gates all come back green.

### Features

- **StreamingIndicator while a turn is in flight** (18d6f28) — sub-agent streaming state now shows an indicator in the conversation surface; its title copy routes through the paraglide `turnInFlight` key in en/es/zh/id.
- **CanvasCopyButton on the panel floor** (577af42, 1b19c62, cbf68c2) — PanelHeader gains a canvas-copy capture button placed before the panel-close button, with the zoom-scale right-side cutoff fixed by measuring layout size (`offsetWidth/offsetHeight`, transform-blind) instead of the scaled `getBoundingClientRect`; toolbar copies were deduped so the PanelHeader floor button is the single capture entry point.
- **Prompt-manager dialog refresh** (ef9113c) — dialog box styling/structure updated.

### Bug fixes

- **16 svelte-check errors cleared** (4a2cc91) — dead CSS in `PluginManagerPanel.svelte` (8 unused selectors after markup moved to child components), stale `rack.d.mts` type surface (added `repoIdentity` export, `gardenRepo`/`sources` on `buildSnapshot`), and stale test types in `settings-skills-item` / `plugin-manager-rack-row` tests. `pnpm check` exits 0.
- **6 failing tests fixed** (c8fd76a) — canvas-copy tests still stubbed the pre-577af42 `getBoundingClientRect` sizing, so jsdom measured 0×0 (collapsed tiling, phantom clipboard write); stubs now pin `offsetWidth/offsetHeight`. Hardcoded `title="Turn in flight…"` violated the verify-ui-i18n gate — copy moved to locale dictionaries. `pnpm test` 4676 passed / 0 failed.
- **TerminalTabHeader coverage gate** (07bd0ca) — new `tests/unit/terminal-tab-header.test.ts` (mount with/without `actions` snippet, children render, `role=tablist`) lifts the file from 50% to above the 80% per-file floor; `pnpm test:coverage` exits 0.

## v0.6.11

Bumped from v0.6.10 — every file clears the 80% per-file coverage floor, and 13 silently-failing tests come back green.

### Features

- **Per-file coverage floor holds on all six sub-80% files** (3a14946) — the vitest per-file 80% gate (all four metrics) passes with zero threshold errors across 368 test files / 4672 tests. New suites: `tests/unit/components/settings-plugins/plugin-manager-rack-row.test.ts` (PluginManagerRackRow 0% → S100/B91.7/F100/L100), `tests/unit/plugin-manager-uninstall-header-actions.test.ts` (both components to 100%), `tests/unit/settings-skills-item.test.ts` (SettingsSkillsItem B50 → 100), `tests/unit/plugin-manager-panel-branches.test.ts` + `PluginManagerPanelTokenHost.svelte` (PluginManagerPanel B68.3 → 80.6, incl. the waitFloorBack 120s-timeout arm via fake timers), `tests/unit/components/common/buttons/canvas-copy-button-scrollers.test.ts` (CanvasCopyButton B75.8 → 90.9).

### Bug fixes

- **Coverage runs produced no report at all — 13 tests silently failing** (3a14946) — the rack engine wire bumped to v2 (`RACK_WIRE_VERSION = 2`) while both engine suites still emitted v:1 payloads, so every snapshot/refresh/apply test rejected with a wire-version mismatch and vitest aborted before writing coverage. Fixed: engine test payloads follow v2, the mismatch tests pin v=1, and `RACK_GARDEN_PATH` is pinned in verb-arg assertions so `--garden` args stay deterministic (`tests/unit/plugin-rack-engine.test.ts`, `tests/unit/server/plugins/engine.test.ts`).
- **Hard-coded copy broke the ui-i18n-clean gate** (3a14946) — `PluginManagerHeaderActions` (aria-label "Plugin Rack") and `PluginManagerStars` (repo/creator door labels) carried literal English strings; both now route through paraglide `t(m.pluginRack…)` using existing catalog keys. Pinned by `tests/unit/ui-i18n-clean.test.ts` (zero violations at HEAD).

## v0.6.10

Bumped from v0.6.9 — the Plugin Garden joins the rack (owned enumeration, wire v2, shelf-exact grouped panel) and one repository can no longer appear twice.

### Features

- **Plugin Garden enumeration** (d1e36f6, 063a252, d8e9b17, 72076d1) — the rack reads the checkout's own `plugins/` directory: each child with a `package.json` wiring `dsh.bundle.patch` becomes an owned row installed as a link dep; the reff is demoted to the external catalog; snapshot wire moves to v2 (ADR "The Plugin Garden").
- **Shelf-exact grouped panel UX** (d8e9b17, 72076d1, da05f02) — grouped source cards with selection bar, fold pill and per-row install verbs; panel suites migrated to the grouped head/source testids (`tests/unit/plugin-rack/panel*`).

### Bug fixes

- **Duplicate rack group for one repository** (e1ae7c9) — a reff line pointing at a `/tree/...` browse URL of the garden's own repo rendered the repository twice ("1. deepseek-insight" and "3. by deepseek-insight"). Root cause: snapshot sources grouped by raw URL. Fix: `repoIdentity()` owner/repo identity, external rows colliding with an owned row shadowed with a `reff-shadowed-by-garden` warning, `sources[]` grouped by identity (ADR-0016). Pinned by `tests/unit/plugin-rack/repo-identity.test.ts` and `tests/unit/plugin-rack/reff-shadow.test.ts`.

## v0.6.9

Bumped from v0.6.8 — agent-preset templates survive the dsh 0.2.1 contract, file-link and canvas capture fixes, and a fresh RCA standard note.

### Features

- **Agent-preset templates** (1a7cd6a) — `template/dsh-app-dev-preset/` and `template/dsh-research-preset/` ship ready-to-mount `cordis.patch.yml` preset recipes (app-dev full builder; research read-only investigator), with KB/ADR companions and the template seed resources. Both templates verified against the running dsh 0.2.1-alpha.1 contract (see the RCA below).
- **dsi-rca skill joins the shelf** (5e3fec7, f0a2fd4) — the dsi-rca skill (narrative RCAs: operator quotes, layman glossary, mermaid flow + sequence diagrams, carry-forward rules) moved under `skills/` beside the other dsi skills after a live-mirrored copy proved the slash menu could not see repo-local skills.

### Bug fixes

- **app-dev preset dead on dsh 0.2.1-alpha.1 — two contract drifts** (356ac8f, RCA: dev/kb/rca/2026-10-06 — The Preset That Photographed an Older Harness) — the preset still mounted `@deepseek-ai/dsh-workflow-worker-thread`, renamed to `dsh-workflow-ptc` in 0.2.1 (row never started → "Failed to load" badge), and kept `command-compact`/`tool-result-pruner` outside the compaction group whose isolate realm they consume (join rejected with `agent-preset/invalid: Preset services require isolate realms`). Both fixed in `template/dsh-app-dev-preset/cordis.patch.yml` and the live `~/agentic-ai/app-dev-preset`; the honest `broken` reason was recovered from the `agentPresets/list` RPC the UI summarizes away.
- **File-link deep fallback missed bare links under a root subdirectory** (279e338, KB 4a9af97) — the fallback chain resolved bare links only at the root, not under a root subdirectory; documented the full resolution + debugging order in `dev/kb/`.
- **Canvas Copy full-mode captures ignored nested scroll offsets** (d17f2a4) — captures clipped content scrolled inside nested containers; offsets now compose.
- **Anchor popup shell inflated to the column cap** (b0b3853) — `w-max` + nowrap rows made the popup grow to the longest prompt (583px box, ~350px of text); fixed `w-96` restores the old footprint. Playwright-probed (583→384px) with unit tests green.

### Docs

- Layman KB rewrite for the renderer with Zed-style mermaid colors and wrap-down tables (b6fa807); per-participant sequence diagram colors in the render path (5e3fec7); "The Life of a File Link" KB (4a9af97); term-pill terminology retired across dev docs (fda57b5); RCA — The Preset That Photographed an Older Harness (356ac8f); plugins-reff gains superpowers-dsh and sandbase-harness references (356ac8f).

## v0.6.8

Bumped from v0.6.7 — the published package ships its skills again.

### Bug fixes

- **Published package mirrored zero skills after the skills move** (0f7bc5c) — commit 2b026bc relocated the six dsi-* skills from `.agents/skills/` to `skills/`, but the packaging manifest kept listing only `.agents`, so an npm tarball carried no `skills/` tree and a fresh-install `dsi` mirror found an empty source for them. `package.json` `files` now ships BOTH sources — `.agents` (dsi-ov-setup, dsi-plugin-rack, dsi-skill-shelf, what the installer mirrors first) and `skills` (the six dsi-* docs/skills) — verified by `npm pack --dry-run` listing all 16 skill files. The runtime mirror source in `bin/dsi.mjs` stays `.agents/skills` by operator decision. Tests: tests/unit/dsi-cli.test.ts ('files includes both skill sources' + the six-directory SKILL.md check against `skills/`).
- **Bundled template seed DB refreshed** (355c1a2) — `template/.dsi/prompts.sqlite` re-synced with the live schema/rows so a fresh operator home seeds current state.

## v0.6.7

Bumped from v0.6.6 — the Skill Shelf tells the truth on --reload, counts skills honestly, and lets the operator uninstall anything installed.

### Features

- **Uninstall rides every installed row — the foreign badge informs, it no longer gates** (e9cb1a1) — operator decision superseding Skill Shelf ADR D5 (signed-only uninstall): a foreign (unsigned / hand-copied / other-host) skill shows its badge AND its Uninstall button, and the engine removes the folder. A signed folder still proves its id before deletion (the id-mismatch guard survives). `uninstallableIds` is installed-only; the panel, routes, and e2e fixtures pin the new contract. Tests: tests/unit/skill-shelf/apply.test.ts (foreign removal + mismatch refusal), settings-skills-panel, server/skills/routes, tests/e2e/skill-shelf.spec.ts.

### Bug fixes

- **`/dsi-skills --reload` refreshed the cache but never the open panel** (720d037) — the rebuild landed in `skr-cache.json`, then the floor's one-live-shelf dedupe only FOCUSED the already-open SettingsSkillsPanel, whose snapshot loads on mount alone — the operator stared at a stale list. The `reload` flag now rides the panel-add request (`SkillShelfPanelAddRequest.reload`, same contract for `/dsi-plugins`); the floor bumps a session-only refresh counter on the open entry and the panel re-fetches on change. The counter is deliberately sanitizer-stripped — a hard reload remounts and fetches anyway. Tests: tests/unit/skill-shelf-macro.test.ts (flag-rides lockstep).
- **Engine counted host-mirror dirs as skills — DSI shipped 12 rows for 9 skills** (720d037) — a prefix-less SKR URL made the engine scan the whole git tree, sweeping up `.agents/skills/` host mirrors (`dsi-ov-setup`, `dsi-plugin-rack`, `dsi-skill-shelf`) as duplicate rows. Dot-prefixed top dirs are now skipped in the GitHub tree scan and `walkLocal`. Live-verified: the deepseek-insight source enumerates 9 (was 12). Tests: tests/unit/skill-shelf/ suites green on the fixtures.
- **dsh-jump-prepare-fix shipped without its SKILL.md frontmatter** (3e95bd5) — the skill had no `name:`/`description:` header, so hosts could not match it and its shelf row rendered "No overview in SKILL.md". Frontmatter added following the dsi-adr pattern.

Bumped from v0.6.5 — the Skill Shelf learns duplicate-id discipline: one id, one row, one folder, with an honest one-line warning when a source ships the same skill twice.

### Features

- **Duplicate-id dedupe in the shelf snapshot** (ea9eb3c, feat pair f214f06/49c1889) — when a source lists the same skill id at multiple paths (open-design shipping `blog-post` under two trees), the snapshot collapses to the canonical `skills/<id>` row, marks the kept row with the `(d)` shelf marker (`SettingsSkillsItem`), and emits a `source-duplicate-id` warning. The warning stays one line per source (162fdb9 — a 100-drop source no longer buries the shelf) and the panel prints the detail verbatim. Grounded in the open-design BUG analysis (2026-10-05): same-title cross-listed frames are distinct features (generate-from-spec vs bundled render), so only true id collisions dedupe. Tests: tests/unit/skill-shelf/dedupe.test.ts.

### Bug fixes

- **Apply flips every row sharing an id — ghost twins** (ec912b7) — toggling one row of a duplicate-id pair left its sibling stale in the UI; apply now flips every row sharing the id so the shelf never shows a ghost state. Tests: skill-shelf apply suite.
- **Uninstall of a vanished installed folder reconciles** (cf8316c) — uninstalling a skill whose installed folder was already deleted deadlocked the reconciliation; it now reconciles the signature bookkeeping and reports honestly instead. Tests: skill-shelf roundtrip suite.
- **Harvest progress sidecar restored** (21ad689, after revert b0b8ed0 and re-land ea9eb3c) — the repo-external engine move dropped the refresh progress sidecar; restored and pinned by tests/unit/skill-shelf/progress-sidecar.test.ts before the dedupe feature re-landed on top.

### Housekeeping

- Skills reference material moves to the parent folder (2b026bc) with reference paths updated (49606cd).

## v0.6.5

Bumped from v0.6.4 — the composer's shelf finder learns to answer mid-draft and markdown documents keep their cards after an update.

### Features

- **The Line Trigger** (e960f19, ADR-0014) — the composer's `?` shelf finder fires at the start of ANY line, not only line one, so boilerplate can be pulled from the shelf below typed prose (`?adr, spec + task`); the term splitter accepts `,` and `+` alongside `;` and whitespace, client and server in lockstep. Run mode (`!`) stays draft-scoped by design. Tests: tests/unit/prompt-trigger.test.ts (ADR-0014 describe), tests/unit/prompts-db.test.ts (widened parity fixture).
- **The Markdown Cards** (b1bb0b6, ADR-0013) — inside the expanded FilesEditedCard, created markdown renders first as a two-per-row card grid (MD badge, basename, directory, counts) before the flat list; clicking opens the file through the transcript's file-link pipeline. Tests: tests/unit/files-edited-card.test.ts.

### Bug fixes

- **Updated markdown keeps its card — The Updated Markdown Incident** (67fa90b, ADR-0013 v2) — the original `deleted === 0` heuristic dropped a markdown file from the card grid on any turn that edited it after creation, burying the most recently changed document in the flat list. Amended rule: a card is a `.md` path with a real content change (added > 0 OR deleted > 0); the card now shows symmetric +/− count chips. Tests: the "UPDATED markdown rides the grid too" / "pure-deletion markdown" / "metadata-only" block in tests/unit/files-edited-card.test.ts (shown red before the fix).

## v0.6.4

Bumped from v0.6.3 — the turn-usage surface stops under-counting: the provider's exact total becomes the headline and the detail rows always sum to it (The Exact Total, ADR-0012).

### Features

- **Turn usage trusts the provider's exact total** (24ff847, ADR-0012 D1) — the token-usage shape carries the wire totalTokens (safe positive counts, copied verbatim, never synthesized), turnUsage() aggregates it all-or-nothing (D3), and the pill + popup headline show it; the bucket sum stays as the fallback. Fixes a 48% under-count against DSH's own pill on providers that fold cached input into the total without a cache bucket (zai/glm-5.3-flash: 11,507 shown vs 22,259 billed). Tests: tests/unit/dsh-events-usage.test.ts and the turn-grouping "the exact total" block.
- **Implied cached-input row** (24ff847, ADR-0012 D2) — when the provider's cache bucket is absent, the popup derives the unitemized remainder (total minus output minus input minus cache-write) as a marked "~ implied" row, so detail rows sum exactly to the headline; copy localized across en/zh/id/es with the parity gate (messages-parity.test.ts). Tests: tests/unit/turn-usage-panel.test.ts (three display shapes).

### Bug fixes

- **Usage pill double-count corrected** (24ff847) — a turn whose cache buckets overlapped the prompt total previously showed the bucket sum (10,479 for a 5,479-token turn); the pinned expectation in chat-components.test.ts was updated with the fix.

### Housekeeping

- dsh pin moves to 0.2.1-alpha.1 (package.json webVersion, 827add2); the DSH jump impact analysis lives in ADR-0012 section 2 fact 8: no host-side usage-accounting change in the jump.
- Spec discipline note: ADR-0012 shipped with its full spec set (PRD, Tasks.md, Tasks.json twin, karpathy-context) under dev/specs/2026-10/.

## v0.6.3

Bumped from v0.6.2 — the synced pair survives a busy 3080, first-run npx downloads are no longer silent, and the dsh pin moves to 0.2.0-rc.1.

### Features

- **`dsi dsh --port <n>` forwards to the host half** (a5d5b5b) — when 3080 is held by a `dsh web` this CLI does not own (another live conversation floor), the preflight no longer kills it; the forwarded flag goes to `dsh web` untouched and DSI follows via `DSH_BASE_URL`, so the page dials the host wherever it landed (`bin/dsi.mjs` `hostPortFromArgs`, `runSyncedPair`).
- **First-run npx download heads-up** (a5d5b5b) — a new pinned dsh installs for minutes with zero output when piped through the token watcher; the CLI now probes the `_npx` cache (`dshPackageCached`) and prints a heads-up before spawning the host.
- **dsh pin 0.1.7-rc.2 → 0.2.0-rc.1** (a5d5b5b, `package.json`) — the Model Gate release; impact analysis in `dev/kb/releases/2026-09-29`.

### Bug fixes

- **Orphan detection covers the npx-published launch** (a5d5b5b) — the real argv shape is `node …/_npx/<hash>/node_modules/.bin/dsh web`, matched by neither `lib/bin.js` nor the npx shims pattern; a new orphan pattern stops the preflight from restarting over it.
- **Prompt textarea refocus after a tag-chip toggle** (a5c3f04) — toggling a tag chip stole focus from the prompt; the strip refocuses the textarea.

### Housekeeping

- File editor host scaled down to zoom 0.85 (ee4d7e1); Model Gate release notes added under `dev/kb/releases/`.

## v0.6.2

Bumped from v0.6.1 — the plugin rack survives duplicate catalog ids and the resource shelves are refreshed.

### Bug fixes

- **Duplicate catalog ids no longer crash the rack** (eff3e4f) — the catalog can list two distinct plugins under one id (e.g. `dsh-deepresearch` by omdsh-dev and havingautism), and keying rows by `plugin.id` threw `each_key_duplicate`; rows now key by the engine row number `plugin.n`, pinned by the duplicate-id regression test in `tests/unit/plugin-rack-panel.test.ts`.
- **Tighter rack rows** — rack-row vertical padding trimmed (0.3rem → 0.12rem) so the numbered list scans cleanly.

### Housekeeping

- `plugins-reff.md` and `skills-reff.md` refreshed: sequential numbering, a new `open-design` skill entry, and the plugins shelf trimmed to the installed pick (`dsh-agent-teams`).

## v0.6.1

Bumped from v0.6.0 — the Plugin Rack bounce is fixed for real and the rack reads like a list.

### Features

- **Busy verbs spin, the panel rides the bounce by itself** (dc69965) — a running plugin verb shows a spinner on its rack row and the panel auto-follows a restart bounce instead of needing a manual refresh; stale i18n keys dropped from all four catalogs (en/es/id/zh), pinned by `plugin-rack-panel.test.ts`, `restart-chain.test.ts` and `plugin-i18n-parity.test.ts`.
- **Rack rows number like a list** (161ee8d) — rows render as `1.` `2.` `3.` with a snug gap, so the rack scans like an ordered list (`PluginManagerRackRow.svelte`).

### Bug fixes

- **The bounce comes back** (9501315) — the post-install restart had gone silent: pkill's pattern match missed the real listener, so the bounce now sweeps the port listener itself, restores dev-mode fidelity (the dev server restarts as dev, not prod), and writes a chain journal of every restart step; `restart-chain.test.ts` grew 57 lines of regression pins.
- **Bounce detects the dev floor in the process table, not the env** (26fe77d) — dev detection read an env var the relaunched process never had; `bin/dsi.mjs` + `bin/lib/plugin-chain.mjs` now find the dev floor by inspecting the process table, pinned in `dsi-plugin-chain.test.ts`.
- **Reload verb rebuilds the snapshot** (8958275) — reload re-read a stale cache, showing pre-reload rows; the verb now rebuilds the snapshot from disk and `plugin-rack-panel.test.ts` pins it. `plugins-reff.md` updated to match.

### Housekeeping

- Stray `tmp/commit-msg.txt` scratch file dropped (642b396).

## v0.6.0

Bumped from v0.5.38 — The Plugin Rack wave: plugins install through dsh and restart through dsi, `/dsi-plugins` joins the slash menu, and markdown grows real external links.

### Features

- **The Plugin Rack (W1–W4)** (0381eb0, 4ccc5ad, 9e03af1, e22eaa3, 50ebc7d; ADR 2026-09-27) — plugins become a managed shelf: a rack engine (`rack.mjs` + `src/lib/server/plugins/engine.ts`) owns install/uninstall with the manifest as the uninstall authority (D4); `/api/plugins/{apply,reload,snapshot}` wire it to the wire; `/dsi-plugins` joins the slash menu and command help (abbf5b4); the PluginManagerPanel gives the rack a two-tab chrome — install vs uninstall — with per-row state, snapshot/search/capture toolbar (92a4e2f), rows opening the repo and creator profile (885330d), and a hard-reload-surviving active tab (1c723cc). Proven by `plugin-rack-engine.test.ts`, `plugin-rack-macro.test.ts`, `plugin-rack-panel.test.ts`, `plugin-rack-panel-edges.test.ts`, `api-plugins-*.test.ts`, `dsi-plugin-chain.test.ts`, `plugin-i18n-parity.test.ts`.
- **Skill shelf reorganization** (6da530a, 58dbed5, 92f4b12) — the skills panel splits into Header/Actions/Tabs components on the shelf-chrome pattern, renamed to the SettingsSkills* family.
- **Bare-URL autolink + external host icons** (416f7e4) — a bare http(s) URL in any transcript renders as a hardened anchor: display text is origin+path, the href keeps the full query/hash, and every external link gains its host favicon (Google s2 service); pinned by six new cases in `markdown.test.ts`.
- **Whole-URL code spans render as links** (2251847) — a code span that is entirely one http(s) URL upgrades to the icon'd external link; code that merely contains a URL stays literal (tool-payload rule holds).
- **README filled out** (e7e1321) — plain-language paragraphs for autocomplete (`?`), macros (`!`), the prompt/plugin/skill managers, the multi-tab terminal, and the workspace explorer.

### Bug fixes

- **Slash-menu tests stale after the 9th gesture** (e93b519) — `pluginrack` (`/dsi-plugins `) joined `MENU_GESTURES` at index 5 without the tests following; the ladder, counts (8→9), `@mention` index and highlight offsets re-synced to the ADR D1 contract — 25/25 + 26/26 green, full suite 4,536.
- **Markdown angle-bracket destinations** (152aecb) — `[label](<path>)` destinations sanitize to bare paths instead of leaking the wrapper.
- **Favicon service reliability** (2251847) — DuckDuckGo's ip3 icon service (TLS failures, wrong marks) replaced with Google s2 favicons, verified returning the true GitLab mark.

### Housekeeping

- Coverage lifted to the 80% per-file floor across 8 files (fdee648); `api-plugins-reload-route` and `restart-chain` unit tests added (e5dfd90); committed tmp scratch files dropped (9e73db4, 401e1b1, 8a8f9c3, e4d74cf); intentional `state_referenced_locally` warnings silenced (f621a05).

## v0.5.38

Bumped from v0.5.37 — the Fullpath Bow file-link wave lands, the editor moves to monaco 0.57, and the workspace image preview is re-rooted on the local filesystem.

### Features

- **Fullpath Bow — file-link intents** (6895fdb, 5ee7c9a, aa4dbfb, d9238cd) — transcript file links resolve against the workspace root before the existence gate (tilde/unexpanded roots included), gain inline extension icons, and open intents reveal the deep explorer tree row (ADR 2026-09-26 D1–D3); proven by headed Playwright runs and operator regression tests.
- **monaco-editor 0.55.1 → 0.57.0** (554ed34) — dependency and pnpm override bumped; `monaco-worker-decls.d.ts` restores the esm worker entry typing 0.57 dropped; svelte-check identical to baseline, vitest and build green.

### Bug fixes

- **Workspace image previews broken** (4f22323) — the host's `readBytes` wire contract changed under the untouched route (range → options + multipart receipts, 0.1.7-rc.2), starving the `<img>`. The route now reads the workspace filesystem directly, contained to the root (.. walk → 403) — a read-only local GET never needed the RPC hop; regression-pinned by the rewritten `workspace-file-bytes-route.test.ts` (8 cases).
- **Git-watch double ring** (a765260) — stability confirmation collapses the FSEvents two-window double ring; one bump per git op.
- **35 svelte-check type errors** (29d113e) — all in test files (FakeES interface, self-referential mock editor, `it.each` typing, mount props); fixed with no test-intent change, verified error-list-identical on unrelated files.
- **Yaml worker console noise / crash** (9309afc, 1ff604b, 51a886f, 3bda4c2, 4cb94fd, 8f07f01) — the monaco-yaml worker boot race silences its `Missing requestHandler` noise, no-op base-feature providers stop doomed worker calls at the source, monaco 0.56's uncaught worker throws disable yaml validation, the 0.55.1 override restores full language services, and `.yaml/.yml` finally serves as plaintext editors (monaco-yaml protocol incompatible with installed monaco).
- **Unrenderable mermaid blocks** (6ac2685) — fence styles, a reserved Box alias, and lexer-hostile message text fixed; full parse sweep added.

## v0.5.37

Bumped from v0.5.36 — the chat → composer reorganization lands whole: source tree, tests, and dev-docs now agree on one component map.

### Features

- **File link raw-href seam** (addd926) — transcript file links open with the `#L` anchor line jump, user-bubble parity with assistant bubbles, and explorer highlight on open; manual-verify artifacts kept out of the repo (0f57020 keeps only the verify script).
- **dsi-bump-up skill** (9edadd8) — the vrelease ritual (version bump, releases.md section, commit+push, dsi-sync mirror) is now a repeatable skill instead of tribal memory.

### Bug fixes

- **File link dot-dot traversal probe** (f83adf6) — the dot-dot fast-fail now runs inside the existence gate, so direct traversal paths no longer fire a probe fetch.
- **Stale coverage excludes after the component moves** (5d37eef) — `vitest.config.ts` still excluded `composer/TokenCounter.svelte` and `composer/StripTagChips.svelte` at their pre-move paths, so the 80% per-file coverage floor silently re-measured files it was decided not to measure. Excludes now point at `composer/sibling/` and `composer/menu/suggest-strip/`.

### Refactoring

- **components/chat → components/composer** (3299ec3, 42311f3, e069d8e, ca25bff, de1c2e3) — the flat `chat/` namespace is gone: attachment components into `composer/attachment/`, SlashMenu + suggest-strip into `composer/menu/`, six sibling components into `composer/sibling/`, PromptInput renamed Composer; every importer updated.