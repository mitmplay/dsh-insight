/**
 * InjectedShelfButton BRANCH tests — raises the component's branch
 * coverage (the earlier 4.4-T host suite exercises mostly happy paths).
 * Every conditional in InjectedShelfButton.svelte is hit here:
 * 1. {#if members.length > 0} both ways (empty shelf → renders nothing).
 * 2. onpointerdown: button === 0 toggles; button !== 0 never toggles.
 * 3. onclick: detail === 0 (keyboard) toggles; detail > 0 (real click) does
 *    NOT toggle again — press already owns the gesture (2026-11-21 note).
 * 4. pick(): closes the popup, parses with { add: true }, and runs
 *    executeCommand with the exact ctx { sessionId, workspace: null,
 *    agent: null, panelId, entries } and the onnote sink (D6).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/chat/command-parser', () => ({
	loadinjectedCommand: vi.fn((displayPath: string, opts: unknown) => ({
		cmd: '/loadinjected',
		displayPath,
		opts
	}))
}));
vi.mock('$lib/services/chat/command-executor', () => ({
	executeCommand: vi.fn(async () => ({ ok: true }))
}));
import { loadinjectedCommand } from '$lib/services/chat/command-parser';
import { executeCommand } from '$lib/services/chat/command-executor';
import InjectedShelfButton from '$lib/components/anchor/inject-anchor/InjectedShelfButton.svelte';
import type { DsiEntry } from '$lib/types';

function spEntry(seq: number, text: string): DsiEntry {
	return { kind: 'system-prompt', id: `sp:${seq}`, seq, time: seq, text };
}
function instrEntry(seq: number, path: string): DsiEntry {
	return {
		kind: 'user-message',
		id: `u:${seq}`,
		seq,
		time: seq,
		text: 'injected',
		meta: 'instructions',
		metaSource: { changes: [{ action: 'set', scope: path, path, digest: 'd' }] }
	};
}
const ENTRIES: DsiEntry[] = [spEntry(1, 'the prompt'), instrEntry(2, 'AGENTS.md')];

function mountButton(entries: DsiEntry[], onnote?: (ok: boolean, note: string) => void) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(InjectedShelfButton, {
		target,
		props: { entries, sessionId: 's1', workspace: '/w', panelId: 'p1', onnote }
	});
	flushSync();
	return {
		target,
		btn: () => target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}
const press = (el: HTMLElement, button = 0) =>
	el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button }));
const keyboardClick = (el: HTMLElement) => {
	// happy-dom PointerEvent lacks init for detail; click event carries detail.
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
};
const mouseClick = (el: HTMLElement) =>
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

afterEach(() => {
	vi.clearAllMocks();
});

describe('InjectedShelfButton branches', () => {
	it('empty shelf renders NOTHING ({#if members.length > 0} false arm)', () => {
		const h = mountButton([]);
		expect(h.btn()).toBeNull();
		expect(h.target.querySelector('.relative')).toBeNull();
		h.cleanup();
	});

	it('non-empty shelf renders the button and the popup ({#if} true arm)', () => {
		const h = mountButton(ENTRIES);
		expect(h.btn()).not.toBeNull();
		expect(h.btn()?.className).not.toContain('active'); // open === false branch
		h.cleanup();
	});

	it('press with button === 0 TOGGLES open on and off (ternary both ways)', () => {
		const h = mountButton(ENTRIES);
		press(h.btn(), 0);
		flushSync();
		expect(h.btn()?.className).toContain('active');
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).not.toBeNull();
		press(h.btn(), 0);
		flushSync();
		expect(h.btn()?.className).not.toContain('active');
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).toBeNull();
		h.cleanup();
	});

	it('press with a NON-PRIMARY button never toggles (e.button === 0 guard)', () => {
		const h = mountButton(ENTRIES);
		press(h.btn(), 2); // right button
		flushSync();
		expect(h.btn()?.className).not.toContain('active');
		press(h.btn(), 1); // middle button
		flushSync();
		expect(h.btn()?.className).not.toContain('active');
		h.cleanup();
	});

	it('click with detail === 0 (keyboard Enter/Space) toggles open', () => {
		const h = mountButton(ENTRIES);
		keyboardClick(h.btn());
		flushSync();
		expect(h.btn()?.className).toContain('active');
		keyboardClick(h.btn());
		flushSync();
		expect(h.btn()?.className).not.toContain('active');
		h.cleanup();
	});

	it('click with detail > 0 (real mouse click) does NOT re-toggle', () => {
		const h = mountButton(ENTRIES);
		press(h.btn(), 0); // press opens
		flushSync();
		mouseClick(h.btn()); // click must NOT close it (press owns the gesture)
		flushSync();
		expect(h.btn()?.className).toContain('active');
		mouseClick(h.btn()); // still no toggle from a click alone
		flushSync();
		expect(h.btn()?.className).toContain('active');
		h.cleanup();
	});

	it('pick() closes the popup, parses with { add: true }, and runs the executor ctx (D6)', async () => {
		const onnote = vi.fn();
		const h = mountButton(ENTRIES, onnote);
		press(h.btn(), 0);
		flushSync();
		const pick = h.target.querySelector(
			'[data-testid="injected-shelf-item"] .shelf-pick'
		) as HTMLElement;
		pick.click();
		flushSync();
		// pick's first line: open = false.
		expect(h.btn()?.className).not.toContain('active');
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).toBeNull();
		// The parser constructor path — never a re-assembled typed string.
		expect(loadinjectedCommand).toHaveBeenCalledWith('system-prompt.md', { add: true });
		// The executor ctx is the honest shape: workspace/agent null, panelId passed.
		expect(executeCommand).toHaveBeenCalledTimes(1);
		const [parsed, ctx, sink] = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(parsed).toEqual({ cmd: '/loadinjected', displayPath: 'system-prompt.md', opts: { add: true } });
		expect(ctx).toEqual({
			sessionId: 's1',
			workspace: null,
			agent: null,
			panelId: 'p1',
			entries: ENTRIES
		});
		expect(sink).toBe(onnote); // the note sink rides through
		await Promise.resolve(); // void promise settles
		h.cleanup();
	});

	it('pick() works with the OPTIONAL props absent (workspace/panelId/onnote defaults)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(InjectedShelfButton, {
			target,
			props: { entries: ENTRIES, sessionId: 's2' }
		});
		flushSync();
		const btn = target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement;
		press(btn, 0);
		flushSync();
		(target.querySelector('[data-testid="injected-shelf-item"] .shelf-pick') as HTMLElement).click();
		flushSync();
		const [, ctx] = (executeCommand as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
		expect(ctx).toEqual({
			sessionId: 's2',
			workspace: null,
			agent: null,
			panelId: null,
			entries: ENTRIES
		});
		const [, , sink] = (executeCommand as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
		expect(sink).toBeUndefined(); // onnote optional — the executor gets none
		unmount(instance);
		target.remove();
	});
});
