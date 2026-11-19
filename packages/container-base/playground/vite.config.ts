import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { autoTrace } from '../../../src/lib/preprocess/auto-trace.ts';

/**
 * Standalone dev server for the playground app — port 5176 (see W1 in Tasks.md).
 * Run from the repo root: pnpm dev:playground
 *
 * autoTrace (ADR-0066 D6 follow-up, 2026-11-17): the playground stamps its
 * elements with data-svelte="ComponentName" exactly like DSI — DevTools
 * parity for the second consumer. Passing preprocess inline makes
 * svelte.config.js ignored (same as DSI's vite.config), so vitePreprocess
 * goes too — Svelte 5 handles TS natively.
 *
 * SOURCE RESOLUTION (R11, 2026-11-19): the workspace package's exports map
 * points at dist/, so dev used to render the LAST BUILD — a source edit to a
 * base component was invisible (no HMR) until build:package ran, and the
 * visual pass shipped a fix that the playground literally could not show.
 * The alias resolves the package to its /src tree (the DSI workspace-dev
 * pattern): HMR is live on base components, and a greenfield template cloned
 * from this playground develops against source by default.
 */
const pkgSrc = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	resolve: {
		alias: [
			{
				// exact-subpath first: the tokens door
				find: /^@deepseek-insight\/container-base\/theme\/tokens\.css$/,
				replacement: pkgSrc + '/theme/tokens.css'
			},
			{
				// the public barrel
				find: /^@deepseek-insight\/container-base$/,
				replacement: pkgSrc + '/index.ts'
			}
		]
	},
	plugins: [
		sveltekit({
			preprocess: [autoTrace()],
			kit: {}
		})
	],
	server: { port: 5176, strictPort: true }
});
