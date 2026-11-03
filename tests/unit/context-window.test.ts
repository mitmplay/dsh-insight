/**
 * context-window.test.ts — the client-side context-window resolver
 * (src/lib/utils/context-window.ts, OCI parity 2026-08-24).
 *
 * Pinned branches:
 * - falsy model id → undefined (the caller keeps its no-limit fallback)
 * - the user override map (localStorage 'dsi-ctx-windows') wins over the
 *   built-in table; corrupt/absent/non-object junk silently loses
 * - override value sanitizing: only finite numbers > 0 survive
 * - built-in substring match is case-insensitive, first (most specific)
 *   pattern wins, unknown model → undefined
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CTX_WINDOW_OVERRIDES_KEY, contextWindowOf } from '$lib/utils/context-window';

afterEach(() => {
	localStorage.removeItem(CTX_WINDOW_OVERRIDES_KEY);
});

describe('contextWindowOf — falsy ids', () => {
	it.each([null, undefined, ''])('returns undefined for %j', (id) => {
		expect(contextWindowOf(id as string | null | undefined)).toBeUndefined();
	});
});

describe('contextWindowOf — built-in table', () => {
	it.each([
		['glm-5.2', 1_000_000],
		['glm-5-air', 1_000_000],
		['glm-4.6', 200_000],
		['glm-4.5-air', 128_000],
		['glm-4-flash', 128_000],
		['deepseek-reasoner', 128_000],
		['deepseek-chat-v3', 128_000],
		['deepseek-custom-finetune', 128_000],
		['claude-opus-4-1', 200_000],
		['claude-sonnet-4-5', 200_000],
		['claude-3-7-sonnet', 200_000],
		['claude-instant', 200_000],
		['gpt-4.1-mini', 1_000_000],
		['gpt-4o', 128_000],
		['gpt-5', 400_000],
		['kimi-k2-instruct', 256_000]
	])('%s → %i (substring, case-insensitive)', (id, expected) => {
		expect(contextWindowOf(id)).toBe(expected);
		expect(contextWindowOf(id.toUpperCase())).toBe(expected);
	});

	it('the FIRST matching pattern wins — glm-4.6 must not fall through to glm-4', () => {
		expect(contextWindowOf('glm-4.6')).toBe(200_000);
		expect(contextWindowOf('glm-4.6')).not.toBe(128_000);
	});

	it('an unknown model → undefined (the honest ≈Nk ctx fallback)', () => {
		expect(contextWindowOf('mystery-model-9000')).toBeUndefined();
	});
});

describe('contextWindowOf — the override map (localStorage)', () => {
	it('an exact-id override beats the built-in table', () => {
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, JSON.stringify({ 'glm-5.2': 200_000 }));
		expect(contextWindowOf('glm-5.2')).toBe(200_000);
	});

	it('an override supplies a window for a model the table does not know', () => {
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, JSON.stringify({ 'my-model': 42 }));
		expect(contextWindowOf('my-model')).toBe(42);
		// Overrides match EXACT id only — no substring semantics.
		expect(contextWindowOf('my-model-v2')).toBeUndefined();
	});

	it('junk payloads silently lose to the built-in table', () => {
		for (const raw of ['not json', '[1,2]', 'null', '"str"', '42', '{"m": "txt"}']) {
			localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, raw);
			expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
			expect(contextWindowOf('my-model')).toBeUndefined();
		}
	});

	it('non-finite, non-positive, and non-number override values are dropped', () => {
		localStorage.setItem(
			CTX_WINDOW_OVERRIDES_KEY,
			JSON.stringify({ a: 0, b: -5, c: Infinity, d: NaN, e: '100', f: 64 })
		);
		expect(contextWindowOf('a')).toBeUndefined();
		expect(contextWindowOf('b')).toBeUndefined();
		expect(contextWindowOf('c')).toBeUndefined();
		expect(contextWindowOf('d')).toBeUndefined();
		expect(contextWindowOf('e')).toBeUndefined();
		expect(contextWindowOf('f')).toBe(64);
	});

	it('an empty or absent map behaves like no overrides', () => {
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, '');
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, '{}');
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
	});
});
