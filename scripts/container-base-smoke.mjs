// ADR-0064 D7 / task 4.1 — cold-room smoke install.
// Pack the container-base tarball, scaffold a scratch vite+svelte app in a
// temp dir OUTSIDE the workspace, install ONLY from the tarball (file:),
// embed themeApplierScript + ThemeToggle, and prove html[data-theme] lands
// BEFORE the first-paint marker — and survives a hard reload after the
// consumer chooses dark. No workspace symlinks, no registry credentials.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = join(ROOT, 'packages/container-base');
const PORT = 4199;
// --registry: post-publish form (RELEASE.md step 4) — install from the
// REGISTRY instead of the local tarball. Needs no credentials to verify.
const FROM_REGISTRY = process.argv.includes('--registry');

async function main() {
	const room = mkdtempSync(join(tmpdir(), 'container-base-smoke-'));
	let server = null;
	const log = (...a) => console.log('[smoke]', ...a);
	log('cold room:', room);

	try {
		// 1. pack the tarball fresh from the worktree (npm cache kept in the room)
		let dep;
		if (FROM_REGISTRY) {
			dep = '^' + JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version;
			log('installing from REGISTRY:', dep);
		} else {
			const packOut = execFileSync('npm', ['pack', '--pack-destination', room], {
				cwd: PKG_DIR,
				encoding: 'utf8',
				env: { ...process.env, npm_config_cache: join(room, 'npm-cache') }
			}).trim().split('\n').pop();
			dep = 'file:' + join(room, packOut);
			log('tarball:', packOut);
		}

		// 2. scaffold the scratch app — no workspace manifest exists in this
		// room, so nothing can be dragged in by accident.
		const app = join(room, 'app');
		mkdirSync(join(app, 'src'), { recursive: true });

		writeFileSync(join(app, 'package.json'), JSON.stringify({
			name: 'cold-room',
			private: true,
			type: 'module',
			scripts: { build: 'vite build', preview: 'vite preview' },
			dependencies: {
				'@deepseek-insight/container-base': dep,
				// the optional capture peer (2026-11-19 literal-import fix): the
				// cold room installs it because a peer-absent consumer now fails
				// LOUDLY at its bundler transform (the accepted approach-2 trade)
				'html-to-image': '^1.11.13'
			},
			devDependencies: {
				svelte: '^5.56.1',
				vite: '^8.0.16',
				'@sveltejs/vite-plugin-svelte': '^7.1.2'
			}
		}, null, 2));

		writeFileSync(join(app, 'vite.config.js'), `import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [svelte()] });
`);

		writeFileSync(join(app, 'src', 'main.js'), `import { mount } from 'svelte';
import App from './App.svelte';
mount(App, { target: document.getElementById('app') });
`);

		writeFileSync(join(app, 'src', 'App.svelte'), `<script>
	import '@deepseek-insight/container-base/theme/tokens.css';
	import { createThemePrefs, ThemeToggle } from '@deepseek-insight/container-base';
	import IconSystem from './IconSystem.svelte';
	import IconLight from './IconLight.svelte';
	import IconDark from './IconDark.svelte';

	const prefs = createThemePrefs({ baseKey: 'smoke-theme' });
	prefs.adopt();
	window.__prefs = prefs;

	const icons = { system: IconSystem, light: IconLight, dark: IconDark };
	const optionLabels = { system: 'System', light: 'Light', dark: 'Dark' };
</script>

<ThemeToggle {prefs} triggerLabel="Theme" {optionLabels} {icons} />
`);

		for (const [name, svg] of [
			['IconSystem', '<circle cx="12" cy="12" r="9" />'],
			['IconLight', '<circle cx="12" cy="12" r="5" />'],
			['IconDark', '<path d="M12 3a9 9 0 1 0 9 9" />']
		]) {
			writeFileSync(join(app, 'src', name + '.svelte'), `<script>
	let { size = 16 } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${svg}</svg>
`);
		}

		// 3. install from the tarball only
		execFileSync('npm', ['install'], { cwd: app, encoding: 'utf8',
			env: { ...process.env, npm_config_cache: join(room, 'npm-cache') } });
		log('install from tarball: done');

		// 4. index.html — the applier SOURCE goes inline in <head>, generated
		// from the TARBALL's own dist (proves the built export resolves); the
		// probe script immediately after records the theme BEFORE first paint
		// (the documented applier contract, not pixel checks).
		const { themeApplierScript } = await import(
			join(app, 'node_modules', '@deepseek-insight', 'container-base', 'dist', 'theming', 'applier.js')
		);
		const applier = themeApplierScript('smoke-theme');
		writeFileSync(join(app, 'index.html'), `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>cold-room smoke</title>
	<script>${applier}</script>
	<script>
		window.__smokeProbe = document.documentElement.getAttribute('data-theme');
	</script>
</head>
<body>
	<div id="app"></div>
	<script type="module" src="/src/main.js"></script>
</body>
</html>
`);

		// 5. build + preview the cold-room app
		execFileSync('npx', ['vite', 'build'], { cwd: app, encoding: 'utf8' });
		log('vite build: done');
		server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
			cwd: app, stdio: 'pipe'
		});
		await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error('preview server timeout')), 30000);
			server.stdout.on('data', (d) => {
				if (String(d).includes('http://localhost')) { clearTimeout(t); resolve(); }
			});
			server.on('exit', (c) => reject(new Error('preview exited ' + c)));
		});
		log('preview server up on', PORT);

		// 6. playwright: first paint + hard-reload dark survival
		const { chromium } = await import('@playwright/test');
		const browser = await chromium.launch();
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));

		// 6a. system-resolution theme present BEFORE first paint
		await page.goto('http://localhost:' + PORT);
		const beforePaint = await page.evaluate(() => window.__smokeProbe);
		const atDom = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
		log('probe before paint:', beforePaint, '| data-theme at check:', atDom);
		if (beforePaint === null || beforePaint === undefined) {
			throw new Error('FAIL: html[data-theme] was NOT present before the first-paint probe');
		}

		// 6b. toggle mounted (organ alive from the tarball)
		try {
			await page.getByRole('button', { name: 'Theme' }).waitFor({ state: 'visible', timeout: 10000 });
		} catch (e) {
			console.error('[smoke] page errors so far:', errors);
			console.error('[smoke] body HTML:', await page.evaluate(() => document.body.innerHTML));
			throw e;
		}
		log('ThemeToggle mounted: yes');

		// 6c. choose dark, HARD reload, dark must land before first paint again
		await page.evaluate(() => window.__prefs.set('dark'));
		await page.reload({ waitUntil: 'domcontentloaded' });
		const darkBeforePaint = await page.evaluate(() => window.__smokeProbe);
		const darkAtDom = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
		log('after reload — probe before paint:', darkBeforePaint, '| data-theme:', darkAtDom);
		if (darkBeforePaint !== 'dark' || darkAtDom !== 'dark') {
			throw new Error('FAIL: dark choice did not survive the hard reload (probe=' + darkBeforePaint + ', dom=' + darkAtDom + ')');
		}
		if (errors.length) throw new Error('page errors: ' + errors.join('; '));

		await browser.close();
		server.kill();
		log('SMOKE PASS (' + (FROM_REGISTRY ? 'registry' : 'tarball') + ') — install survived first paint + hard reload');
	} finally {
		if (server) server.kill();
		if (process.env.SMOKE_KEEP) console.log('[smoke] kept room:', room);
		else rmSync(room, { recursive: true, force: true });
	}
}

main().then(
	() => process.exit(0),
	(e) => { console.error('[smoke] FAILED:', e.message); process.exit(1); }
);
