import { describe, expect, it } from 'vitest';
import {
	DSH_DEFAULT_BASE_URL,
	DSI_DEV_PORT,
	dshBaseUrl,
	DEFAULT_A2A_FAST_POLL_MS,
	DEFAULT_A2A_RETENTION_DAYS,
	DEFAULT_A2A_WATCH_TIMEOUT_MS,
	DEFAULT_SIDEBAR_PLACEMENT,
	DEFAULT_CONVERSATION_COLLAPSABLE,
	DEFAULT_CONVERSATION_PROGRESSIVE_FOLD,
	resolveA2aConfig,
	resolveConversationFlags,
	resolveSidebarPlacement
} from '$lib/config';

describe('config', () => {
	it('defaults DSH base URL to the loopback host', () => {
		delete process.env.DSH_BASE_URL;
		expect(dshBaseUrl()).toBe('http://127.0.0.1:3080');
	});

	it('DSH_BASE_URL env overrides the default', () => {
		process.env.DSH_BASE_URL = 'http://localhost:3081';
		expect(dshBaseUrl()).toBe('http://localhost:3081');
		delete process.env.DSH_BASE_URL;
	});

	it('exposes the dev port as a constant', () => {
		expect(DSI_DEV_PORT).toBe(5174);
	});

	it('default base URL matches the constant', () => {
		expect(DSH_DEFAULT_BASE_URL).toBe(dshBaseUrl());
	});
});

describe('resolveA2aConfig — the a2a.* gate site (W4 4.1)', () => {
	it('defaults: 1s fast poll, 10min deadline, 90d retention', () => {
		expect(DEFAULT_A2A_FAST_POLL_MS).toBe(1000);
		expect(DEFAULT_A2A_WATCH_TIMEOUT_MS).toBe(600_000);
		expect(DEFAULT_A2A_RETENTION_DAYS).toBe(90);
		expect(resolveA2aConfig(undefined)).toEqual({
			fastPollMs: 1000,
			watchTimeoutMs: 600_000,
			retentionDays: 90
		});
	});

	it('reads valid values across the ranges (floor + ceiling edges pass)', () => {
		expect(
			resolveA2aConfig({ fastPollMs: 250, watchTimeoutMs: 120_000, retentionDays: 7 })
		).toEqual({ fastPollMs: 250, watchTimeoutMs: 120_000, retentionDays: 7 });
		expect(
			resolveA2aConfig({ fastPollMs: 60_000, watchTimeoutMs: 3_600_000, retentionDays: 3650 })
		).toEqual({ fastPollMs: 60_000, watchTimeoutMs: 3_600_000, retentionDays: 3650 });
		expect(resolveA2aConfig({ fastPollMs: 0, watchTimeoutMs: 60_000, retentionDays: 1 })).toEqual({
			fastPollMs: 0,
			watchTimeoutMs: 60_000,
			retentionDays: 1
		});
	});

	it('0 disables the fast lane — a VALID value, not a miss (kill-switch)', () => {
		expect(resolveA2aConfig({ fastPollMs: 0 }).fastPollMs).toBe(0);
	});

	it('rejects out-of-range, floats, and non-numbers per key', () => {
		for (const fastPollMs of [-1, 60_001, 500.5, '1000', null, true]) {
			expect(resolveA2aConfig({ fastPollMs }).fastPollMs).toBe(1000);
		}
		for (const watchTimeoutMs of [59_999, 3_600_001, 1.5, '600000']) {
			expect(resolveA2aConfig({ watchTimeoutMs }).watchTimeoutMs).toBe(600_000);
		}
		for (const retentionDays of [0, 3651, 2.5, '90']) {
			expect(resolveA2aConfig({ retentionDays }).retentionDays).toBe(90);
		}
	});

	it('a non-record section is three misses — defaults stand', () => {
		const dflt = { fastPollMs: 1000, watchTimeoutMs: 600_000, retentionDays: 90 };
		expect(resolveA2aConfig('fast')).toEqual(dflt);
		expect(resolveA2aConfig([1000])).toEqual(dflt);
		expect(resolveA2aConfig(null)).toEqual(dflt);
	});

	it('per-key independence — one bad key never reverts its neighbors', () => {
		expect(resolveA2aConfig({ fastPollMs: 250, watchTimeoutMs: 1 })).toEqual({
			fastPollMs: 250,
			watchTimeoutMs: 600_000,
			retentionDays: 90
		});
	});
});

describe('resolveSidebarPlacement — the sidebar.placement literal gate', () => {
	it('default is none (the out-of-zoom, by-design rail)', () => {
		expect(DEFAULT_SIDEBAR_PLACEMENT).toBe('none');
	});

	it('both known literals pass through untouched', () => {
		expect(resolveSidebarPlacement('none')).toBe('none');
		expect(resolveSidebarPlacement('panels-zoom')).toBe('panels-zoom');
	});

	it('missing, typo’d, or foreign values fall back to none', () => {
		for (const bad of [
			undefined,
			null,
			'',
			'inside',
			'Panels-Zoom',
			'panels_zoom',
			'zoom',
			1,
			true,
			['panels-zoom'],
			{ placement: 'panels-zoom' }
		]) {
			expect(resolveSidebarPlacement(bad)).toBe('none');
		}
	});
});

describe('resolveConversationFlags — the fold flag gates (ADR-0010)', () => {
	it('defaults are false (fold off, post-answer fold only)', () => {
		expect(DEFAULT_CONVERSATION_COLLAPSABLE).toBe(false);
		expect(DEFAULT_CONVERSATION_PROGRESSIVE_FOLD).toBe(false);
	});

	it('missing/empty/non-record section falls back to defaults', () => {
		const dflt = { collapsable: false, progressiveFold: false, heartbeatType: 'viewport-cap' };
		expect(resolveConversationFlags(undefined)).toEqual(dflt);
		expect(resolveConversationFlags({})).toEqual(dflt);
		expect(resolveConversationFlags(null)).toEqual(dflt);
		expect(resolveConversationFlags('conversation')).toEqual(dflt);
		expect(resolveConversationFlags([true])).toEqual(dflt);
	});

	it('true and false pass through untouched on both keys', () => {
		expect(resolveConversationFlags({ collapsable: true })).toEqual({
			collapsable: true,
			progressiveFold: false,
			heartbeatType: 'viewport-cap'
		});
		expect(resolveConversationFlags({ heartbeatType: 'ticker-cap' })).toEqual({
			collapsable: false,
			progressiveFold: false,
			heartbeatType: 'ticker-cap'
		});
		expect(resolveConversationFlags({ collapsable: false, progressiveFold: true })).toEqual({
			collapsable: false,
			progressiveFold: true,
			heartbeatType: 'viewport-cap'
		});
	});

	it('non-booleans (strings, numbers, null) fall back per key', () => {
		for (const bad of ['true', 'yes', 1, 0, null, {}, []]) {
			expect(resolveConversationFlags({ collapsable: bad, progressiveFold: bad })).toEqual({
				collapsable: false,
				progressiveFold: false,
				heartbeatType: 'viewport-cap'
			});
			expect(resolveConversationFlags({ heartbeatType: bad })).toMatchObject({
				heartbeatType: 'viewport-cap'
			});
		}
	});

	it('keys are independent — one bad key never reverts its neighbor', () => {
		expect(resolveConversationFlags({ collapsable: true, progressiveFold: 'always' })).toEqual({
			collapsable: true,
			progressiveFold: false,
			heartbeatType: 'viewport-cap'
		});
		expect(
			resolveConversationFlags({ collapsable: true, progressiveFold: 'always', heartbeatType: 'ticker-cap' })
		).toEqual({
			collapsable: true,
			progressiveFold: false,
			heartbeatType: 'ticker-cap'
		});
		expect(resolveConversationFlags({ collapsable: null, progressiveFold: true })).toEqual({
			collapsable: false,
			progressiveFold: true,
			heartbeatType: 'viewport-cap'
		});
	});
});
