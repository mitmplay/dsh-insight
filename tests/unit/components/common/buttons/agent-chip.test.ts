/**
 * AgentChip unit tests (2026-11-06) — pins the shared pill contract:
 *  - span mode by default, button mode when interactive;
 *  - aria-pressed tracks selected; a click forwards pickKey via onpick;
 *  - count badge renders only when passed;
 *  - the identity classes (.agent-chip, size variant, .on) are present;
 *  - compact mode renders the 10px icon variant (span, no button).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentChip from '$lib/components/common/buttons/AgentChip.svelte';

interface ChipProps {
	label: string;
	count?: number | null;
	interactive?: boolean;
	selected?: boolean;
	onpick?: (key: string) => void;
	pickKey?: string;
	title?: string;
	testid?: string;
	/** Legacy flag, no longer a declared AgentChip prop — ignored at runtime. */
	compact?: boolean;
	size?: 'compact' | 'pill' | 'chip';
	maxWidth?: string;
}

function mountChip(props: ChipProps) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AgentChip, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AgentChip — modes', () => {
	it('renders a span by default (display-only identity)', () => {
		const { target, instance } = mountChip({ label: 'Creator mode', testid: 'chip-x' });
		const el = target.querySelector('[data-testid="chip-x"]');
		expect(el?.tagName).toBe('SPAN');
		expect(el?.classList.contains('agent-chip')).toBe(true);
		expect(el?.textContent).toContain('Creator mode');
		unmount(instance);
	});

	it('renders a button with type and aria-pressed when interactive', () => {
		const { target, instance } = mountChip({
			label: 'coder', interactive: true, selected: false, size: 'pill', testid: 'chip-y'
		});
		const el = target.querySelector('[data-testid="chip-y"]');
		expect(el?.tagName).toBe('BUTTON');
		expect(el?.getAttribute('type')).toBe('button');
		expect(el?.getAttribute('aria-pressed')).toBe('false');
		expect(el?.classList.contains('pill')).toBe(true);
		unmount(instance);
	});
});

describe('AgentChip — selection and pick', () => {
	it('marks selected with .on + aria-pressed="true"', () => {
		const { target, instance } = mountChip({
			label: 'coder', interactive: true, selected: true, testid: 'chip-s'
		});
		const el = target.querySelector('[data-testid="chip-s"]');
		expect(el?.classList.contains('on')).toBe(true);
		expect(el?.getAttribute('aria-pressed')).toBe('true');
		unmount(instance);
	});

	it('a click with NO onpick handler is a harmless no-op (optional-call arm)', () => {
		const { target, instance } = mountChip({
			label: 'coder', interactive: true, pickKey: 'coder', testid: 'chip-nopick'
		});
		expect(() => {
			(target.querySelector('[data-testid="chip-nopick"]') as HTMLButtonElement).click();
		}).not.toThrow();
		unmount(instance);
	});

	it('forwards pickKey through onpick on click', () => {
		const onpick = vi.fn();
		const { target, instance } = mountChip({
			label: 'coder', interactive: true, pickKey: 'coder', onpick, testid: 'chip-p'
		});
		(target.querySelector('[data-testid="chip-p"]') as HTMLButtonElement).click();
		expect(onpick.mock.calls).toEqual([['coder']]);
		unmount(instance);
	});
});

describe('AgentChip — count and sizes', () => {
	it('renders the count badge only when passed', () => {
		const withCount = mountChip({ label: 'a', interactive: true, count: 3, testid: 'c1' });
		expect(withCount.target.querySelector('[data-testid="c1"] .count')?.textContent).toBe('3');
		unmount(withCount.instance);
		const noCount = mountChip({ label: 'a', interactive: true, testid: 'c2' });
		expect(noCount.target.querySelector('[data-testid="c2"] .count')).toBeNull();
		unmount(noCount.instance);
	});

	it('compact renders the summary chip variant with the svg icon', () => {
		const { target, instance } = mountChip({
			label: 'cordis', compact: true, size: 'compact', testid: 'chip-c'
		});
		const el = target.querySelector('[data-testid="chip-c"]');
		expect(el?.tagName).toBe('SPAN');
		expect(el?.classList.contains('compact')).toBe(true);
		expect(el?.querySelector('svg')).not.toBeNull();
		unmount(instance);
	});
});
