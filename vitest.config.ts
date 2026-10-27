import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
// Three Tongues W3 (ADR 2026-09-12): tests must read the SAME compiled
// catalogs + cookie contract as the build — single source of truth.
import { paraglideVitePlugin } from '@inlang/paraglide-js';

// Server-only test files — they genuinely need the 'node' environment
// (node:sqlite importers, server-only route seams). Previously expressed as
// environmentMatchGlobs, which vitest 4 removed (RCA 2026-10-25).
const serverOnlyTestFiles = [
	'tests/unit/ui-locale.test.ts',
	'tests/unit/locale-resolver.test.ts',
	'tests/unit/hooks-locale.test.ts',
	'tests/unit/dsh-rpc.test.ts',
	'tests/unit/dsh-connection.test.ts',
	'tests/unit/config.test.ts',
	'tests/unit/insight-config.test.ts',
	'tests/unit/settings-document.test.ts',
	'tests/unit/insight-config-yaml.test.ts',
	'tests/unit/init-config-script.test.ts',
	'tests/unit/api-dsh.test.ts',
	'tests/unit/goal-route.test.ts',
	'tests/unit/workspace-file-route.test.ts',
	'tests/unit/workspace-tree-route.test.ts',
	'tests/unit/a2a-db.test.ts',
	'tests/unit/a2a-watcher.test.ts',
	'tests/unit/git-watch-debounce.test.ts',
	'tests/unit/git-watch-gate.test.ts',
	'tests/unit/git-watch-mocked.test.ts',
	'tests/unit/git-watch-edges.test.ts',
	'tests/unit/explorer-git-events.test.ts',
	'tests/unit/explorer-live-refresh.test.ts',
	'tests/unit/a2a-routes.test.ts',
	'tests/unit/prompts-db.test.ts',
	'tests/unit/prompts-routes.test.ts',
	'tests/unit/session-path.test.ts',
	'tests/unit/dsh-sessions-root-config.test.ts',
	'tests/unit/api-dsh-session-path-route.test.ts',
	'tests/unit/terminal-route-seams.test.ts',
	'tests/unit/prompts-similarity.test.ts',
	'tests/unit/prompts-search.test.ts',
	'tests/unit/dsh-connection-gaps.test.ts',
	'tests/unit/browser-viewport-route.test.ts',
	'tests/unit/browser-session-routes.test.ts',
	'tests/unit/browser-tab-element-routes.test.ts',
	'tests/unit/subagents-route.test.ts'
];

// Vitest 4 inline test.projects entries do NOT inherit the root vite
// plugins/resolve (verified empirically 2026-10-25: $lib alias died for every
// dom suite until these were spread into each project). Factories give each
// project its own plugin instances — vite plugins are stateful.
const makePlugins = () => [
	paraglideVitePlugin({
		project: './project.inlang',
		outdir: './src/lib/paraglide',
		strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
		cookieName: 'dsi.locale'
	}),
	svelte(),
	// node:sqlite externalization — probe-verified 2026-08-25 (spec GAP-2):
	// vite under conditions:['browser'] fails at TRANSFORM time
	// ("Cannot bundle Node.js built-in node:sqlite") for any test that
	// imports node:sqlite. External-only resolution lets vitest hand the
	// specifier to Node itself in the node-env-globed a2a test files.
	// Shape copied from OCI's production vitest.config.ts (verified there).
	{
		name: 'externalize-node-sqlite',
		enforce: 'pre',
		resolveId(source: string) {
			if (source === 'node:sqlite') {
				return { id: 'node:sqlite', external: true };
			}
			return null;
		}
	}
];

const makeResolve = () => ({
	alias: {
		$lib: path.resolve(import.meta.dirname, 'src/lib'),
		'$app/environment': path.resolve(import.meta.dirname, 'tests/stubs/app-environment.ts'),
		'$app/state': path.resolve(import.meta.dirname, 'tests/stubs/app-state.ts'),
		'$app/navigation': path.resolve(import.meta.dirname, 'tests/stubs/app-navigation.ts'),
		// The yaml.worker bundle (settings-monaco's MonacoEnvironment) drags
		// monaco-worker-manager's deep 'monaco-editor/esm/vs/...' import —
		// unresolvable through monaco-editor's exports map — into the unit
		// graph; no glue test spawns workers under happy-dom, so stub the
		// ?worker default export instead.
		'monaco-yaml/yaml.worker?worker': path.resolve(
			import.meta.dirname,
			'tests/stubs/yaml-worker.ts'
		)
	},
	conditions: ['browser']
});

export default defineConfig({
	test: {
		// Vitest 4 removed environmentMatchGlobs (silently ignored — RCA
		// 2026-10-25); the supported mechanism is test.projects. Each project
		// spreads the shared vite plugins/resolve — inline projects do not
		// inherit them from the root config.
		projects: [
			{
				plugins: makePlugins(),
				resolve: makeResolve(),
				test: {
					name: 'dom',
					environment: 'happy-dom',
					include: [
						'tests/unit/**/*.{test,spec}.{ts,js}',
						'tests/live/**/*.{test,spec}.{ts,js}'
					],
					// Everything the node project claims is removed here so no
					// file runs twice.
					exclude: [
						'node_modules',
						'.svelte-kit',
						'dist',
						...serverOnlyTestFiles
					],
					// web-storage first (RCA 2026-10-25): Node 26's built-in localStorage
					// getter shadows happy-dom's and returns undefined without
					// --localstorage-file; the stub swaps in a Map-backed Storage.
					setupFiles: ['tests/stubs/web-storage.ts', 'tests/stubs/fetch-double.ts']
				}
			},
			{
				plugins: makePlugins(),
				resolve: makeResolve(),
				test: {
					name: 'node',
					environment: 'node',
					include: serverOnlyTestFiles,
					setupFiles: ['tests/stubs/web-storage.ts']
				}
			}
		],
		// NOTE: setupFiles live inside EACH project above — vitest 4 inline
		// projects do not inherit them from the root test block.
		coverage: {
			provider: 'v8',
			// text-summary — the headline numbers; text — the per-file table;
			// json-summary — machine-readable totals (coverage/coverage-summary.json)
			reporter: ['text-summary', 'text', 'json-summary'],
			// Emit the report even when tests fail — otherwise failing tests
			// silently hide coverage output (Vitest 4 default is false;
			// observed 2026-10-13 when 3 failing tests suppressed the report).
			reportOnFailure: true,
			// Product code only — tests/fixtures and tests/stubs are test
			// support and stay out of the measured set.
			include: ['src/**'],
			// Svelte compiles every attribute interpolation with a `?? ''`
			// fallback arm. In these files the interpolated values are
			// number/boolean-typed expressions, so those arms are provably
			// unreachable
			// and branch coverage caps at 50%/75% no matter what the tests
			// do. Vitest 4 enforces the GLOBAL per-file threshold on every
			// file even when a more specific glob threshold exists (the glob
			// checks are additive), so exclusion is the only honest gate
			// shape — these stay covered by their own suites.
			exclude: [
				'src/lib/components/composer/sibling/TokenCounter.svelte',
				'src/lib/components/anchor/plan/PlanButton.svelte',
				// StripTagChips: same compiler `?? ''` arm on
				// checked={checked.includes(word)} — boolean, never nullish
				// (observed 2026-09-15); the {#if recTags} arms ARE covered by
				// the direct-mount tests in tests/unit/strip-tag-chips.test.ts.
				'src/lib/components/composer/menu/suggest-strip/StripTagChips.svelte',
				// WorkspaceFileTabs: same compiler `?? ''` arm on the two
				// data-testid attribute interpolations (tab.path ?? '') —
				// provably unreachable: leaf(tab.path) in the label runs BEFORE
				// the button attribute exists and undefined.lastIndexOf throws,
				// so a nullish path can never reach the fallback arm (probed
				// empirically 2026-09-18). Every real arm IS covered by
				// tests/unit/workspace-file-tabs.test.ts.
				'src/lib/components/panels/WorkspaceFileTabs.svelte',
			// GoalSheet: same compiler `?? ''` fallback arms on the
			// {goal.phase} and {goal.roundsStarted}/{goal.maxGoalRounds}
			// interpolations — provably unreachable: all three are required
			// fields of GoalResultGoal and the only mount site (GoalBar) gates
			// nulls (verified 2026-10-19). Every reachable arm IS covered by
			// the direct-mount tests in
			// tests/unit/components/conversation/goal-sheet-{phase,edit-only,clear-only,controls}.test.ts
			// (branch matrix observed pinned at 62.5% before AND after those
			// suites — the 3 remaining arms are the compiler fallbacks).
			// NOTE: component lives at bar/goal-bar/, NOT anchor/goal/ — the
			// stale anchor/ path (from a pre-move commit) silently un-excluded
			// the real file and tripped the 80% gate (observed 2026-10-19).
			'src/lib/components/bar/goal-bar/GoalSheet.svelte',
				// RuntimeContextChip: same compiler `?? ''` fallback arms on the
				// {t(m.runtimeContext)} / {head} text interpolations (coverage-final
				// 2026-10-21: both remaining uncovered binary-expr arms are those
				// compiler fallbacks at L33) — provably unreachable: both
				// expressions are string-typed. Every real arm IS covered by
				// tests/unit/access-mode-confirm-runtime-chip-coverage.test.ts and
				// tests/unit/components/composer/chat-components.test.ts.
				'src/lib/components/message/chips/RuntimeContextChip.svelte',
				// Generated Paraglide output (compiled catalogs + repo junk like
				// README.md/.gitignore) is not product code — and the junk files
				// crash coverage-v8's remapper with fatal PARSE_ERRORs, aborting
				// the whole report (observed 2026-09-14).
				'src/lib/paraglide/**',
				'src/app.html',
				// Types-only and CSS files carry no executable statements, so
				// v8 coverage reports them as 0% rows — pure report noise; the
				// 80% thresholds could never fire on real logic here
				// (observed 2026-10-18).
				'src/app.css',
				'src/app.d.ts',
				'src/svelte-internal-client.d.ts',
				'src/lib/types.ts',
				'src/lib/server/terminal/types.ts',
				// Monaco worker bootstraps: each *-worker.ts / yaml-worker-entry.ts
				// is a spawn-time module (side-effect imports only) and the decls
				// file is ambient types — no testable statements, 0% report noise
				// (observed 2026-10-18).
				// settings-monaco.ts is REAL glue code and stays measured.
				'src/lib/components/monaco/settings-editor-worker.ts',
				'src/lib/components/monaco/settings-json-worker.ts',
				'src/lib/components/monaco/settings-css-worker.ts',
				'src/lib/components/monaco/settings-html-worker.ts',
				'src/lib/components/monaco/settings-ts-worker.ts',
				'src/lib/components/monaco/yaml-worker-entry.ts',
				'src/lib/components/monaco/monaco-worker-decls.d.ts',
				// prompts/db.ts is the frozen ADR-0022 re-export seam (header +
				// re-exports only, verified 2026-10-18); the logic it forwards to
				// in connection/similarity/search/crud.ts is measured there.
				'src/lib/server/prompts/db.ts'
			],
			reportsDirectory: './coverage',
			// Per-file 80% floor on all four metrics.
			thresholds: {
				perFile: true,
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80
			}
		}
	}
});
