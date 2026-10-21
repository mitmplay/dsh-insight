/**
 * insight-config unit tests — the ~/.dsi/settings.yaml readers
 * (YAML home since 2026-09-07; JSON fixtures stay valid — JSON is a YAML
 * subset, so the legacy-format reads pin the migration's parse too)
 * (OCI readSessionConfig pattern port, 2026-08-25).
 *
 * Node environment (imports node:fs): every case drives the readers through
 * a temp file via the `configPath` seam — the real ~/.dsi is never
 * touched. Defaults carry the page on missing file / missing section /
 * invalid value; relational sections (panel/sidebar bounds) revert crossed
 * pairs instead of ever producing an inverted clamp.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_A2A_CONFIG,
	DEFAULT_CHAT_CONFIG,
	DEFAULT_CONVERSATION_CONFIG,
	DEFAULT_DSH_PRESET_ENGLISH,
	DEFAULT_HOME_CONFIG,
	DEFAULT_PANEL_CONFIG,
	DEFAULT_SERVER_CONFIG,
	DEFAULT_SIDEBAR_CONFIG,
	DEFAULT_PROMPTS_CONFIG,
	DSI_CONFIG_PATH,
	insightConfigPath,
	readA2aConfig,
	readChatConfig,
	readConversationConfig,
	readDshPresetEnglishConfig,
	readHomeConfig,
	readPanelConfig,
	readServerConfig,
	readSidebarConfig,
	readPromptsConfig
} from '$lib/server/insight-config';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-insight-config-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	delete process.env.DSI_CONFIG_PATH;
});

function writeConfig(obj: unknown): string {
	const path = join(dir, 'settings.yaml');
	writeFileSync(path, JSON.stringify(obj), 'utf-8');
	return path;
}

describe('readChatConfig — chat.input.maxRows + accessConfirmTimeoutMs', () => {
	it('defaults when the file is missing', () => {
		expect(readChatConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_CHAT_CONFIG);
	});
	it('defaults when the file is invalid JSON', () => {
		const path = join(dir, 'bad.json');
		writeFileSync(path, '{not json', 'utf-8');
		expect(readChatConfig(path)).toEqual(DEFAULT_CHAT_CONFIG);
	});

	it('defaults when the chat section is absent', () => {
		expect(readChatConfig(writeConfig({ routing: {} }))).toEqual(DEFAULT_CHAT_CONFIG);
	});

	it('reads a positive integer maxRows', () => {
		expect(readChatConfig(writeConfig({ chat: { input: { maxRows: 7 } } })).input.maxRows).toBe(7);
	});

	it('rejects zero, negatives, floats, and non-numbers', () => {
		for (const maxRows of [0, -3, 2.5, '12', null, true]) {
			const cfg = readChatConfig(writeConfig({ chat: { input: { maxRows } } }));
			expect(cfg.input.maxRows).toBe(15);
		}
	});

	it('rejects a non-object chat/input section', () => {
		expect(readChatConfig(writeConfig({ chat: 'nope' })).input.maxRows).toBe(15);
		expect(readChatConfig(writeConfig({ chat: { input: [15] } })).input.maxRows).toBe(15);
	});

	it('reads accessConfirmTimeoutMs within [1s, 120s]; outside reverts', () => {
		expect(readChatConfig(writeConfig({ chat: { accessConfirmTimeoutMs: 3000 } })).accessConfirmTimeoutMs).toBe(3000);
		for (const ms of [999, 121_000, 2.5, '5000']) {
			expect(readChatConfig(writeConfig({ chat: { accessConfirmTimeoutMs: ms } })).accessConfirmTimeoutMs).toBe(12_000);
		}
	});
});

describe('readChatConfig — chat.macro caps (Prompt Macro, 2026-08-29)', () => {
	it('defaults {maxLines: 25, maxDepth: 3} on missing file/section', () => {
		expect(readChatConfig(join(dir, 'nope.json')).macro).toEqual({ maxLines: 25, maxDepth: 3 });
		expect(readChatConfig(writeConfig({})).macro).toEqual({ maxLines: 25, maxDepth: 3 });
		expect(readChatConfig(writeConfig({ chat: { macro: 'nope' } })).macro).toEqual({
			maxLines: 25,
			maxDepth: 3
		});
	});

	it('reads both caps inside their ranges', () => {
		const cfg = readChatConfig(writeConfig({ chat: { macro: { maxLines: 40, maxDepth: 2 } } }));
		expect(cfg.macro).toEqual({ maxLines: 40, maxDepth: 2 });
	});

	it('clamps out-of-range values back to defaults (maxLines [1..500], maxDepth [1..10])', () => {
		for (const maxLines of [0, -3, 501, 2.5, '25', null, true]) {
			expect(readChatConfig(writeConfig({ chat: { macro: { maxLines } } })).macro.maxLines).toBe(25);
		}
		for (const maxDepth of [0, -1, 11, 1.5, '3', null]) {
			expect(readChatConfig(writeConfig({ chat: { macro: { maxDepth } } })).macro.maxDepth).toBe(3);
		}
	});

	it('one bad key falls back alone — the sibling keeps its read value', () => {
		const cfg = readChatConfig(writeConfig({ chat: { macro: { maxLines: 60, maxDepth: 0 } } }));
		expect(cfg.macro).toEqual({ maxLines: 60, maxDepth: 3 });
	});
});

describe('readConversationConfig — BC-7 poll cadence', () => {
	it('defaults on missing file/section', () => {
		expect(readConversationConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_CONVERSATION_CONFIG);
		expect(readConversationConfig(writeConfig({}))).toEqual(DEFAULT_CONVERSATION_CONFIG);
	});

	it('reads both cadences', () => {
		const cfg = readConversationConfig(writeConfig({ conversation: { pollRunningMs: 250, pollIdleMs: 5000 } }));
		expect(cfg).toEqual({
			pollRunningMs: 250,
			pollIdleMs: 5000,
			statsBar: 'full-ledger',
			collapsable: false,
			progressiveFold: false,
			heartbeatType: 'viewport-cap'
		});
	});

	it('fold flags are boolean-gated (ADR-0010) — strict booleans pass, junk falls back', () => {
		const on = readConversationConfig(writeConfig({ conversation: { collapsable: true } }));
		expect(on).toEqual({
			pollRunningMs: 500,
			pollIdleMs: 2000,
			statsBar: 'full-ledger',
			collapsable: true,
			progressiveFold: false,
			heartbeatType: 'viewport-cap'
		});
		const both = readConversationConfig(writeConfig({ conversation: { collapsable: true, progressiveFold: true } }));
		expect(both.collapsable).toBe(true);
		expect(both.progressiveFold).toBe(true);
		for (const junk of ['true', 1, null, []]) {
			const cfg = readConversationConfig(writeConfig({ conversation: { collapsable: junk, progressiveFold: junk } }));
			expect(cfg.collapsable).toBe(false);
			expect(cfg.progressiveFold).toBe(false);
		}
	});

	it('statsBar is literal-gated — only partial | full-ledger pass', () => {
		expect(readConversationConfig(writeConfig({ conversation: { statsBar: 'partial' } })).statsBar).toBe('partial');
		expect(readConversationConfig(writeConfig({ conversation: { statsBar: 'full-ledger' } })).statsBar).toBe('full-ledger');
		for (const bad of ['Full-Ledger', 'ledger', 7, null]) {
			expect(readConversationConfig(writeConfig({ conversation: { statsBar: bad } })).statsBar).toBe('full-ledger');
		}
	});

	it('rejects sub-floor (100ms), over-ceiling (60s), floats', () => {
		for (const ms of [50, 60_001, 1.5, '300']) {
			const cfg = readConversationConfig(writeConfig({ conversation: { pollRunningMs: ms, pollIdleMs: ms } }));
			expect(cfg).toEqual(DEFAULT_CONVERSATION_CONFIG);
		}
	});
});

describe('readConversationConfig — heartbeatType (ADR-0034 D4)', () => {
	it('defaults to viewport-cap on missing file / section / key', () => {
		expect(readConversationConfig(join(dir, 'nope.json')).heartbeatType).toBe('viewport-cap');
		expect(readConversationConfig(writeConfig({})).heartbeatType).toBe('viewport-cap');
		expect(readConversationConfig(writeConfig({ conversation: {} })).heartbeatType).toBe(
			'viewport-cap'
		);
	});

	it('passes both fleet values through', () => {
		expect(readConversationConfig(writeConfig({ conversation: { heartbeatType: 'ticker-cap' } })).heartbeatType).toBe('ticker-cap');
		expect(readConversationConfig(writeConfig({ conversation: { heartbeatType: 'viewport-cap' } })).heartbeatType).toBe('viewport-cap');
	});

	it('falls back to viewport-cap on a foreign value', () => {
		expect(readConversationConfig(writeConfig({ conversation: { heartbeatType: 'turbo' } })).heartbeatType).toBe('viewport-cap');
		expect(readConversationConfig(writeConfig({ conversation: { heartbeatType: 42 } })).heartbeatType).toBe('viewport-cap');
	});
});

describe('readHomeConfig — refresh cadence', () => {
	it('defaults on missing file/section', () => {
		expect(readHomeConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_HOME_CONFIG);
	});

	it('reads refreshMs within [250, 60s]; outside reverts', () => {
		expect(readHomeConfig(writeConfig({ home: { refreshMs: 1000 } })).refreshMs).toBe(1000);
		for (const ms of [100, 60_001, 0.5]) {
			expect(readHomeConfig(writeConfig({ home: { refreshMs: ms } }))).toEqual(DEFAULT_HOME_CONFIG);
		}
	});
});

describe('readA2aConfig — the a2a.* section (W4 4.1)', () => {
	it('defaults when the file is missing, invalid JSON, or the section is absent', () => {
		expect(readA2aConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_A2A_CONFIG);
		const bad = join(dir, 'bad.json');
		writeFileSync(bad, '{not json', 'utf-8');
		expect(readA2aConfig(bad)).toEqual(DEFAULT_A2A_CONFIG);
		expect(readA2aConfig(writeConfig({ home: { refreshMs: 1000 } }))).toEqual(DEFAULT_A2A_CONFIG);
	});

	it('reads the shipped defaults from a real config file', () => {
		const cfg = readA2aConfig(writeConfig({ a2a: { fastPollMs: 1000, watchTimeoutMs: 600000, retentionDays: 90 } }));
		expect(cfg).toEqual({ fastPollMs: 1000, watchTimeoutMs: 600_000, retentionDays: 90 });
		expect(cfg).toEqual(DEFAULT_A2A_CONFIG);
	});

	it('applies the shared gates: out-of-range reverts per key', () => {
		expect(readA2aConfig(writeConfig({ a2a: { fastPollMs: 500 } })).fastPollMs).toBe(500);
		for (const fastPollMs of [-1, 60_001, 500.5, '1000']) {
			expect(readA2aConfig(writeConfig({ a2a: { fastPollMs } })).fastPollMs).toBe(1000);
		}
		expect(readA2aConfig(writeConfig({ a2a: { fastPollMs: 0 } })).fastPollMs).toBe(0);
		expect(readA2aConfig(writeConfig({ a2a: { watchTimeoutMs: 59_999 } })).watchTimeoutMs).toBe(600_000);
		expect(readA2aConfig(writeConfig({ a2a: { retentionDays: 3651 } })).retentionDays).toBe(90);
	});
});

describe('readServerConfig — ring capacity', () => {
	it('defaults on missing file/section', () => {
		expect(readServerConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_SERVER_CONFIG);
		expect(readServerConfig(writeConfig({}))).toEqual(DEFAULT_SERVER_CONFIG);
	});

	it('reads ringCapacity within [10, 10k]; outside reverts', () => {
		expect(readServerConfig(writeConfig({ server: { ringCapacity: 50 } })).ringCapacity).toBe(50);
		for (const cap of [9, 10_001, 2.5, '500']) {
			expect(readServerConfig(writeConfig({ server: { ringCapacity: cap } }))).toEqual(DEFAULT_SERVER_CONFIG);
		}
	});
});

describe('readPanelConfig — floor bounds', () => {
	it('defaults on missing file/section', () => {
		expect(readPanelConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_PANEL_CONFIG);
		expect(readPanelConfig(writeConfig({}))).toEqual(DEFAULT_PANEL_CONFIG);
	});

	it('reads valid bounds', () => {
		const cfg = readPanelConfig(writeConfig({ panel: { defaultWidth: 600, minWidth: 500, maxWidth: 900, minZoom: 0.75, maxZoom: 2 } }));
		expect(cfg).toEqual({ defaultWidth: 600, minWidth: 500, maxWidth: 900, minZoom: 0.75, maxZoom: 2 });
	});

	it('crossed width bounds revert BOTH to defaults (never an inverted clamp)', () => {
		const cfg = readPanelConfig(writeConfig({ panel: { minWidth: 900, maxWidth: 500 } }));
		expect(cfg.minWidth).toBe(DEFAULT_PANEL_CONFIG.minWidth);
		expect(cfg.maxWidth).toBe(DEFAULT_PANEL_CONFIG.maxWidth);
	});

	it('crossed zoom bounds revert both to defaults', () => {
		const cfg = readPanelConfig(writeConfig({ panel: { minZoom: 2, maxZoom: 0.5 } }));
		expect(cfg.minZoom).toBe(DEFAULT_PANEL_CONFIG.minZoom);
		expect(cfg.maxZoom).toBe(DEFAULT_PANEL_CONFIG.maxZoom);
	});

	it('defaultWidth clamps into the resolved bounds', () => {
		const cfg = readPanelConfig(writeConfig({ panel: { defaultWidth: 100, minWidth: 500, maxWidth: 900 } }));
		expect(cfg.defaultWidth).toBe(500);
	});

	it('rejects out-of-range px values (200..4000)', () => {
		const cfg = readPanelConfig(writeConfig({ panel: { minWidth: 10, maxWidth: 99_999 } }));
		expect(cfg).toEqual(DEFAULT_PANEL_CONFIG);
	});
});

describe('readSidebarConfig — rail bounds + placement', () => {
	it('defaults on missing file/section', () => {
		expect(readSidebarConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_SIDEBAR_CONFIG);
	});

	it('reads valid bounds', () => {
		expect(readSidebarConfig(writeConfig({ sidebar: { defaultWidth: 300, minWidth: 240, maxWidth: 400 } }))).toEqual({
			defaultWidth: 300,
			minWidth: 240,
			maxWidth: 400,
			placement: 'none'
		});
	});

	it('reads placement: panels-zoom (the in-zoom rail mode)', () => {
		const cfg = readSidebarConfig(writeConfig({ sidebar: { placement: 'panels-zoom' } }));
		expect(cfg.placement).toBe('panels-zoom');
		// Bounds stay at defaults — placement is orthogonal to them.
		expect(cfg.defaultWidth).toBe(DEFAULT_SIDEBAR_CONFIG.defaultWidth);
	});

	it('placement is literal-gated: unknown/foreign values fall back to none', () => {
		for (const bad of ['inside', 'Panels-Zoom', 'none ', 1, null, true, { mode: 'zoom' }]) {
			expect(readSidebarConfig(writeConfig({ sidebar: { placement: bad } })).placement).toBe('none');
		}
		// Explicit 'none' passes the gate (not just the fallback).
		expect(readSidebarConfig(writeConfig({ sidebar: { placement: 'none' } })).placement).toBe('none');
	});

	it('crossed bounds revert BOTH; defaultWidth clamps into bounds', () => {
		const crossed = readSidebarConfig(writeConfig({ sidebar: { minWidth: 600, maxWidth: 250 } }));
		expect(crossed).toEqual(DEFAULT_SIDEBAR_CONFIG);
		const clamped = readSidebarConfig(writeConfig({ sidebar: { defaultWidth: 9999 } }));
		expect(clamped.defaultWidth).toBe(DEFAULT_SIDEBAR_CONFIG.maxWidth);
	});
});

describe('readPromptsConfig — prompts.tags vocabulary + defaults (The Prompt Tags W1 1.3 / W2 D7)', () => {
	it('defaults to the full default config when the file is missing', () => {
		expect(readPromptsConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_PROMPTS_CONFIG);
	});

	it('defaults when the file is invalid JSON', () => {
		const bad = join(dir, 'bad.json');
		writeFileSync(bad, '{not json', 'utf-8');
		expect(readPromptsConfig(bad)).toEqual(DEFAULT_PROMPTS_CONFIG);
	});

	it('defaults when the prompts section is absent', () => {
		expect(readPromptsConfig(writeConfig({ chat: {} }))).toEqual(DEFAULT_PROMPTS_CONFIG);
	});

	it('defaults on missing file, missing section, empty list, and non-array', () => {
		const expected = { ...DEFAULT_PROMPTS_CONFIG, tags: [...DEFAULT_PROMPTS_CONFIG.tags] };
		for (const path of [
			join(dir, 'nope.json'),
			writeConfig({ prompts: {} }),
			writeConfig({ prompts: { tags: [] } }),
			writeConfig({ prompts: { tags: 'git' } }),
			writeConfig({ prompts: { tags: { a: 1 } } })
		]) {
			expect(readPromptsConfig(path).tags).toEqual(expected.tags);
		}
	});

	it('drops invalid words, keeps the valid ones (order stable)', () => {
		const cfg = readPromptsConfig(
			writeConfig({ prompts: { tags: ['git', 'RCA', '+bad', 'ok_word', 42, null, 'x!'] } })
		);
		expect(cfg.tags).toEqual(['git', 'rca', 'ok_word']);
	});

	it('a fully-invalid list falls back to the defaults', () => {
		const cfg = readPromptsConfig(writeConfig({ prompts: { tags: ['+bad', 'x!'] } }));
		expect(cfg.tags).toEqual(DEFAULT_PROMPTS_CONFIG.tags);
	});

	it('a valid list passes through lowercased and grammar-gated', () => {
		const cfg = readPromptsConfig(
			writeConfig({ prompts: { tags: ['session', 'git', 'plan', 'rca', 'kb'] } })
		);
		expect(cfg.tags).toEqual(['session', 'git', 'plan', 'rca', 'kb']);
	});
});

describe('readDshPresetEnglishConfig — dsh.presetEnglish (shipped-preset overlay gate)', () => {
	it('defaults to presetEnglish true when the file is missing', () => {
		expect(readDshPresetEnglishConfig(join(dir, 'nope.json'))).toEqual(DEFAULT_DSH_PRESET_ENGLISH);
		expect(DEFAULT_DSH_PRESET_ENGLISH.presetEnglish).toBe(true);
	});

	it('defaults when the file is invalid JSON', () => {
		const bad = join(dir, 'bad.json');
		writeFileSync(bad, '{not json', 'utf-8');
		expect(readDshPresetEnglishConfig(bad)).toEqual(DEFAULT_DSH_PRESET_ENGLISH);
	});

	it('defaults when the dsh section or the key is absent', () => {
		expect(readDshPresetEnglishConfig(writeConfig({ dsh: { authToken: 'tok' } }))).toEqual(
			DEFAULT_DSH_PRESET_ENGLISH
		);
		expect(readDshPresetEnglishConfig(writeConfig({}))).toEqual(DEFAULT_DSH_PRESET_ENGLISH);
	});

	it('reads true and false verbatim (the toggle is explicit)', () => {
		expect(readDshPresetEnglishConfig(writeConfig({ dsh: { presetEnglish: false } })).presetEnglish).toBe(false);
		expect(readDshPresetEnglishConfig(writeConfig({ dsh: { presetEnglish: true } })).presetEnglish).toBe(true);
	});

	it('non-boolean presetEnglish falls back to the default, not coercion', () => {
		expect(readDshPresetEnglishConfig(writeConfig({ dsh: { presetEnglish: 'yes' } })).presetEnglish).toBe(true);
		expect(readDshPresetEnglishConfig(writeConfig({ dsh: { presetEnglish: 0 } })).presetEnglish).toBe(true);
	});
});

describe('insightConfigPath — resolution order', () => {
	it('explicit arg wins', () => {
		expect(insightConfigPath('/tmp/x.json')).toBe('/tmp/x.json');
	});

	it('DSI_CONFIG_PATH env overrides the default before the arg', () => {
		process.env.DSI_CONFIG_PATH = '/tmp/env.json';
		expect(insightConfigPath()).toBe('/tmp/env.json');
		expect(insightConfigPath('/tmp/x.json')).toBe('/tmp/x.json');
	});

	it('default is ~/.dsi/settings.yaml', () => {
		expect(DSI_CONFIG_PATH.endsWith(join('.dsi', 'settings.yaml'))).toBe(true);
		expect(insightConfigPath()).toBe(DSI_CONFIG_PATH);
	});
});
