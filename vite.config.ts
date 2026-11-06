import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { autoTrace } from './src/lib/preprocess/auto-trace.ts';
import { dshHostPlugin } from './vt-plugins/vite-dsh-host.ts';

export default defineConfig({
	resolve: {
		alias: {
			// monaco-worker-manager (monaco-yaml's worker host) imports the
			// deep path 'monaco-editor/esm/vs/...', but monaco-editor's
			// exports map ('./*' → './esm/vs/*') doubles the esm/vs segment
			// and Rolldown fails to resolve it — alias to the physical tree.
			'monaco-editor/esm/vs': fileURLToPath(
				new URL('./node_modules/monaco-editor/esm/vs', import.meta.url)
			)
		}
	},
	plugins: [
		// The In-Process Host (ADR 2026-10-11): inert unless dsi.mjs spawned
		// vite with DSI_DEV_IN_PROCESS=1 — the tandem floor never loads a host
		// from here. Status surface: globalThis.__dshHost.
		dshHostPlugin(),
		// Three Tongues W1 (ADR 2026-09-12): compile messages/{en,zh,id}.json into
		// typed m.* functions under src/lib/paraglide (gitignored, regenerated).
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
			// ADR D3 names the persistence cookie dsi.locale (the browser
			// mirror is this cookie; settings.yaml stays the operator default).
			cookieName: 'dsi.locale'
		}),
		tailwindcss(),
		sveltekit({
			// autoTrace() registers here (OCI docs 2026-07-15 §9). Passing options
			// inline makes svelte.config.js ignored — so the adapter moves inline too.
			preprocess: [autoTrace()],
			adapter: adapter()
		})
	],
	// ADR 2026-09-11 The Packaged Insight D6: the published tarball ships no
	// sourcemaps — 2.8 MB of dev-only text in a distributed minified bundle.
	build: { sourcemap: false },
	// @lucide/svelte (2026-08-27 migration from frozen lucide-svelte) ships
	// RAW .svelte sources — dist/icons/*.js imports ../Icon.svelte. Dev-SSR
	// externalizes node_modules by default, so Node itself would load
	// Icon.svelte → ERR_UNKNOWN_FILE_EXTENSION → every page 500s. noExternal
	// (a TOP-LEVEL vite key, not a plugin option) keeps the package inside
	// Vite's SSR pipeline, where the Svelte compiler handles it — the
	// standard config for Svelte-source component libraries.
	ssr: { noExternal: ['@lucide/svelte'] },
	server: {
		port: 5174,
		strictPort: true
	}
});
