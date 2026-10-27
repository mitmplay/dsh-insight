/**
 * InjectedShelfButton host tests (Loadinjected W4 4.4-T) — the anchor's
 * Injected leaf (ADR D6): empty shelf renders NOTHING; the popup lists the
 * members in operator order; a pick runs the executor path with the parsed
 * command (--add) and reaches the floor handler — never a second write
 * path (the source contract pins it: the button imports the executor, not
 * the registry).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import InjectedShelfButton from '$lib/components/anchor/inject-anchor/InjectedShelfButton.svelte';
import {
	addPanelFromSidebar,
	registerAddPanel,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';
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

const ENTRIES: DsiEntry[] = [
	spEntry(1, 'the prompt'),
	instrEntry(2, 'AGENTS.md'),
	instrEntry(3, 'docs/nested/RULES.md')
];

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
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

afterEach(() => {
	registerAddPanel(null);
});

describe('InjectedShelfButton (Loadinjected W4 4.4-T)', () => {
	it('an empty shelf renders nothing — the button hides', () => {
		const h = mountButton([]);
		expect(h.target.querySelector('[data-testid="injected-shelf-button"]')).toBeNull();
		h.cleanup();
	});

	it('the popup lists the shelf in operator order — label first, full path beneath', () => {
		const h = mountButton(ENTRIES);
		const btn = h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('title')).toBe('Injected');
		btn.click();
		flushSync();
		const items = Array.from(
			h.target.querySelectorAll('[data-testid="injected-shelf-item"]')
		) as HTMLElement[];
		expect(items.map((el) => el.getAttribute('data-display-path'))).toEqual([
			'system-prompt.md',
			'AGENTS.md',
			'docs/nested/RULES.md'
		]);
		expect(items[1].textContent).toContain('AGENTS.md');
		expect(items[2].textContent).toContain('RULES.md'); // the basename label
		expect(items[2].textContent).toContain('docs/nested/RULES.md'); // the path beneath
		h.cleanup();
	});

	it('a pick runs the executor path and reaches the floor handler (--add, D6)', () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const onnote = vi.fn();
		const h = mountButton(ENTRIES, onnote);
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		const pick = h.target
			.querySelectorAll('[data-testid="injected-shelf-item"]')[1]
			.querySelector('.shelf-pick') as HTMLElement;
		pick.click();
		flushSync();
		// The SAME floor seam the composer command uses — one write path.
		expect(seen).toEqual([
			{ kind: 'injected-doc', sourceSessionId: 's1', displayPath: 'AGENTS.md', afterSessionId: 's1' }
		]);
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 'x', displayPath: 'y' })).toBe(true); // handler stayed registered
		h.cleanup();
	});

	it('the executor’s honest notes ride the onnote sink', () => {
		const onnote = vi.fn();
		// No floor handler → the executor's honest no-match/floor note path.
		const h = mountButton([instrEntry(1, 'ONLY.md')], onnote);
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		const pick = h.target.querySelector(
			'[data-testid="injected-shelf-item"] .shelf-pick'
		) as HTMLElement;
		pick.click();
		flushSync();
		expect(onnote).toHaveBeenCalledTimes(1);
		expect(onnote.mock.calls[0][0]).toBe(false);
		expect(String(onnote.mock.calls[0][1])).toContain('/loadinjected');
		h.cleanup();
	});

	it('SOURCE CONTRACT — the button imports the executor, never the registry write (D6)', () => {
		const src = readFileSync(
			join(process.cwd(), 'src/lib/components/anchor/inject-anchor/InjectedShelfButton.svelte'),
			'utf-8'
		);
		expect(src).toContain("from '$lib/services/chat/command-executor'");
		expect(src).toContain("from '$lib/services/chat/command-parser'");
		expect(src).not.toContain('panel-registry');
		expect(src).not.toContain('addPanelFromSidebar');
	});

	it('SOURCE CONTRACT — pick composes via the constructor, never the retired typed string (ADR D3, 2026-09-17)', () => {
		const src = readFileSync(
			join(process.cwd(), 'src/lib/components/anchor/inject-anchor/InjectedShelfButton.svelte'),
			'utf-8'
		);
		expect(src).toContain('loadinjectedCommand(');
		expect(src).not.toContain("parseCommand('/loadinjected");
	});

	it('an <hr> marks the FIRST-LOAD boundary — later injections sit below it', () => {
		// ENTRIES: the synthetic member (firstLoad) + baseline-style and
		// later-envelope files (their fixtures carry no baseline flag).
		const h = mountButton(ENTRIES); // system-prompt first, then AGENTS.md, then the nested file
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		const divider = h.target.querySelector('[data-testid="shelf-first-load-divider"]');
		expect(divider).not.toBeNull();
		// It sits BETWEEN the synthetic member and the first injected file.
		const popup = h.target.querySelector('[data-testid="injected-shelf-popup"]') as HTMLElement;
		const kids = Array.from(popup.children).map((el) => el.getAttribute('data-display-path') ?? el.tagName);
		// Popup Shell W3: the container renders the title header as the box's
		// first child — the divider order below it is unchanged.
		expect(kids).toEqual(['DIV', 'system-prompt.md', 'HR', 'AGENTS.md', 'docs/nested/RULES.md']);
		h.cleanup();
	});

	it('no divider when the shelf has only injected files', () => {
		const h = mountButton([instrEntry(1, 'ONLY.md')]);
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="shelf-origin-divider"]')).toBeNull();
		h.cleanup();
	});

	it('the popup carries the container signature and the title header (Popup Shell W3)', () => {
		const h = mountButton(ENTRIES);
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		const popup = h.target.querySelector('[data-testid="injected-shelf-popup"]') as HTMLElement;
		expect(popup.className).toContain('pointer-events-auto');
		// Token-wise (the shell's placement grammar interleaves tokens —
		// 'right-full mr-2 top-1/2 -translate-y-1/2'): the signature is the
		// tokens, not one literal substring.
		expect(popup.className).toContain('absolute');
		expect(popup.className).toContain('right-full');
		expect(popup.className).toContain('top-1/2');
		expect(popup.className).toContain('overflow-y-auto');
		expect(
			h.target.querySelector('[data-testid="injected-shelf-popup-header"]')?.textContent
		).toContain('Injected files: (3)');
		h.cleanup();
	});

	it('HOSTED close contract — Escape closes the popup', () => {
		const h = mountButton(ENTRIES);
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).not.toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).toBeNull();
		h.cleanup();
	});

	it('HOSTED close contract — a TRUSTED outside click closes; the opening toggle is exempt', () => {
		const h = mountButton(ENTRIES);
		const btn = h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement;
		btn.click();
		flushSync();
		// Trusted click on the toggle's WRAPPER — the opening-click exemption.
		// (Dispatching on the button itself would run its toggle handler.)
		const trustedOnToggle = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trustedOnToggle, 'isTrusted', { value: true });
		(btn.parentElement as HTMLElement).dispatchEvent(trustedOnToggle);
		flushSync();
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).not.toBeNull();
		// Trusted click outside — closes.
		const trustedOutside = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trustedOutside, 'isTrusted', { value: true });
		document.body.dispatchEvent(trustedOutside);
		flushSync();
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).toBeNull();
		h.cleanup();
	});

	it('HOSTED close contract — copying neither picks nor closes', async () => {
		const writeText = vi.fn(async (t: string) => t);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		const seen: PanelAddRequest[] = [];
		registerAddPanel((r) => seen.push(r));
		const h = mountButton(ENTRIES); // workspace '/w' — full paths are joined
		(h.target.querySelector('[data-testid="injected-shelf-button"]') as HTMLElement).click();
		flushSync();
		const items = Array.from(
			h.target.querySelectorAll('[data-testid="injected-shelf-item"]')
		) as HTMLElement[];
		// The synthetic member is NOT a file — it copies the logged TEXT
		// (D7: a shelf name has no terminal-reachable path).
		(items[0].querySelector('.shelf-copy') as HTMLElement).click();
		await Promise.resolve();
		expect(writeText).toHaveBeenLastCalledWith('the prompt');
		// A real file copies the workspace-joined FULL path.
		(items[1].querySelector('.shelf-copy') as HTMLElement).click();
		await Promise.resolve();
		expect(writeText).toHaveBeenLastCalledWith('/w/AGENTS.md');
		// Copying never picks (CopyButton stops propagation).
		expect(seen).toEqual([]);
		// …and never closes the popup either.
		expect(h.target.querySelector('[data-testid="injected-shelf-popup"]')).not.toBeNull();
		h.cleanup();
	});
});
