import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
// Three Tongues W3 (ADR 2026-09-12): tests must read the SAME compiled
// catalogs + cookie contract as the build — single source of truth.
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
	plugins: [
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
	],
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
			'$app/environment': path.resolve(__dirname, 'tests/stubs/app-environment.ts'),
			'$app/state': path.resolve(__dirname, 'tests/stubs/app-state.ts'),
			'$app/navigation': path.resolve(__dirname, 'tests/stubs/app-navigation.ts'),
			// The yaml.worker bundle (settings-monaco's MonacoEnvironment) drags
			// monaco-worker-manager's deep 'monaco-editor/esm/vs/...' import —
			// unresolvable through monaco-editor's exports map — into the unit
			// graph; no glue test spawns workers under happy-dom, so stub the
			// ?worker default export instead.
			'monaco-yaml/yaml.worker?worker': path.resolve(
				__dirname,
				'tests/stubs/yaml-worker.ts'
			)
		},
		conditions: ['browser']
	},
	test: {
		environment: 'happy-dom',
		// Global fetch double (RCA 2026-09-24): unstubbed relative fetch() from
		// mounted components rode happy-dom's http://localhost:3000 base into a
		// real ECONNREFUSED AggregateError storm (~75 per run, stderr noise only).
		// Same-origin /api/ URLs get a safe synthetic 404; per-test stubs
		// (installDefaultFetch / vi.stubGlobal) replace this when installed.
		setupFiles: ['tests/stubs/fetch-double.ts'],
		include: ['tests/unit/**/*.{test,spec}.{ts,js}', 'tests/live/**/*.{test,spec}.{ts,js}'],
		exclude: ['node_modules', '.svelte-kit', 'dist'],
		environmentMatchGlobs: [
			// Server-only modules — Node environment, no DOM
			['tests/unit/ui-locale.test.ts', 'node'],
			['tests/unit/locale-resolver.test.ts', 'node'],
			['tests/unit/hooks-locale.test.ts', 'node'],
			['tests/unit/dsh-rpc.test.ts', 'node'],
			['tests/unit/dsh-connection.test.ts', 'node'],
			['tests/unit/config.test.ts', 'node'],
			['tests/unit/insight-config.test.ts', 'node'],
			['tests/unit/settings-document.test.ts', 'node'],
			['tests/unit/insight-config-yaml.test.ts', 'node'],
			['tests/unit/init-config-script.test.ts', 'node'],
			['tests/unit/api-dsh.test.ts', 'node'],
			// goal route — server-only rpc seam (Goal Editor W1)
			['tests/unit/goal-route.test.ts', 'node'],
			// workspace-file route — server-only rpc seam (Workspace Explorer W2)
			['tests/unit/workspace-file-route.test.ts', 'node'],
			// workspace-tree route — server-only rpc seam (bugfix 2026-09-09)
			['tests/unit/workspace-tree-route.test.ts', 'node'],
			// a2a ledger — node:sqlite consumers, externalized + run under Node
			['tests/unit/a2a-db.test.ts', 'node'],
			['tests/unit/a2a-watcher.test.ts', 'node'],
			// git-watch + git-events — chokidar/SSE server seams (Index Pulse W1/W2)
			['tests/unit/git-watch-debounce.test.ts', 'node'],
			['tests/unit/git-watch-gate.test.ts', 'node'],
			['tests/unit/git-watch-mocked.test.ts', 'node'],
			['tests/unit/git-watch-edges.test.ts', 'node'],
			['tests/unit/explorer-git-events.test.ts', 'node'],
			// explorer live invalidation — EventSource seam, DOM-free store logic
			['tests/unit/explorer-live-refresh.test.ts', 'node'],
			['tests/unit/a2a-routes.test.ts', 'node'],
			// prompts library — node:sqlite consumers (Suggest Strip W1)
			['tests/unit/prompts-db.test.ts', 'node'],
			['tests/unit/prompts-routes.test.ts', 'node'],
			// session full path — server-only resolver + config + route seam
			// (The Session Full Path W1, 2026-09-14)
			['tests/unit/session-path.test.ts', 'node'],
			['tests/unit/dsh-sessions-root-config.test.ts', 'node'],
			['tests/unit/api-dsh-session-path-route.test.ts', 'node'],
			// terminal route seams — server-only registry/session mocks
			['tests/unit/terminal-route-seams.test.ts', 'node'],
			// prompts similarity + search math — node:sqlite consumers
			['tests/unit/prompts-similarity.test.ts', 'node'],
			['tests/unit/prompts-search.test.ts', 'node'],
			// dsh-connection coverage-gap tests — server-only transport seams
			['tests/unit/dsh-connection-gaps.test.ts', 'node']
		],
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
			// tests/unit/components/anchor/goal/goal-sheet.test.ts.
			'src/lib/components/anchor/goal/GoalSheet.svelte',
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
