/**
 * 2.1-T (ADR-0076, the prepare hook on CodeCard): the capture button
 * mounts top-right of the title row; prepare opens ALL three fold
 * states and awaits one microtask before the raster; restore returns
 * the pre-click states exactly — including "was already open". The
 * rawOnly (junk args) branch renders no button.
 */
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import CodeCard from '$lib/components/message/cards/CodeCard.svelte';

vi.mock('html-to-image', () => ({
	toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
	toCanvas: vi.fn()
}));

const longCode = Array.from({ length: 45 }, (_, i) => `const v${i} = ${i};`).join('\n');

function installClipboard() {
	Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => {}) }, configurable: true });
}

function render(props: { argsRaw?: string; resultText?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CodeCard, { target, props });
	flushSync();
	const btn = target.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]');
	return { target, btn, unmount: () => unmount(comp) };
}

beforeEach(() => {
	vi.clearAllMocks();
	installClipboard();
});

describe('CodeCard capture button (ADR-0076)', () => {
	it('renders the canvas-copy-button under the code-card', () => {
		const { target, btn, unmount } = render({ argsRaw: JSON.stringify({ code: 'const a = 1;' }) });
		expect(target.querySelector('[data-testid="code-card"]')).not.toBeNull();
		expect(btn).not.toBeNull();
		expect(btn!.dataset.testid).toBe('canvas-copy-button');
		unmount();
	});

	it('renders no button in the rawOnly branch (junk args)', () => {
		const { btn, unmount } = render({ argsRaw: 'not json at all' });
		expect(btn).toBeNull();
		unmount();
	});

	it('prepare opens all three fold states and flushes before the raster', async () => {
		// DOM snapshot taken INSIDE the mocked engine — by then prepare has
		// run AND its microtask flush landed (toBlob is called after both).
		(toBlob as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			const card = document.querySelector('[data-testid="code-card"]') as HTMLElement;
			// full lines — over-cap 45-line program fully expanded
			expect(card.textContent).toContain('const v44 = 44;');
			// footer pane + raw panes rendered
			expect(card.querySelector('[data-testid="code-result-pane"]')).not.toBeNull();
			expect(card.querySelector('[data-testid="code-raw-args"]')).not.toBeNull();
			expect(card.querySelector('[data-testid="code-raw-result"]')).not.toBeNull();
			return new Blob(['png'], { type: 'image/png' });
		});
		const { target, btn, unmount } = render({ argsRaw: JSON.stringify({ code: longCode }), resultText: 'program output' });
		btn!.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(btn!.querySelector('.ccb-spin')).toBeFalsy());
		// restore ran: all three states back to their pre-click defaults
		const card = target.querySelector('[data-testid="code-card"]') as HTMLElement;
		expect(card.textContent).not.toContain('const v44 = 44;'); // collapsed to the 40-line cap
		expect(card.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		expect(card.querySelector('[data-testid="code-raw-args"]')).toBeNull();
		expect(btn!.querySelector('svg')?.getAttribute('stroke')).toBe('var(--color-status-pass)');
		unmount();
	});

	it('restore keeps an already-open card open (exact pre-click states)', async () => {
		const { target, btn, unmount } = render({ argsRaw: JSON.stringify({ code: longCode }), resultText: 'out' });
		// operator opened every fold before capturing
		(target.querySelector('[data-testid="code-block-toggle"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="code-result-footer-toggle"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="code-raw-toggle"]') as HTMLButtonElement).click();
		flushSync();
		btn!.click();
		await vi.waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(btn!.querySelector('.ccb-spin')).toBeFalsy());
		const card = target.querySelector('[data-testid="code-card"]') as HTMLElement;
		// everything the operator had open STAYS open after the capture
		expect(card.textContent).toContain('const v44 = 44;');
		expect(card.querySelector('[data-testid="code-result-pane"]')).not.toBeNull();
		expect(card.querySelector('[data-testid="code-raw-args"]')).not.toBeNull();
		unmount();
	});
});
