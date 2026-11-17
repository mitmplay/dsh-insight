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
 */
export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [
		sveltekit({
			preprocess: [autoTrace()],
			kit: {}
		})
	],
	server: { port: 5176, strictPort: true }
});
