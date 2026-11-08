import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	ensureDsiHome,
	readSettingsDocument,
	templateHomePath
} from '$lib/server/settings-document.js';

let root: string;
let template: string;
let home: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dsi-home-template-'));
	template = join(root, 'template');
	home = join(root, 'home');
	mkdirSync(template, { recursive: true });
	writeFileSync(join(template, 'settings.yaml'), 'home:\n  refreshMs: 1234\n', 'utf-8');
	writeFileSync(join(template, 'prompts.sqlite'), 'seed-bytes', 'utf-8');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.DSI_TEMPLATE_PATH;
});

describe('ensureDsiHome', () => {
	it('clones the template into a missing home', () => {
		expect(ensureDsiHome(home, template)).toBe('cloned');
		expect(readSettingsDocument('dsi', join(home, 'settings.yaml')).text).toContain('refreshMs: 1234');
		expect(existsSync(join(home, 'prompts.sqlite'))).toBe(true);
	});

	it('tops up a settings-only seeded home without clobbering it (dsi dsh --sync race)', () => {
		// bin/dsi.mjs seeds settings.yaml (and so the home directory) BEFORE the
		// server child runs — the old exists-guard skipped the DB clone entirely
		// (2026-11-08 RCA: fresh install shipped 0 of 49 template prompts).
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, 'settings.yaml'), 'home:\n  refreshMs: 9\n', 'utf-8');
		expect(ensureDsiHome(home, template)).toBe('merged');
		// seeded settings survive untouched…
		expect(readSettingsDocument('dsi', join(home, 'settings.yaml')).text).toContain(
			'refreshMs: 9'
		);
		// …while the template files the seed never wrote now land.
		expect(readFileSync(join(home, 'prompts.sqlite'), 'utf-8')).toBe('seed-bytes');
	});

	it('merge never overwrites files the home already has', () => {
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, 'settings.yaml'), 'home:\n  refreshMs: 9\n', 'utf-8');
		writeFileSync(join(home, 'prompts.sqlite'), 'live-bytes', 'utf-8');
		expect(ensureDsiHome(home, template)).toBe('merged');
		expect(readFileSync(join(home, 'prompts.sqlite'), 'utf-8')).toBe('live-bytes');
	});

	it('leaves an arbitrary pre-created directory without the seed signature alone', () => {
		mkdirSync(home, { recursive: true });
		expect(ensureDsiHome(home, template)).toBe('exists');
		expect(existsSync(join(home, 'prompts.sqlite'))).toBe(false);
		expect(existsSync(join(home, 'settings.yaml'))).toBe(false);
	});

	it('no-ops without a template', () => {
		expect(ensureDsiHome(home, join(root, 'absent'))).toBe('no-template');
		expect(existsSync(home)).toBe(false);
	});

	it('resolves the template via DSI_TEMPLATE_PATH', () => {
		process.env.DSI_TEMPLATE_PATH = template;
		expect(templateHomePath()).toBe(template);
		expect(ensureDsiHome(home)).toBe('cloned');
	});

	it('clones on a plain settings read when the home is missing', () => {
		const settingsPath = join(home, 'settings.yaml');
		process.env.DSI_TEMPLATE_PATH = template;
		expect(ensureDsiHome(home, join(root, 'absent'))).toBe('no-template');
		const doc = readSettingsDocument('dsi', settingsPath);
		expect(doc.missing).toBe(false);
		expect(doc.text).toContain('refreshMs: 1234');
	});
});
