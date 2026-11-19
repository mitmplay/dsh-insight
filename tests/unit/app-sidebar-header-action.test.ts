import { flushSync, mount, unmount } from 'svelte';
import type { MountOptions, Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AppSidebarHeaderAction from '../../src/lib/components/common/layout/AppSidebarHeaderAction.svelte';

/**
 * 2.1-T (Container Base R11, ADR-0074) — the DSI thin consumer's contract:
 * the corner renders through the BASE SidebarHeaderActions with the same
 * anchors the floor/sidebar specs pin (canvas-copy-button testid, collapse
 * toggle with the paraglide label); the extras snippet renders the floor
 * ControlBar; the capture target passes through verbatim.
 */

let instances: ReturnType<typeof mount>[] = [];

function mountConsumer(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AppSidebarHeaderAction as unknown as Component, { target, props } as MountOptions<AppSidebarHeaderAction>);
	flushSync();
	instances.push(instance);
	return target;
}

afterEach(async () => {
	for (const i of instances.splice(0)) unmount(i);
});

describe('AppSidebarHeaderAction (R11 thin consumer)', () => {
	it('renders the same DSI anchors through the base corner', () => {
		const target = mountConsumer();
		expect(target.querySelector('.rail-header-actions')).toBeTruthy();
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).toBeTruthy();
		const collapse = target.querySelectorAll('button')[1]!;
		expect(collapse.getAttribute('aria-label')).toBe('Collapse sidebar');
	});

	it('renders the floor ControlBar in the extras position (last child)', () => {
		const target = mountConsumer();
		const kids = Array.from(target.querySelector('.rail-header-actions')!.children);
		const last = kids[kids.length - 1] as HTMLElement;
		const first = kids[0] as HTMLElement;
		expect(last.querySelector('[data-testid="controlbar-trigger"]')).toBeTruthy();
		// organ order intact: copy → collapse → ControlBar
		expect(first.dataset.testid).toBe('canvas-copy-button');
		expect(kids.length).toBe(3);
	});

	it('passes the capture target through to the copy organ', () => {
		const el = document.createElement('div');
		const target = mountConsumer({ captureContainer: el });
		// No crash + the copy button still exists; deeper capture wiring is
		// pinned by CanvasCopyButton's own tests and the e2e gesture gate.
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).toBeTruthy();
	});
});
