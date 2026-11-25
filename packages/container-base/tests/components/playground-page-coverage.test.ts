import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaygroundPage from '../../playground/src/routes/+page.svelte';

/**
 * Coverage matrix for the playground route (+page.svelte): every
 * script-side conditional (revive arms, boot-script handoff, drag and
 * sidebar-resize machines, badge afterglow, tray collapse, menus) driven
 * through the same mount + DOM helpers the sibling suites use.
 */

const targets: { root: HTMLElement; instance: ReturnType<typeof mount> | null }[] = [];

function mountPage(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const instance = mount(PlaygroundPage, { target: el });
	targets.push({ root: el, instance });
	flushSync();
	return el;
}

function popTarget(): void {
	unmount(targets[targets.length - 1].instance!);
	targets[targets.length - 1].root.remove();
	targets.pop();
}

beforeEach(() => {
	localStorage.clear();
	delete (window as { __BOOT_PREFS?: unknown }).__BOOT_PREFS;
});

afterEach(() => {
	vi.useRealTimers();
	for (const t of targets) {
		if (t.instance) unmount(t.instance);
		t.root.remove();
	}
	for (const el of [...document.body.children]) {
		if (el.classList.contains('tray-float')) el.remove();
	}
	targets.length = 0;
	localStorage.clear();
	delete (window as { __BOOT_PREFS?: unknown }).__BOOT_PREFS;
	document.cookie = 'pg-locale=; path=/; max-age=0';
	delete document.documentElement.dataset.theme;
});

function trayEl(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-testid="' + id + '"]');
}

function clickItem(id: string): void {
	const item = document.querySelector<HTMLButtonElement>('[data-testid="' + id + '"]');
	if (!item) throw new Error('missing tray item ' + id);
	item.click();
	flushSync();
}

function clickClose(paneId: string): void {
	const btn = document
		.querySelector<HTMLElement>('[data-panel-id="' + paneId + '"]')
		?.querySelector<HTMLButtonElement>('[data-testid="panel-close"]');
	if (!btn) throw new Error('missing close button for ' + paneId);
	btn.click();
	flushSync();
}

function typeFilter(testid: string, value: string): void {
	const input = document.querySelector<HTMLInputElement>('[data-testid="' + testid + '"]');
	if (!input) throw new Error('missing filter ' + testid);
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function q(sel: string): HTMLElement {
	const el = document.querySelector<HTMLElement>(sel);
	if (!el) throw new Error('missing element ' + sel);
	return el;
}

function winMouseEvent(clientX: number, type: 'mousemove' | 'mouseup' | 'mousedown'): MouseEvent {
	return new MouseEvent(type, { clientX, bubbles: true });
}

function setBoot(raw: unknown): void {
	(window as { __BOOT_PREFS?: Record<string, { raw?: unknown }> }).__BOOT_PREFS = {
		'pg-panels': { raw }
	};
}

describe('playground page — revive arms (pg-panels)', () => {
	it('junk zoom returns null so defaults seed the desk', () => {
		localStorage.setItem('pg-panels', JSON.stringify({ zoom: 'garbage' }));
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as Record<string, unknown>;
		expect(blob.zoom).toBe(1);
		expect(blob.panelWidth).toBe(730);
	});

	it('non-finite zoom returns null too', () => {
		localStorage.setItem('pg-panels', JSON.stringify({ zoom: NaN }));
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as Record<string, unknown>;
		expect(blob.zoom).toBe(1);
	});

	it('empty revived panels return null so fresh desk seeds', () => {
		localStorage.setItem('pg-panels', JSON.stringify({ zoom: 1, panels: [] }));
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string }[];
		};
		expect(blob.panels?.length).toBe(3);
	});

	it('valid zoom but null panels array goes fresh desk', () => {
		localStorage.setItem('pg-panels', JSON.stringify({ zoom: 1, panels: null }));
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: unknown[];
		};
		expect(blob.panels?.length).toBe(3);
	});

	it('junk panelWidth falls to 730; valid width clamps through the band', () => {
		localStorage.setItem('pg-panels', JSON.stringify({ zoom: 1, panelWidth: 'nope' }));
		mountPage();
		let blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { panelWidth?: number };
		expect(blob.panelWidth).toBe(730);
		popTarget();

		localStorage.setItem(
			'pg-panels',
			JSON.stringify({
				zoom: 1,
				panelWidth: 9000,
				panels: [
					{ id: 'notes', kind: 'demo-pane', width: 730, journey: 'upstairs' },
					{ id: 'scheduler', kind: 'demo-pane', width: 730, journey: 'resting' },
					{ id: 'sessions', kind: 'demo-pane', width: 730, journey: 'resting' }
				]
			})
		);
		mountPage();
		blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { panelWidth?: number };
		expect(blob.panelWidth).toBe(1400);
	});

	it('junk selectedPanelId cross-checks back to the first panel and junk journey falls to resting', () => {
		localStorage.setItem(
			'pg-panels',
			JSON.stringify({
				zoom: 1,
				selectedPanelId: 'does-not-exist',
				panels: [
					{ id: 'notes', kind: 'demo-pane', width: 730, journey: 'upstairs' },
					{ id: 'scheduler', kind: 'demo-pane', width: 500, journey: 'resting' },
					{ id: 'sessions', kind: 'demo-pane', width: 600, journey: 'junk' }
				]
			})
		);
		mountPage();
		expect(trayEl('pg-tray-upstairs-notes')?.getAttribute('aria-current')).toBe('true');
		expect(trayEl('pg-tray-upstairs-scheduler')).toBeNull();
		expect(trayEl('pg-tray-resting-sessions')).not.toBeNull();
	});

	it('restored widths revive per-pane and the drag clamps at the band min', () => {
		localStorage.setItem(
			'pg-panels',
			JSON.stringify({
				zoom: 1,
				panelWidth: 500,
				panels: [
					{ id: 'notes', kind: 'demo-pane', width: 400, journey: 'upstairs' },
					{ id: 'scheduler', kind: 'demo-pane', width: 600, journey: 'resting' },
					{ id: 'sessions', kind: 'demo-pane', width: 700, journey: 'resting' }
				]
			})
		);
		mountPage();
		const gutter = q('[data-testid="panel-gutter-0"]');
		gutter.dispatchEvent(winMouseEvent(100, 'mousedown'));
		flushSync();
		window.dispatchEvent(winMouseEvent(20, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(20, 'mouseup'));
		flushSync();
		const after = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string; width: number }[];
		};
		expect(after.panels?.find((p) => p.id === 'notes')?.width).toBe(320);
	});
});

describe('playground page — boot-script handoff (ADR-0067)', () => {
	it('boot raw materializes into localStorage when the key is absent', () => {
		const raw = JSON.stringify({ zoom: 1, panelWidth: 800 });
		setBoot(raw);
		mountPage();
		// the boot arm ran (key seeded from raw) — then the page's
		// initialize-on-mount normalize pass rewrote the full blob over it
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panelWidth?: number;
			panels?: unknown[];
		};
		expect(blob.panelWidth).toBe(730); // raw had no valid panelWidth → revive clamps to default
		expect(blob.panels?.length).toBe(3);
	});

	it('boot raw is skipped when localStorage already owns the key', () => {
		localStorage.setItem('pg-panels', 'already-here');
		setBoot(JSON.stringify({ zoom: 1 }));
		mountPage();
		// the skip arm ran: 'already-here' fails revive → fresh desk, not the raw blob
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			selectedPanelId?: string;
		};
		expect(blob.selectedPanelId).toBe('notes');
	});

	it('non-string raw is skipped', () => {
		setBoot(42);
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { zoom?: number };
		expect(blob.zoom).toBe(1);
		popTarget();
		localStorage.clear();
	});

	it('empty raw is skipped', () => {
		setBoot('');
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { zoom?: number };
		expect(blob.zoom).toBe(1);
		popTarget();
		localStorage.clear();
	});

	it('missing boot register is skipped cleanly', () => {
		mountPage();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { zoom?: number };
		expect(blob.zoom).toBe(1);
	});
});

describe('playground page — pane drag machine + badge afterglow', () => {
	it('mousemove and mouseup with no armed drag are no-ops', () => {
		mountPage();
		const before = localStorage.getItem('pg-panels');
		window.dispatchEvent(winMouseEvent(500, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(500, 'mouseup'));
		flushSync();
		expect(localStorage.getItem('pg-panels')).toBe(before);
		expect(trayEl('pg-width-badge-notes')).toBeNull();
	});

	it('gutter drag: live badge on the moved pane, fading on settle, drop after glow', () => {
		vi.useFakeTimers();
		mountPage();
		const gutter = q('[data-testid="panel-gutter-0"]');
		gutter.dispatchEvent(winMouseEvent(100, 'mousedown'));
		flushSync();
		window.dispatchEvent(winMouseEvent(180, 'mousemove'));
		flushSync();
		const badge = trayEl('pg-width-badge-notes');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toContain('810');
		window.dispatchEvent(winMouseEvent(180, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(180, 'mouseup'));
		flushSync();
		expect(trayEl('pg-width-badge-notes')).not.toBeNull();
		vi.advanceTimersByTime(11000);
		flushSync();
		expect(trayEl('pg-width-badge-notes')).toBeNull();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string; width: number }[];
		};
		expect(blob.panels?.find((p) => p.id === 'notes')?.width).toBe(810);
	});

	it('drag clamps to the band max of 1400', () => {
		mountPage();
		const gutter = q('[data-testid="panel-gutter-0"]');
		gutter.dispatchEvent(winMouseEvent(0, 'mousedown'));
		window.dispatchEvent(winMouseEvent(9000, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(9000, 'mouseup'));
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string; width: number }[];
		};
		expect(blob.panels?.find((p) => p.id === 'notes')?.width).toBe(1400);
	});
});

describe('playground page — sidebar resize machine + badge', () => {
	it('gutter drag resizes, live badge appears, settle persists, glow drops', () => {
		vi.useFakeTimers();
		const root = mountPage();
		const gutter = q('[data-testid="sidebar-gutter"]');
		gutter.dispatchEvent(winMouseEvent(200, 'mousedown'));
		flushSync();
		window.dispatchEvent(winMouseEvent(320, 'mousemove'));
		flushSync();
		const badge = q('[data-testid="pg-sidebar-width-badge"]');
		expect(badge.textContent).toContain('380');
		window.dispatchEvent(winMouseEvent(320, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(320, 'mouseup'));
		flushSync();
		gutter.dispatchEvent(winMouseEvent(200, 'mousedown'));
		flushSync();
		window.dispatchEvent(winMouseEvent(-100, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(-100, 'mouseup'));
		flushSync();
		const sidebar = JSON.parse(localStorage.getItem('pg-sidebar') ?? '{}') as { width?: number };
		expect(sidebar.width).toBe(200);
		vi.advanceTimersByTime(11000);
		flushSync();
		expect(root.querySelector('[data-testid="pg-sidebar-width-badge"]')).toBeNull();
	});

	it('junk pg-sidebar blob falls back to defaults through the revive null arm', () => {
		localStorage.setItem('pg-sidebar', JSON.stringify({ width: 'wide', collapsed: 1 }));
		const root = mountPage();
		const wrap = root.querySelector('[data-testid="sidebar-wrap"]') as HTMLElement;
		expect(wrap.style.width).toBe('260px'); // the default, not 'wide'
		const saved = JSON.parse(localStorage.getItem('pg-sidebar') ?? '{}') as {
			width?: number;
			collapsed?: boolean;
		};
		expect(saved).toEqual({ width: 260, collapsed: false });
	});

	it('collapsed sidebar renders the stub branch; restore brings the rail back', () => {
		const root = mountPage();
		q('[data-testid="pg-sidebar-toggle"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="sidebar"]')).toBeNull();
		expect(root.querySelector('[data-testid="pg-sidebar-restore"]')).not.toBeNull();
		const sidebar = JSON.parse(localStorage.getItem('pg-sidebar') ?? '{}') as {
			collapsed?: boolean;
		};
		expect(sidebar.collapsed).toBe(true);
		q('[data-testid="pg-sidebar-restore"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="sidebar"]')).not.toBeNull();
		const after = JSON.parse(localStorage.getItem('pg-sidebar') ?? '{}') as {
			collapsed?: boolean;
		};
		expect(after.collapsed).toBe(false);
	});
});

describe('playground page — tray collapse toggles', () => {
	it('each tray header toggle collapses and expands its own list', () => {
		const root = mountPage();
		q('[data-testid="pg-tray-upstairs-toggle"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="pg-tray-upstairs-list"]')).toBeNull();
		q('[data-testid="pg-tray-upstairs-toggle"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="pg-tray-upstairs-list"]')).not.toBeNull();
		q('[data-testid="pg-tray-resting-toggle"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="pg-tray-resting-list"]')).toBeNull();
		q('[data-testid="pg-tray-resting-toggle"]').click();
		flushSync();
		expect(root.querySelector('[data-testid="pg-tray-resting-list"]')).not.toBeNull();
	});
});

describe('playground page — journey edges', () => {
	it('closing the only upstairs pane selects null', () => {
		mountPage();
		clickClose('notes');
		clickItem('pg-tray-resting-scheduler');
		clickClose('scheduler');
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			selectedPanelId?: string | null;
		};
		expect(blob.selectedPanelId).toBeNull();
		expect(trayEl('pg-tray-upstairs-empty')).not.toBeNull();
	});

	it('dropBack of a non-selected pane keeps the current selection', () => {
		mountPage();
		clickItem('pg-tray-resting-scheduler');
		clickItem('pg-tray-resting-sessions');
		clickClose('scheduler');
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			selectedPanelId?: string | null;
		};
		expect(blob.selectedPanelId).toBe('sessions');
		expect(trayEl('pg-tray-upstairs-sessions')?.getAttribute('aria-current')).toBe('true');
	});

	it('select persists a pure focus change (R10 SC#1 fix 4)', () => {
		mountPage();
		clickItem('pg-tray-resting-scheduler');
		clickItem('pg-tray-upstairs-notes');
		const after = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			selectedPanelId?: string;
		};
		expect(after.selectedPanelId).toBe('notes');
	});
});

describe('playground page — language menu + greeting branches', () => {
	it('choosing zh switches the greeting and persists pg-locale', () => {
		mountPage();
		q('[data-testid="language-menu-trigger"]').click();
		flushSync();
		q('[data-testid="locale-option-zh"]').click();
		flushSync();
		expect(q('[data-testid="locale-choice"]').textContent).toContain('zh');
		expect(q('[data-testid="greeting"]').textContent).toContain('你好地板');
		expect(localStorage.getItem('pg-locale')).toBe('zh');
	});

	it('choosing id hits the third dictionary arm', () => {
		mountPage();
		q('[data-testid="language-menu-trigger"]').click();
		flushSync();
		q('[data-testid="locale-option-id"]').click();
		flushSync();
		expect(q('[data-testid="greeting"]').textContent).toContain('Halo lantai');
	});
});

describe('playground page — theme toggle branch', () => {
	it('picking Dark persists pg-theme dark', () => {
		mountPage();
		q('[data-testid="cb-theme-toggle-trigger"]').click();
		flushSync();
		const dark = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
			(el.textContent ?? '').includes('Dark')
		) as HTMLElement | undefined;
		expect(dark).not.toBeUndefined();
		dark?.click();
		flushSync();
		expect(localStorage.getItem('pg-theme')).toBe('dark');
	});
});

describe('playground page — zoom commit keeps widths untouched (SSC#2)', () => {
	function openTray(): void {
		q('[data-testid="pg-controlbar"]').dispatchEvent(new Event('mouseenter'));
		flushSync();
	}

	it('zoom slider input persists zoom only', () => {
		const root = mountPage();
		openTray();
		expect(document.querySelector('[data-testid="pg-controlbar-tray-buttons"]')).not.toBeNull();
		expect(root.querySelector('.floor')).not.toBeNull();
		const widthInput = document.querySelector<HTMLInputElement>(
			'[data-testid="pg-controlbar-slider-width-input"]'
		) as HTMLInputElement;
		widthInput.value = '1000';
		widthInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { panelWidth?: number };
		expect(blob.panelWidth).toBe(1000);
		const zoomInput = document.querySelector<HTMLInputElement>(
			'[data-testid="pg-controlbar-slider-zoom-input"]'
		) as HTMLInputElement;
		zoomInput.value = '0.75';
		zoomInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		// zoom ALONE does not persist (commitZoom is unwired; zoom rides bind
		// and lands on the next commit) — the widths stay exactly as recorded
		const mid = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			zoom?: number;
			panels?: { width: number }[];
		};
		expect(mid.zoom).toBe(1);
		expect(mid.panels?.map((p) => p.width)).toEqual([1000, 1000, 1000]);
		// the next width commit persists the bound zoom with widths untouched
		// BY THE ZOOM MOVE (the 1010 rows are the new preset, not zoom drift)
		widthInput.value = '1010';
		widthInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		const after = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			zoom?: number;
			panelWidth?: number;
		};
		expect(after.zoom).toBe(0.75);
		expect(after.panelWidth).toBe(1010);
	});
});

describe('playground page — revive fallback arms (missing entries + junk rows)', () => {
	it('a junk row (no kind) drops and panes missing from the blob fall to defaults', () => {
		localStorage.setItem(
			'pg-panels',
			JSON.stringify({
				zoom: 1,
				panelWidth: 520,
				panels: [
					{ id: 'notes', kind: 'demo-pane', width: 480, journey: 'upstairs' },
					{ id: 'broken-row', width: 10 }
				]
			})
		);
		mountPage();
		// the kind-less row dropped; notes upstairs, the other two rest
		expect(trayEl('pg-tray-upstairs-notes')).not.toBeNull();
		expect(trayEl('pg-tray-resting-scheduler')).not.toBeNull();
		expect(trayEl('pg-tray-resting-sessions')).not.toBeNull();
		// the next persist rewrites the full desk: missing panes carry the
		// fallback (panelWidth) width and the 'resting' journey arm
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string; width?: number }[];
		};
		expect(blob.panels?.map((p) => p.id)).toEqual(['notes', 'scheduler', 'sessions']);
		expect(blob.panels?.find((p) => p.id === 'scheduler')?.width).toBe(520);
		expect(blob.panels?.find((p) => p.id === 'sessions')?.width).toBe(520);
		expect(blob.panels?.find((p) => p.id === 'notes')?.width).toBe(480);
	});

	it('the floor renders the missing-entry pane; drag commit persists the fallback width', () => {
		localStorage.setItem(
			'pg-panels',
			JSON.stringify({
				zoom: 1,
				panelWidth: 640,
				panels: [{ id: 'sessions', kind: 'demo-pane', width: 700, journey: 'upstairs' }]
			})
		);
		mountPage();
		// sessions is the only upstairs pane; its index is 2, so gutter 2
		// is its seam. The other panes ride the ?? loaded.panelWidth arm.
		const gutter = q('[data-testid="panel-gutter-2"]');
		gutter.dispatchEvent(winMouseEvent(100, 'mousedown'));
		window.dispatchEvent(winMouseEvent(150, 'mousemove'));
		window.dispatchEvent(winMouseEvent(150, 'mouseup'));
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as {
			panels?: { id: string; width?: number }[];
		};
		expect(blob.panels?.find((p) => p.id === 'sessions')?.width).toBe(750);
		expect(blob.panels?.find((p) => p.id === 'notes')?.width).toBe(640);
	});
});

describe('playground page — tray filters revive junk arms (pg-tray-filters)', () => {
	it('junk stored filter values fall back to the empty string and persist back', () => {
		localStorage.setItem('pg-tray-filters', JSON.stringify({ upstairs: 42, resting: null }));
		mountPage();
		// both fallback arms ran: the filters render empty
		const up = document.querySelector<HTMLInputElement>('[data-testid="pg-tray-upstairs-filter"]');
		const down = document.querySelector<HTMLInputElement>('[data-testid="pg-tray-resting-filter"]');
		expect(up?.value).toBe('');
		expect(down?.value).toBe('');
		// the initialize-on-mount pass persisted the normalized shape
		const saved = JSON.parse(localStorage.getItem('pg-tray-filters') ?? '{}') as {
			upstairs?: unknown;
			resting?: unknown;
		};
		expect(saved).toEqual({ upstairs: '', resting: '' });
	});

	it('a non-matching upstairs filter empties its own rows only (view filter)', () => {
		const root = mountPage();
		typeFilter('pg-tray-upstairs-filter', 'zzz-no-match');
		flushSync();
		// the upstairs list is empty; the resting list keeps its rows
		expect(root.querySelector('[data-testid="pg-tray-upstairs-notes"]')).toBeNull();
		expect(root.querySelector('[data-testid="pg-tray-resting-scheduler"]')).not.toBeNull();
		// a view filter never closes panes: the floor still renders Notes
		expect(root.querySelector('.pane-body')).not.toBeNull();
		const blob = JSON.parse(localStorage.getItem('pg-tray-filters') ?? '{}') as {
			upstairs?: string;
		};
		expect(blob.upstairs).toBe('zzz-no-match');
	});
});

describe('playground page — sidebar settle without movement (no-live arm)', () => {
	it('mousedown + mouseup with no drag settles silently: no badge, width unchanged', () => {
		mountPage();
		const before = localStorage.getItem('pg-sidebar');
		const gutter = q('[data-testid="sidebar-gutter"]');
		gutter.dispatchEvent(winMouseEvent(200, 'mousedown'));
		flushSync();
		// a mouseup with zero movement: badgePhase is not 'live' → the
		// settle arm skips the fade and goes straight to saveSidebar
		window.dispatchEvent(winMouseEvent(200, 'mouseup'));
		flushSync();
		expect(document.querySelector('[data-testid="pg-sidebar-width-badge"]')).toBeNull();
		expect(localStorage.getItem('pg-sidebar')).toBe(before);
	});

	it('a sidebar drag beyond the clamp hits the max-600 arm', () => {
		mountPage();
		const gutter = q('[data-testid="sidebar-gutter"]');
		gutter.dispatchEvent(winMouseEvent(200, 'mousedown'));
		flushSync();
		window.dispatchEvent(winMouseEvent(2000, 'mousemove'));
		flushSync();
		window.dispatchEvent(winMouseEvent(2000, 'mouseup'));
		flushSync();
		const badge = document.querySelector('[data-testid="pg-sidebar-width-badge"]');
		expect(badge?.textContent).toContain('600');
		const sidebar = JSON.parse(localStorage.getItem('pg-sidebar') ?? '{}') as { width?: number };
		expect(sidebar.width).toBe(600);
	});
});
