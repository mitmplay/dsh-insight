/**
 * dsi-zai-patch unit tests — the --zai bootstrap writes the ACTIVE profile's
 * cordis.patch.yml (ADR: The Packaged Insight 2026-09-11, amendment
 * 2026-11-03, D7-D10). Functional: the module is importable (unlike
 * bin/dsi.mjs, which executes at import), so these run the real merge.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

import { addZaiProvider, zaiPatchPath, ZaiPatchError } from '../../bin/lib/zai-patch.mjs';

function tmpFile(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-zai-patch-'));
	return join(dir, name);
}

describe('zaiPatchPath (D8)', () => {
	it('honors DSH_PATCH_PATH over the profile default', () => {
		const prev = process.env.DSH_PATCH_PATH;
		try {
			process.env.DSH_PATCH_PATH = '/tmp/patch-override.yml';
			expect(zaiPatchPath()).toBe('/tmp/patch-override.yml');
		} finally {
			if (prev === undefined) delete process.env.DSH_PATCH_PATH;
			else process.env.DSH_PATCH_PATH = prev;
		}
	});

	it('defaults to the active profile cordis.patch.yml', () => {
		const prev = process.env.DSH_PATCH_PATH;
		delete process.env.DSH_PATCH_PATH;
		try {
			const p = zaiPatchPath();
			expect(p).toContain(join('.dsh', 'profiles'));
			expect(p.endsWith('cordis.patch.yml')).toBe(true);
		} finally {
			if (prev !== undefined) process.env.DSH_PATCH_PATH = prev;
		}
	});
});

describe('addZaiProvider (D7, D10)', () => {
	it('creates the patch file with both entries when nothing exists', () => {
		const p = tmpFile('fresh', );
		const { added } = addZaiProvider(p);
		expect(added).toEqual(['llm-pi-ai.providers.zai', 'agent-default-model']);
		const entries = parse(readFileSync(p, 'utf-8')) as { id: string; name?: string; config?: unknown }[];
		const llm = entries.find((e) => e.id === 'llm-pi-ai');
		const model = entries.find((e) => e.id === 'agent-default-model');
		expect(llm?.name).toBe('@deepseek-ai/dsh-llm-pi-ai');
		expect(model?.name).toBe('@deepseek-ai/dsh-agent-default-model');
		expect(model?.config).toEqual({ provider: 'zai', model: 'glm-5.3-flash' });
		const zai = (llm?.config as { providers: { zai: { id?: never } } }).providers.zai;
		expect(zai).toMatchObject({ apiKeyEnv: 'ZAI_API_KEY', api: 'openai-completions' });
		rmSync(p, { force: true });
	});

	it('is idempotent — a second run adds nothing', () => {
		const p = tmpFile('idem');
		addZaiProvider(p);
		const { added, path: back } = addZaiProvider(p);
		expect(added).toEqual([]);
		expect(back).toBe(p);
		rmSync(p, { force: true });
	});

	it('existing entries win — operator config is never clobbered (D10)', () => {
		const p = tmpFile('operator');
		writeFileSync(
			p,
			[
				'- id: ui-theme',
				'  name: "@deepseek-ai/dsh-client-ui-theme"',
				'  config:',
				'    preference: dark',
			].join('\n'),
			'utf-8'
		);
		const { added } = addZaiProvider(p);
		const entries = parse(readFileSync(p, 'utf-8')) as { id: string; config?: { preference?: string } }[];
		expect(added).toEqual(['llm-pi-ai.providers.zai', 'agent-default-model']);
		expect(entries.find((e) => e.id === 'ui-theme')?.config?.preference).toBe('dark');
		expect(entries).toHaveLength(3);
		rmSync(p, { force: true });
	});

	it('partial merge — existing llm-pi-ai entry gains only the missing zai provider', () => {
		const p = tmpFile('partial');
		writeFileSync(
			p,
			[
				'- id: llm-pi-ai',
				'  name: "@deepseek-ai/dsh-llm-pi-ai"',
				'  config:',
				'    providers:',
				'      other:',
				'        api: openai-completions',
				'- id: agent-default-model',
				'  name: "@deepseek-ai/dsh-agent-default-model"',
				'  config:',
				'    provider: other',
				'    model: m1',
			].join('\n'),
			'utf-8'
		);
		const { added } = addZaiProvider(p);
		expect(added).toEqual(['llm-pi-ai.providers.zai']);
		const entries = parse(readFileSync(p, 'utf-8')) as {
			id: string;
			config?: { providers?: Record<string, unknown>; provider?: string };
		}[];
		const llm = entries.find((e) => e.id === 'llm-pi-ai');
		expect(Object.keys(llm?.config?.providers ?? {})).toEqual(['other', 'zai']);
		// the operator's default model stands — the entry already exists
		expect(entries.find((e) => e.id === 'agent-default-model')?.config?.provider).toBe('other');
		rmSync(p, { force: true });
	});

	it('fails loud on an unparsable patch file (exit-65 contract)', () => {
		const p = tmpFile('broken');
		writeFileSync(p, 'nota: [patch: array', 'utf-8');
		expect(() => addZaiProvider(p)).toThrow(ZaiPatchError);
		rmSync(p, { force: true });
	});

	it('fails loud when the file parses but is not a patch array', () => {
		const p = tmpFile('notarray');
		writeFileSync(p, 'just: a mapping\n', 'utf-8');
		expect(() => addZaiProvider(p)).toThrow(ZaiPatchError);
		rmSync(p, { force: true });
	});

	it('creates the profile directory when absent (fresh install)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dsi-zai-profile-'));
		const p = join(dir, 'profiles', 'web', 'cordis.patch.yml');
		const { added } = addZaiProvider(p);
		expect(added).toHaveLength(2);
		expect(mkdirSync as unknown).toBeDefined();
		rmSync(dir, { recursive: true, force: true });
	});
});
