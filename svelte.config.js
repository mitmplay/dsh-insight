import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Runes pinned: svelte2tsx's per-file rune AUTO-DETECTION is
		// non-deterministic under svelte-check (same bytes flip between
		// runes and legacy-store transforms run to run — 2026-11-22
		// pnpm-check fix). This codebase has zero legacy syntax
		// (no `$:`, no `export let`), so the pin is a no-op at runtime
		// and makes the transform deterministic.
		runes: true
	},
	kit: {
		adapter: adapter()
	}
};

export default config;
