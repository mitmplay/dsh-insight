import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PlaygroundPage from '../../playground/src/routes/+page.svelte';

/**
 * 2.2-T (Container Base R8, ADR-0070) — the two-tray host contract:
 * promote opens + selects + flips the journey; close drops the pane back
 * to the lower tray; a fresh mount (reload simulation) honors the revived
 * journey fact.
 */

const targets: { root: HTMLElement; instance: ReturnType<typeof mount> }[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push({ root: el, instance: null as never });
	return el;
}
afterEach(() => {
	for (const t of targets) {
		if (t.instance) unmount(t.instance);
		t.root.remove();
	}
	targets.length = 0;
	localStorage.clear();
});

function tray(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-testid="' + id + '"]');
}

function clickItem(id: string): void {
	// the testid IS the row button (PanelListboxListItem root)
	const item = document.querySelector<HTMLButtonElement>('[data-testid="' + id + '"]');
	if (!item) throw new Error('missing tray item ' + id);
	item.click();
	flushSync();
}

function clickClose(paneId: string): void {
	// the pane root carries data-panel-id (PaneBase); the close button is
	// its header action (PanelClose testid panel-close)
	const btn = document.querySelector<HTMLElement>('[data-panel-id="' + paneId + '"]')?.querySelector<HTMLButtonElement>('[data-testid="panel-close"]');
	if (!btn) throw new Error('missing close button for ' + paneId);
	btn.click();
	flushSync();
}

describe('two-tray host (2.2-T)', () => {
	it('fresh desk: Notes upstairs and selected, scheduler+sessions rest below', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		expect(tray('pg-tray-upstairs-notes')).not.toBeNull();
		expect(tray('pg-tray-upstairs-scheduler')).toBeNull();
		expect(tray('pg-tray-resting-scheduler')).not.toBeNull();
		expect(tray('pg-tray-resting-notes')).toBeNull();
		expect(tray('pg-tray-upstairs-notes')!.getAttribute('aria-current')).toBe('true');
	});

	it('promote: lower-tray click opens the pane AND selects it upstairs', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		clickItem('pg-tray-resting-scheduler');
		// upstairs now
		expect(tray('pg-tray-upstairs-scheduler')).not.toBeNull();
		expect(tray('pg-tray-resting-scheduler')).toBeNull();
		// AND selected (the linked tray lights it)
		expect(tray('pg-tray-upstairs-scheduler')!.getAttribute('aria-current')).toBe('true');
	});

	it('close: drops the pane back to the lower tray and moves selection', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		clickItem('pg-tray-resting-scheduler');
		clickClose('scheduler');
		expect(tray('pg-tray-resting-scheduler')).not.toBeNull();
		expect(tray('pg-tray-upstairs-scheduler')).toBeNull();
		// selection fell to the remaining upstairs pane (notes)
		expect(tray('pg-tray-upstairs-notes')!.getAttribute('aria-current')).toBe('true');
	});

	it('reload: a fresh mount honors the revived journey fact', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		flushSync();
		clickItem('pg-tray-resting-sessions');
		unmount(instance);
		root.remove();
		// "hard reload": brand-new mount over the SAME persisted blob
		const root2 = host();
		const instance2 = mount(PlaygroundPage, { target: root2 });
		targets[targets.length - 1].instance = instance2;
		flushSync();
		expect(tray('pg-tray-upstairs-sessions')).not.toBeNull();
		expect(tray('pg-tray-upstairs-sessions')!.getAttribute('aria-current')).toBe('true');
		expect(tray('pg-tray-resting-sessions')).toBeNull();
	});

	it('empty upper tray renders its hint snippet; nothing upstairs never blanks the trays', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		// drop every upstairs pane: notes close + scheduler/sessions never opened
		clickClose('notes');
		expect(tray('pg-tray-upstairs-empty')).not.toBeNull();
		expect(tray('pg-tray-upstairs-empty')!.textContent).toContain('Nothing upstairs');
		// the resting tray still lists all three
		expect(tray('pg-tray-resting-notes')).not.toBeNull();
	});

	// R9 (ADR-0071 D7/D8): the tray-filter contract.
	function typeFilter(testid: string, value: string): void {
		const input = document.querySelector<HTMLInputElement>('[data-testid="' + testid + '"]');
		if (!input) throw new Error('missing filter ' + testid);
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	it('each filter narrows ONLY its own tray; the floor keeps every upstairs pane (D7)', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		typeFilter('pg-tray-upstairs-filter', 'Notes');
		// upstairs narrows to the Notes row; the resting tray keeps both
		expect(tray('pg-tray-upstairs-notes')).not.toBeNull();
		expect(tray('pg-tray-upstairs-scheduler')).toBeNull();
		expect(tray('pg-tray-resting-scheduler')).not.toBeNull();
		expect(tray('pg-tray-resting-sessions')).not.toBeNull();
		// the FLOOR is untouched by a tray view-filter: the Notes pane stays
		expect(document.querySelector('[data-panel-id="notes"]')).not.toBeNull();
		typeFilter('pg-tray-resting-filter', 'Sessions');
		expect(tray('pg-tray-resting-sessions')).not.toBeNull();
		expect(tray('pg-tray-resting-scheduler')).toBeNull();
		// the upstairs query is independent of the resting one
		expect(tray('pg-tray-upstairs-notes')).not.toBeNull();
		// NON-SENSITIVE: 'notes' finds the 'Notes' pane (operator 2026-11-18)
		typeFilter('pg-tray-upstairs-filter', 'notes');
		expect(tray('pg-tray-upstairs-notes')).not.toBeNull();
	});

	it('a focused upstairs pane filtered out keeps its selection; the row only hides (D7)', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		expect(tray('pg-tray-upstairs-notes')!.getAttribute('aria-current')).toBe('true');
		typeFilter('pg-tray-upstairs-filter', 'zzz-no-match');
		expect(tray('pg-tray-upstairs-notes')).toBeNull();
		expect(tray('pg-tray-upstairs-empty')).not.toBeNull();
		// the selection FACT is untouched underneath the view
		const raw = JSON.parse(localStorage.getItem('pg-panels') ?? '{}');
		expect(raw.selectedPanelId).toBe('notes');
	});

	it('filters persist under the pg- grammar and survive a reload; junk values fall back', () => {
		const root = host();
		const instance = mount(PlaygroundPage, { target: root });
		targets[targets.length - 1].instance = instance;
		flushSync();
		typeFilter('pg-tray-resting-filter', 'Sched');
		const stored = JSON.parse(localStorage.getItem('pg-tray-filters') ?? '{}');
		expect(stored.resting).toBe('Sched');
		expect(stored.upstairs).toBe('');
		unmount(instance);
		root.remove();
		// reload restores the filter through the revived blob
		const root2 = host();
		const instance2 = mount(PlaygroundPage, { target: root2 });
		targets[targets.length - 1].instance = instance2;
		flushSync();
		expect(tray('pg-tray-resting-scheduler')).not.toBeNull();
		expect(tray('pg-tray-resting-sessions')).toBeNull();
		const input = document.querySelector<HTMLInputElement>('[data-testid="pg-tray-resting-filter"]');
		expect(input?.value).toBe('Sched');
		// junk persisted value → the empty string, the whole tray shows
		localStorage.setItem('pg-tray-filters', JSON.stringify({ upstairs: 42, resting: null }));
		unmount(instance2);
		root2.remove();
		const root3 = host();
		const instance3 = mount(PlaygroundPage, { target: root3 });
		targets[targets.length - 1].instance = instance3;
		flushSync();
		expect(tray('pg-tray-resting-scheduler')).not.toBeNull();
		expect(tray('pg-tray-resting-sessions')).not.toBeNull();
	});
});
