import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Playground SvelteKit config. Dev-only for R2 (no adapter — publishing/build hardening is R3). */
export default {
	preprocess: vitePreprocess(),
	kit: {}
};
