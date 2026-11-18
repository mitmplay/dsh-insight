# @deepseek-insight/container-base

Generic container furniture extracted from DeepSeek Insight (ADR-0062, R1):
zoom viewport, pane shells, rail + gutter, layout math, action registry,
armed-chord keyboard machine, prefs storage primitive, and a default theme
token set.

## Install (npm)

```sh
npm i @deepseek-insight/container-base
```

svelte 5 is the only peer dependency (required — the package ships zero
runtime dependencies). The package is published with built `dist/` output
plus the raw `.svelte` sources packed alongside (ADR-0064 D2), so both
Svelte-aware toolchains and plain bundlers resolve a usable entry.

### Consumption modes

| Mode | Who | What they get |
| --- | --- | --- |
| npm (`npm i`) | any Svelte 5 app | `dist/index.js` + `dist/index.d.ts` via the hardened exports map; component `.svelte` sources ride in the tarball for the toolchain to compile |
| workspace source (`workspace:*`) | DSI and the playground in this repo | same exports map, resolved through the pnpm workspace link — dist **plus** the packed raw sources (ADR-0064 D2 scope amendment) |

DSI vocabulary (paraglide, session types, domain unions) never enters this
package (boundary audit, task 5.3-T). The single public surface remains
`index.ts` — `dist/index.js` is built from it, never a second API.

### Embedding the pre-paint theme applier

The applier ships as a script **source** the consumer generates into its
HTML template, so the theme lands before first paint (no flash):

```html
<!-- src/app.html — inside <head>, before %sveltekit.head% -->
<script>${themeApplierScript('my-theme')}</script>
```

```ts
// a shared module / build step of the consumer
import { themeApplierScript } from '@deepseek-insight/container-base';
// generate the string once and inject it into app.html
```

The survival-organs list below works identically in both modes — the
published tarball contains every organ listed.

---

## Storage-key naming convention (ADR-0065 D9)

Every consumer storage key that reaches this package follows one grammar:

```
<prefix>-<name>[_<profile>]
```

- **prefix = consumer identity**: `dsi` (DeepSeek Insight), `pg` (the
  playground), `cb` (container-base itself). A prefix is declared, not
  assumed — `declareRegistryPrefixes(['dsi', 'pg', 'cb'])`.
- **separator is a single hyphen**. Dot-separated keys (`pg.panel`,
  `pg.locale`) were the drift this law exists for — the playground
  renamed them (`pg-panel`, `pg-locale`, ADR-0065 W4) and the grammar
  scan (`tests/storage/key-grammar.test.ts`) runs with zero pending.
- **the profile suffix (`_widi`) belongs to `storageKey(base, profile)`**
  alone — never hand-roll a `_profile` or a dot separator; the namespace
  module owns the runtime suffix and the grammar test owns the law.

Enforcement is TEST-side only (`tests/storage/key-grammar.test.ts`): the
runtime never throws on a key, so existing consumers cannot break —
`isGrammarCompliant` is a predicate, and the CI scan asserts DSI's
`dsi-panels` stays compliant.

---

## R2 — the survival organs (ADR-0063)

Everything a second consumer would otherwise re-roll badly now ships here:

- **`createThemePrefs({ baseKey })`** — the Three-State Lamp mechanism: choice `system/light/dark`, OS resolution, `html[data-theme]` hinge, profile-suffixed key.
- **`themeApplierScript(baseKey)`** — the pre-paint inline script SOURCE the consumer generates into its HTML template (see each app's `sync` script / `src/app.html`). It re-derives the identical key grammar.
- **`ThemeToggle`** — generic lamp mount: `prefs`, `triggerLabel`, `optionLabels`, `icons`, `dropUp`. Zero words, zero colors.
- **`createLocalePrefs({ baseKey, cookieName, locales, defaultLocale })`** — locale survival: dual-write (storage + mirror cookie the consumer's SSR chain reads), cookie→storage→default resolution, junk fallback.
- **`LanguageMenu`** — generic language mount: `prefs`, `locales`, `labels` (native names), `triggerLabel`, `icon`, `dropUp`. The base never translates.
- **`SliderWidth` / `SliderZoom`** — honest-slider controls: `WIDTH_BOUNDS`/`ZOOM_BOUNDS` defaults (prop-overridable), per-input live commit via `oncommit`, captions via snippet, `testId` stems.
- **`SidebarContainer`** — the sidebar shell: collapsed stub / embedded bare rail / standalone width-wrapper + gutter. Words and skin via snippets; state page-owned.
- **`createPrefsStore`** — the persistence primitive (SSR guard, junk fallback, clamp, best-effort write). Blob shapes are consumer-owned.

## R8 — the PanelListbox family (ADR-0070)

The one listbox grammar every sidebar tray consumes — four presentational
organs (props in, callbacks out, zero consumer state):

- **`PanelListbox`** — the group box + collapse wiring. `count === 0` with
  no `emptysnippet` renders NOTHING (D7). Dressing via `--panel-listbox-wash`,
  `--panel-listbox-border`, `--panel-listbox-radius` with neutral defaults (D5).
- **`PanelListboxHeader`** — chevron (`expanded`, honest `aria-expanded`,
  `onToggle`) + label area (`label` English default or a rich-stem snippet)
  + `trailing` actions snippet for consumer domain controls (D3).
- **`PanelListboxList`** — internal scroll grammar only: `flex: 1 1 auto`,
  `min-height: 0`, `overflow-y: auto`. Any outer pane cap (e.g. DSI's 50%)
  stays the consumer's wrapper (D8).
- **`PanelListboxListItem`** — row shell + `onselect` + content
  snippet; never a verb set (D4). `linked` (D2): when true, emphasis
  follows the consumer-provided `selected` (the selectedPanelId contract);
  when false the row ignores selection entirely. R9 `href` (ADR-0071 D2):
  three renderings of one grammar — `href` → an anchor that STILL fires
  `onselect` (the consumer may preventDefault a handled click);
  `onselect` only → a button; neither → an inert element with no click
  handler.
- **`PanelListboxFilter`** — the search-input organ (ADR-0071 D1):
  PLUMBING ONLY — `value` in, `oninput` keystrokes out. It never
  learns what matched; the match pipeline is the consumer's pure module.
  Grammar (stretch / navy ring / placeholder tone / height) via
  `--panel-listbox-filter-*` tokens with neutral defaults.

Every organ takes a `testid` prop with a neutral default (D6). No consumer
color name ever appears in the base — set the vars per surface (DSI's
accent-blue live-set wash, the spine's green, the playground's own).

### The two-app contract

| Fact | DSI | Playground (packages/container-base/playground) |
| --- | --- | --- |
| theme key | `dsi-theme` | `pg-theme` |
| locale key + cookie | `dsi.locale` (paraglide SSR reads it) | `pg.locale` |
| sliders blob | route-owned via panel prefs | `pg.panel` `{width, zoom}` |

Keys and cookies are per-app choices — the apps never share identity, only
mechanism. `?profile=<name>` suffixes every storage key (per-desk memory),
and the pre-paint applier re-derives that suffix before first paint.

The survival matrix (`tests/e2e/survival-matrix.spec.ts`) proves it live:
theme x locale x {DSI, playground} x reload at FIRST PAINT, plus
independence and junk-blob rows.
