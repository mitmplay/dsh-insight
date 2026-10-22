/**
 * panels-row + workspace-context unit tests (paired with Panel Floor W3
 * tasks 3.2-T and 3.3-T; extended by W5 task 5.1-T — ControlBar tray).
 *
 * panels-row (3.2-T) pins the floor chrome contract:
 *  - PanelsZoom: the zoom-frame's layout width is measured in JS to
 *    row.scrollWidth × zoom (mocked scrollWidth — happy-dom has no layout);
 *    the geometry fingerprint (widths+count) drives re-measure on change.
 *  - ResizeGutter: mousedown invokes startPanelResize(event, index) through
 *    the REAL registry round-trip (leaf→root channel).
 *  - PanelHeader close: onremove fires (route-owned panels mutate).
 *  - PanelColumn: fixed width shell + gutter after every panel.
 *
 * workspace-context (3.3-T): set/get round-trip reactivity + null-safe
 * default outside a provider.
 *
 * control-bar (5.1-T) pins the tray contract (harness-driven, happy-dom):
 *  - ControlBar: trigger click reveals the tray (class flip); Enter in
 *    AddPanel fires addPanelFromSidebar with the TRIMMED id through the
 *    real registry round-trip; empty input never fires; sliders live
 *    within the panel-prefs clamps; SliderWidth commits onresizeall on
 *    every thumb move (input, realtime); SliderZoom binds zoom through
 *    the harness.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelsZoom from '../../src/lib/components/panels/PanelsZoom.svelte';
import PanelColumn from '../../src/lib/components/panels/PanelColumn.svelte';
import PanelHeader from '../../src/lib/components/panels/PanelHeader.svelte';
import ResizeGutter from '../../src/lib/components/panels/ResizeGutter.svelte';
import PanelsZoomHarness from '../fixtures/PanelsZoomHarness.svelte';
import ControlBarHarness from '../fixtures/ControlBarHarness.svelte';
import {
	registerStartPanelResize,
	startPanelResize,
	registerAddPanel,
	registerReplaceSelected,
	registerMovePanel,
	type PanelAddRequest
} from '../../src/lib/services/panels/panel-registry';
import {
	getWorkspaceState,
	setWorkspaceState
} from '../../src/lib/services/conversation/workspace-context.svelte';
import type { DsiPanelEntry } from '../../src/lib/types';
import {
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH,
	PANEL_MIN_ZOOM,
	PANEL_MAX_ZOOM
} from '../../src/lib/utils/panel-prefs';
/** Snippet per mount — repo pattern (chat-components.test.ts): the render
 *  body returns an HTML string (createRawSnippet is the client-safe shape). */
import { createRawSnippet } from 'svelte';
function emptySnippet() {
	return createRawSnippet(() => ({ render: () => '<!--panel body-->' }));
}


/** Panels fixture — plain entries (imported type, commitment 9). */
function entry(id: string, sessionId: string, width: number): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

/** rAF stub: happy-dom lacks requestAnimationFrame by default in effects. */
function stubRaf(): void {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

afterEach(() => {
	vi.unstubAllGlobals();
	setWorkspaceState(null);
	// Registry hygiene between tests (resetPanelRegistryForTests exists,
	// but explicit nulls document the slots this file registers).
	registerStartPanelResize(null);
	registerAddPanel(null);
	registerReplaceSelected(null);
	registerMovePanel(null);
});

describe('PanelsZoom — zoom-frame width math (task 3.2-T)', () => {
	it('frame layout width = row.scrollWidth × zoom (JS-measured; scrollWidth ignores transforms)', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		// Harness: prop writes are reactive in Svelte 5 ($set is gone).
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				zoom: 0.5,
				panels: [entry('p1', 's1', 480), entry('p2', 's2', 520)],
				children: emptySnippet()
			}
			});
		await settle();
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		const frame = target.querySelector('[data-testid="panels-zoom-frame"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(frame).not.toBeNull();
		Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 2000 });
		// Fingerprint change (count) → effect re-runs → reads the mocked scrollWidth.
		instance.set({ panels: [entry('p1', 's1', 480), entry('p2', 's2', 520), entry('p3', 's3', 560)] });
		await settle();
		expect(frame.style.width).toBe('1000px'); // 2000 × 0.5
		unmount(instance);
	});

	it('geometry fingerprint changes on width/zoom change (the re-measure trigger)', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: { zoom: 1, panels: [entry('p1', 's1', 480)], children: emptySnippet() }
		});
		await settle();
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		const frame = target.querySelector('[data-testid="panels-zoom-frame"]') as HTMLElement;
		Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1000 });
		// Width change → re-measure at same zoom.
		instance.set({ panels: [entry('p1', 's1', 700)] });
		await settle();
		expect(frame.style.width).toBe('1000px'); // 1 × 1000
		// Zoom change alone re-measures too (same geometry, new multiplier).
		instance.set({ zoom: 1.5 });
		await settle();
		expect(frame.style.width).toBe('1500px'); // 1000 × 1.5
		unmount(instance);
	});

	it('railWidth rides the fingerprint: mount/unmount/resize of the leading rail re-measures (OCI `leading ? railWidth : \'\'`)', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: { zoom: 1, panels: [entry('p1', 's1', 480)], railWidth: null, children: emptySnippet() }
		});
		await settle();
		const row = target.querySelector('[data-testid="panels-row"]') as HTMLElement;
		const frame = target.querySelector('[data-testid="panels-zoom-frame"]') as HTMLElement;
		Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1000 });

		// Rail MOUNTS (null → 340): panels and zoom unchanged — only the
		// fingerprint's rail segment moves, and that alone must re-measure.
		instance.set({ railWidth: 340 });
		await settle();
		expect(frame.style.width).toBe('1000px');
		// Rail RESIZES (sidebar drag) with panels/zoom still unchanged.
		Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1240 });
		instance.set({ railWidth: 580 });
		await settle();
		expect(frame.style.width).toBe('1240px');
		// Rail UNMOUNTS (collapse → stub leaves the row) — re-measure again.
		Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 660 });
		instance.set({ railWidth: null });
		await settle();
		expect(frame.style.width).toBe('660px');
		unmount(instance);
	});
});

describe('ResizeGutter — registry round-trip (task 3.2-T)', () => {
	it('mousedown invokes startPanelResize(event, index) through the registry', async () => {
		const seen: Array<[MouseEvent, number]> = [];
		registerStartPanelResize((e, index) => seen.push([e, index]));
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ResizeGutter, { target, props: { index: 2 } });
		const gutter = target.querySelector('[data-testid="panel-gutter-2"]') as HTMLElement;
		expect(gutter).not.toBeNull();
		gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		// The gutter's registry import is dynamic — give the promise chain
		// real microtask turns.
		await new Promise((r) => setTimeout(r, 20));
		await settle();
		expect(seen).toHaveLength(1);
		expect(seen[0][1]).toBe(2);
		unmount(instance);
		registerStartPanelResize(null);
	});

	it('no handler → registry returns false (graceful no-op, never a crash)', async () => {
		registerStartPanelResize(null);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ResizeGutter, { target, props: { index: 0 } });
		const gutter = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		await settle();
		expect(() => startPanelResize(new MouseEvent('mousedown'), 0)).not.toThrow();
		expect(startPanelResize(new MouseEvent('mousedown'), 0)).toBe(false);
		unmount(instance);
	});
});

describe('PanelHeader + PanelColumn (task 3.2-T)', () => {
	it('header close fires onremove', async () => {
		const removed: string[] = [];
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelHeader, {
			target,
			props: { panelId: 'p1', sessionId: 's-1', onremove: () => removed.push('s-1') }
		});
		(target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
		await settle();
		expect(removed).toEqual(['s-1']);
		unmount(instance);
	});

	it('header move chevrons invoke the registry round-trip; gating hides at edges', async () => {
		const moves: Array<{ panelId: string; dir: string }> = [];
		registerMovePanel((panelId, dir) => moves.push({ panelId, dir }));
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelHeader, {
			target,
			props: {
				panelId: 'p1',
				sessionId: 's-1',
				canMoveLeft: true,
				canMoveRight: true,
				onremove: () => {}
			}
		});
		const header = target.querySelector('[data-testid="panel-header"]') as HTMLElement;
		(header.querySelector('[data-testid="panel-move-left"]') as HTMLButtonElement).click();
		(header.querySelector('[data-testid="panel-move-right"]') as HTMLButtonElement).click();
		await settle();
		expect(moves).toEqual([
			{ panelId: 'p1', dir: 'left' },
			{ panelId: 'p1', dir: 'right' }
		]);
		// Gating: default false renders NEITHER chevron (edge columns).
		const edge = document.createElement('div');
		document.body.appendChild(edge);
		const edgeInstance = mount(PanelHeader, {
			target: edge,
			props: { panelId: 'p9', sessionId: 's-9', onremove: () => {} }
		});
		expect(edge.querySelector('[data-testid="panel-move-left"]')).toBeNull();
		expect(edge.querySelector('[data-testid="panel-move-right"]')).toBeNull();
		unmount(edgeInstance);
		unmount(instance);
	});

	it('header label is the session id in full — copy-id button beside it, no title', async () => {
		const longId = 'session-0505388e-01dd-41fd-ac48-10687ff2fec0';
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelHeader, {
			target,
			props: { panelId: 'p1', sessionId: longId, onremove: () => {} }
		});
		const label = target.querySelector('[data-testid="panel-header-label"]') as HTMLElement;
		// The id renders COMPLETE — no truncation, no ellipsis (2026-08-25).
		const idSpan = label.querySelector('.id') as HTMLElement;
		expect(idSpan.textContent).toBe(longId);
		expect(label.textContent).toContain(longId);
		// No session name in the floor strip — ConversationPanel's
		// SessionIdAndName below owns the title (redundancy removed).
		expect(label.querySelector('.title')).toBeNull();
		expect(label.querySelector('.sep')).toBeNull();
		// Copy affordance rides the label cluster (tested below).
		expect(label.querySelector('[data-testid="panel-header-copy-id"]')).not.toBeNull();
		unmount(instance);
	});

	it('copy-id button writes the full session id to the clipboard', async () => {
		const writes: string[] = [];
		const holder = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
		const original = holder.clipboard?.writeText;
		if (holder.clipboard) holder.clipboard.writeText = (t) => { writes.push(t); return Promise.resolve(); };

		const longId = 'session-0505388e-01dd-41fd-ac48-10687ff2fec0';
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelHeader, {
			target,
			props: { panelId: 'p1', sessionId: longId, onremove: () => {} }
		});
		(target.querySelector('[data-testid="panel-header-copy-id"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));

		if (holder.clipboard) {
			expect(writes).toEqual([longId]);
			if (original) holder.clipboard.writeText = original;
		}
		unmount(instance);
	});

	it('column: fixed-width shell, selection class, gutter sibling', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelColumn, {
			target,
			props: {
				panel: entry('p1', 's-1', 730),
				index: 0,
				selected: true,
				onremove: () => {},
				children: emptySnippet()
			}
		});
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		expect(column).not.toBeNull();
		expect(column.style.width).toBe('730px');
		expect(column.classList.contains('selected')).toBe(true);
		expect(column.getAttribute('data-session-id')).toBe('s-1');
		// Gutter renders as a SIBLING after the column (every panel has one).
		expect(target.querySelector('[data-testid="panel-gutter-0"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('workspace-context (task 3.3-T)', () => {
	it('set/get round-trip — rows + selection + operations carried', () => {
		expect(getWorkspaceState()).toBeNull(); // default outside a provider
		const panels = [entry('p1', 's1', 700)];
		setWorkspaceState({
			rows: panels.map((panel) => ({
				panel,
				title: null,
				workspace: null,
				dead: false,
				running: false
			})),
			selectedPanelId: 'p1',
			profile: null,
			select: (id) => void id,
			remove: (id) => void id
		});
		const state = getWorkspaceState();
		expect(state?.rows.map((r) => r.panel)).toStrictEqual(panels);
		expect(state?.selectedPanelId).toBe('p1');
		setWorkspaceState(null);
		expect(getWorkspaceState()).toBeNull();
	});
});

describe('ControlBar tray (task 5.1-T)', () => {
	/** Mount the harness + open the tray; returns the instance. */
	async function mountTray(props: { panelWidth?: number; zoom?: number } = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ControlBarHarness, { target, props });
		await settle();
		const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLButtonElement;
		trigger.click();
		await settle();
		return { target, instance };
	}

	it('trigger click reveals the tray (class flip + data-open)', async () => {
		const { target, instance } = await mountTray();
		const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
		expect(bar.classList.contains('open')).toBe(true);
		expect(bar.getAttribute('data-open')).toBe('true');
		expect(document.body.querySelector('[data-testid="controlbar-tray"]')).not.toBeNull();
		unmount(instance);
	});

	it('paste-add fires addPanelFromSidebar with the trimmed id through the real registry', async () => {
		const seen: PanelAddRequest[] = [];
		registerAddPanel((request) => seen.push({ ...request }));
		const { target, instance } = await mountTray();
		const input = document.body.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
		input.value = '  session-42  ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(document.body.querySelector('[data-testid="controlbar-add-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(seen).toEqual([{ sessionId: 'session-42', agentPreset: null }]);
		// Successful fire clears the field — the appearing panel is the feedback.
		expect(input.value).toBe('');
		unmount(instance);
	});

	it('Enter submits the paste-add form; empty input never fires', async () => {
		const seen: string[] = [];
		registerAddPanel((request) => {
			if (
				request.kind !== 'terminal' &&
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-home' &&
				request.kind !== 'injected-doc' &&
				request.kind !== 'skill-shelf' &&
				request.kind !== 'plugin-rack'
			)
				seen.push(request.sessionId);
		});
		const { target, instance } = await mountTray();
		const input = document.body.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
		// Empty (whitespace-only) submit — no fire.
		input.value = '   ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(seen).toEqual([]);
		// Enter with a real id fires once (submit event — the form-level
		// contract the browser fires for Enter in a text input).
		input.value = 'session-7';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		input.form?.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true })
		);
		await settle();
		expect(seen).toEqual(['session-7']);
		unmount(instance);
	});

	it('Rplc fires replaceSelectedFromRegistry with the trimmed id through the real registry', async () => {
		const seen: PanelAddRequest[] = [];
		registerReplaceSelected((request) => seen.push(request));
		const { target, instance } = await mountTray();
		const input = document.body.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
		input.value = '  session-99  ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(document.body.querySelector('[data-testid="controlbar-replace-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(seen).toEqual([{ sessionId: 'session-99', agentPreset: null }]);
		// Successful fire clears the field — the swapped panel is the feedback.
		expect(input.value).toBe('');
		unmount(instance);
	});

	it('Rplc never fires on empty input and never rides the Enter submit path', async () => {
		const replaced: string[] = [];
		const added: string[] = [];
		registerReplaceSelected((request) => {
			if (
				request.kind !== 'terminal' &&
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-home' &&
				request.kind !== 'injected-doc' &&
				request.kind !== 'skill-shelf' &&
				request.kind !== 'plugin-rack'
			)
				replaced.push(request.sessionId);
		});
		registerAddPanel((request) => {
			if (
				request.kind !== 'terminal' &&
				request.kind !== 'prompt-manager' &&
				request.kind !== 'settings-home' &&
				request.kind !== 'injected-doc' &&
				request.kind !== 'skill-shelf' &&
				request.kind !== 'plugin-rack'
			)
				added.push(request.sessionId);
		});
		const { target, instance } = await mountTray();
		const input = document.body.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
		// Whitespace-only Rplc click — no fire.
		input.value = '   ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(document.body.querySelector('[data-testid="controlbar-replace-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(replaced).toEqual([]);
		// Enter (form submit) fires Add even with a replace handler registered —
		// Rplc is a click-only verb, one keystroke never surprises.
		input.value = 'session-8';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		input.form?.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true })
		);
		await settle();
		expect(added).toEqual(['session-8']);
		expect(replaced).toEqual([]);
		unmount(instance);
	});

	it('Rplc with no replace handler registered is a graceful no-op (leaf never crashes)', async () => {
		const { target, instance } = await mountTray();
		const input = document.body.querySelector('[data-testid="controlbar-add-input"]') as HTMLInputElement;
		input.value = 'session-13';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(() => {
			(document.body.querySelector('[data-testid="controlbar-replace-submit"]') as HTMLButtonElement).click();
		}).not.toThrow();
		await settle();
		unmount(instance);
	});

	it('width slider lives within clamps and commits onresizeall on every thumb move', async () => {
		const { target, instance } = await mountTray({ panelWidth: 730 });
		const slider = document.body.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		// The input's min/max mirror the single bound site (panel-prefs).
		expect(Number(slider.min)).toBe(PANEL_MIN_WIDTH);
		expect(Number(slider.max)).toBe(PANEL_MAX_WIDTH);
		// Drag the thumb: the bound preset follows live AND the commit
		// fires per move (realtime panels, SliderZoom's cadence).
		slider.value = '600';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(instance.read().panelWidth).toBe(600);
		expect(instance.resizeLog()).toEqual([600]);
		unmount(instance);
	});

	it('zoom slider binds within clamps through the harness', async () => {
		const { target, instance } = await mountTray({ zoom: 1 });
		const slider = document.body.querySelector(
			'[data-testid="controlbar-slider-zoom-input"]'
		) as HTMLInputElement;
		expect(Number(slider.min)).toBe(PANEL_MIN_ZOOM);
		expect(Number(slider.max)).toBe(PANEL_MAX_ZOOM);
		expect(Number(slider.step)).toBe(0.001); // fine-grained zoom (parallel change 2026-08-25)
		slider.value = '0.9';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(instance.read().zoom).toBeCloseTo(0.9, 5);
		expect(
			(document.body.querySelector('[data-testid="controlbar-slider-zoom-value"]') as HTMLElement)
				.textContent
		).toBe('90%');
		unmount(instance);
	});

	it('no RegisterFeature / home link surfaces in the tray (ADR-0006 R7)', async () => {
		const { target, instance } = await mountTray();
		const tray = document.body.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;
		const text = tray.textContent?.toLowerCase() ?? '';
		expect(text).not.toContain('register');
		expect(text).not.toContain('home');
		expect(document.body.querySelector('[data-testid="controlbar-register"]')).toBeNull();
		expect(document.body.querySelector('[data-testid="controlbar-home"]')).toBeNull();
		unmount(instance);
	});
});

describe('PanelsZoom — selection follow (2026-09-02)', () => {
	/** Fake floor: three 500px columns inside one wide row. happy-dom has
	 *  no layout, so every geometry read the follow makes is stubbed on
	 *  the element (rects + scroll metrics) — the MATH is what's pinned.
	 *  Column rects are scrollLeft-CONSISTENT: a column's visual left is
	 *  its content position minus the scroll. scrollTo is a capture+mirror:
	 *  the reveal options (behavior!) are recorded, scrollLeft follows. */
	const COL = 500;
	function stubViewportGeometry(target: HTMLElement, vpWidth: number): {
		vp: HTMLElement;
		scrolls: ScrollToOptions[];
	} {
		const vp = target.querySelector('[data-testid="panels-viewport"]') as HTMLElement;
		const scrolls: ScrollToOptions[] = [];
		Object.defineProperty(vp, 'clientWidth', { configurable: true, value: vpWidth });
		Object.defineProperty(vp, 'scrollWidth', { configurable: true, value: COL * 3 + 8 });
		vp.getBoundingClientRect = () =>
			({ left: 0, right: vpWidth, width: vpWidth, top: 0, bottom: 0, height: 100 } as DOMRect);
		vp.scrollTo = ((opts: ScrollToOptions) => {
			scrolls.push(opts);
			vp.scrollLeft = opts.left ?? vp.scrollLeft;
		}) as unknown as typeof vp.scrollTo;
		return { vp, scrolls };
	}
	function columnsSnippet(): ReturnType<typeof createRawSnippet> {
		return createRawSnippet(() => ({
			render: () =>
				`<div>${['p1', 'p2', 'p3']
					.map(
						(id, i) =>
							`<div data-testid="panel-column" data-panel-id="${id}" style="width:${COL}px"></div>`
					)
					.join('')}</div>`
		}));
	}
	/** Column k's rect: content left k × COL, scrolled by the live
	 *  scrollLeft (visual = content − scroll). `order` is the row's DOM
	 *  order — a reshuffle's POST-move geometry is stubbed by passing the
	 *  reordered ids (the browser reports fresh geometry before the
	 *  effect's rAF reads it; the fake DOM cannot move by itself). */
	function stubColumnRects(target: HTMLElement, vp: HTMLElement, order = ['p1', 'p2', 'p3']): void {
		order.forEach((id, i) => {
			const el = target.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
			const contentLeft = i * COL;
			el.getBoundingClientRect = () => {
				const left = contentLeft - vp.scrollLeft;
				return { left, right: left + COL, width: COL, top: 0, bottom: 0, height: 100 } as DOMRect;
			};
		});
	}
	type Harness = { set(next: { selectedPanelId?: string | null; panels?: Array<{ width: number }> }): void };

	it('selecting an off-viewport (right) column scrolls it into view — inertially', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 500);
		stubColumnRects(target, vp);

		(instance as unknown as Harness).set({ selectedPanelId: 'p3' });
		await settle();
		// p3 spans content [1000, 1500] — past the right edge (500): the
		// nearest reveal puts its right edge + ring at the viewport's edge.
		expect(vp.scrollLeft).toBe(1000 + COL + 4 - 500);
		// The reveal GLIDES (inertial), never teleports — unless the
		// operator asked for reduced motion (the default-happy case here).
		expect(scrolls.at(-1)).toMatchObject({ behavior: 'smooth' });

		unmount(instance);
	});

	it('selecting back reveals to the left and clamps at the row start', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				selectedPanelId: 'p3',
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp } = stubViewportGeometry(target, 500);
		stubColumnRects(target, vp);
		vp.scrollLeft = 1004; // the p3 reveal from the test above

		(instance as unknown as Harness).set({ selectedPanelId: 'p1' });
		await settle();
		// p1's content left (−4 with its ring) is left of the view: the
		// nearest reveal clamps at the row start.
		expect(vp.scrollLeft).toBe(0);

		unmount(instance);
	});

	it('selecting a fully visible column (ring included) never scrolls', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 600);
		stubColumnRects(target, vp);
		vp.scrollLeft = 450; // p2 [500,1000] + rings [496,1004] ⊂ [450, 1050]

		(instance as unknown as Harness).set({ selectedPanelId: 'p2' });
		await settle();
		expect(vp.scrollLeft).toBe(450);
		expect(scrolls).toHaveLength(0);

		unmount(instance);
	});

	it('a geometry-only change never scrolls (widths, zoom, rail)', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				selectedPanelId: 'p3',
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 500);
		stubColumnRects(target, vp);
		vp.scrollLeft = 77; // operator position

		(instance as unknown as Harness).set({
			panels: [entry('p1', 's1', 999), entry('p2', 's2', 999), entry('p3', 's3', 999)]
		});
		await settle();
		expect(vp.scrollLeft).toBe(77);
		expect(scrolls).toHaveLength(0);

		unmount(instance);
	});

	it('prefers-reduced-motion collapses the reveal to an instant jump', async () => {
		const mm = vi
			.spyOn(window, 'matchMedia')
			.mockImplementation(
				(query: string) =>
					({
						matches: query.includes('reduce'),
						media: query,
						addEventListener: () => {},
						removeEventListener: () => {}
					}) as unknown as MediaQueryList
			);
		try {
			stubRaf();
			const target = document.createElement('div');
			document.body.appendChild(target);
			const instance = mount(PanelsZoomHarness, {
				target,
				props: {
					panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
					children: columnsSnippet()
				}
			});
			await settle();
			const { vp, scrolls } = stubViewportGeometry(target, 500);
			stubColumnRects(target, vp);

			(instance as unknown as Harness).set({ selectedPanelId: 'p3' });
			await settle();
			expect(vp.scrollLeft).toBe(1004);
			expect(scrolls.at(-1)).toMatchObject({ behavior: 'auto' });

			unmount(instance);
		} finally {
			mm.mockRestore();
		}
	});

	it('a reshuffle re-reveals the focused column (move up/down)', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				selectedPanelId: 'p1',
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 500);
		stubColumnRects(target, vp);
		vp.scrollLeft = 700; // operator scrolled deep into the floor

		// A move lands (p2 moves above p1): the row's DOM becomes
		// p2, p1, p3 — stub the POST-move geometry, then commit the new
		// order. The id-sequence change re-runs the follow.
		stubColumnRects(target, vp, ['p2', 'p1', 'p3']);
		(instance as unknown as Harness).set({
			panels: [entry('p2', 's2', COL), entry('p1', 's1', COL), entry('p3', 's3', COL)]
		});
		await settle();
		// p1 (focused) now lives at content [500, 1000] — its left ring is
		// left of the view: the reveal brings it back, inertially.
		expect(vp.scrollLeft).toBe(496);
		expect(scrolls.at(-1)).toMatchObject({ behavior: 'smooth' });

		unmount(instance);
	});

	it('a reshuffle that leaves focus fully visible never scrolls', async () => {
		stubRaf();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelsZoomHarness, {
			target,
			props: {
				panels: [entry('p1', 's1', COL), entry('p2', 's2', COL), entry('p3', 's3', COL)],
				selectedPanelId: 'p2',
				children: columnsSnippet()
			}
		});
		await settle();
		const { vp, scrolls } = stubViewportGeometry(target, 600);
		stubColumnRects(target, vp);
		vp.scrollLeft = 460; // p2 [500,1000] + rings [496,1004] ⊂ [460, 1060]

		// p3 and p1 swap — the focused p2 keeps its slot: the id sequence
		// changes, the follow runs, and lands on "nothing to reveal".
		stubColumnRects(target, vp, ['p3', 'p2', 'p1']);
		(instance as unknown as Harness).set({
			panels: [entry('p3', 's3', COL), entry('p2', 's2', COL), entry('p1', 's1', COL)]
		});
		await settle();
		expect(vp.scrollLeft).toBe(460);
		expect(scrolls).toHaveLength(0);

		unmount(instance);
	});
});
