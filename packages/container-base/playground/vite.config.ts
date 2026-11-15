import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Standalone dev server for the playground app — port 5176 (see W1 in Tasks.md).
 * Run from the repo root: pnpm dev:playground
 */
export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [sveltekit()],
	server: { port: 5176, strictPort: true }
});
