/**
 * Panel chassis-refusal pin (spec 2026-11-08 Glass Chassis Remote CDP,
 * task 1.5-T; ADR-0054). A chassis-stamped open failure must render the
 * registry's message — it NAMES the glass chassis — via the existing
 * failReason channel; a non-JSON body keeps the generic reason.
 * Mount/mocking idiom copied from tests/unit/browser-panel-branch-mop.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

class StubEventSource {
	constructor(url: string) {
		void url;
	}
	addEventListener(): void {}
	close(): void {}
}

const FrameImage = class {
	onload: (() => void) | null = null;
	_src = '';
	width = 800;
	height = 400;
	set src(v: string) {
		this._src = v;
	}
};

function mountPanel(props: Record<string, unknown> = {}): { target: HTMLElement; un: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props });
	return {
		target,
		un: () => {
			unmount(instance);
			target.remove();
		}
	};
}

const CHASSIS_MESSAGE =
	'glass chassis unreachable at http://192.168.1.9:9560: ECONNREFUSED — the floor is chassis-stamped, so no local birth was attempted (ADR-0054)';

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('BrowserPanel — chassis-stamped open refusal (ADR-0054)', () => {
	it('renders the chassis-naming message from the 500 body, not a generic open-failed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'OPEN_FAILED', message: CHASSIS_MESSAGE }), { status: 500 }))
		);
		const { target, un } = mountPanel({ browserSessionId: undefined }); // cold shape → POST /api/browser
		for (let i = 0; i < 4; i += 1) {
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
		}
		flushSync();
		expect(target.querySelector('[data-testid="browser-failed"]')).toBeTruthy();
		// the refusal NAMES the chassis — the honest give-up, no silent fallback
		expect(target.textContent).toContain('glass chassis unreachable at http://192.168.1.9:9560');
		expect(target.textContent).not.toContain('open failed: 500');
		un();
	});

	it('a non-JSON 500 body keeps the generic reason (the fallback arm stands)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
		const { target, un } = mountPanel({ browserSessionId: undefined });
		for (let i = 0; i < 4; i += 1) {
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
		}
		flushSync();
		expect(target.querySelector('[data-testid="browser-failed"]')).toBeTruthy();
		expect(target.textContent).toContain('open failed: 500');
		un();
	});
});
