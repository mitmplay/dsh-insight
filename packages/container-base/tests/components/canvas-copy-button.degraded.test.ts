import { flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import CanvasCopyButton from '../../src/components/CanvasCopyButton.svelte';

/**
 * 1.1-T degraded branch (Container Base R6, ADR-0066 D2) - html-to-image
 * is an OPTIONAL peer: when its resolution REJECTS the button degrades
 * to a no-op with a one-time console warn. This file mocks the peer as
 * unresolvable; the working-peer contract lives in canvas-copy-button.test.ts.
 */

vi.mock('html-to-image', () => {
	throw new Error('peer html-to-image is not installed');
});

describe('CanvasCopyButton degraded (peer ABSENT)', () => {
	it('renders the button but never captures; warns exactly once', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const container = document.createElement('div');
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(CanvasCopyButton, { target, props: { container } });
		flushSync();
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]')!;
		expect(btn).toBeTruthy();
		btn.click();
		await new Promise((r) => setTimeout(r, 20));
		btn.click();
		await new Promise((r) => setTimeout(r, 20));
		const captureWarns = warn.mock.calls.filter((c) => String(c[0]).includes('html-to-image'));
		expect(captureWarns.length).toBe(1);
		warn.mockRestore();
	});
});
