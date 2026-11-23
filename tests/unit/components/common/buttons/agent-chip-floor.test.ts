/**
 * AgentChip — floor arms (coverage headroom, 2026-11-23). The two
 * `class="agent-chip {size}"` interpolations (button mode, source L58;
 * span mode, source L71) compile to `agent-chip ${size ?? ''}` — the
 * nullish arm of each was the file's last two uncovered branches.
 *
 * Route: Svelte's $.prop applies the `size = 'chip'` default ONLY to an
 * undefined prop (svelte 5.56.10, internal/client/reactivity/props.js:340
 * `value === undefined`), so an explicit `size={null}` reaches the arm.
 * Pinned contract: a nullish size degrades to the BASE identity — the
 * `.agent-chip` class stays, NO variant class is invented (never a literal
 * 'null'/'undefined' token), the icon keeps the 12px size (only 'compact'
 * shrinks), and button mode keeps aria-pressed + the pickKey contract.
 * The boundary is pinned alongside: undefined IS the default ('chip'),
 * null is "no variant".
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentChip from '$lib/components/common/buttons/AgentChip.svelte';

type Size = 'compact' | 'pill' | 'chip';

interface ChipProps {
	label: string;
	size?: Size | null;
	interactive?: boolean;
	selected?: boolean;
	onpick?: (key: string) => void;
	pickKey?: string;
	testid?: string;
}

/** The type-violating value under test, spelled so the cast is honest. */
function nullSize(): Size {
	return null as unknown as Size;
}

// 0.3.3 typings narrowed ChipProps size to exclude null, but the runtime
// still guards the nullish arm — the null case below IS the floor, so the
// local mount type deliberately re-widens it.
function mountChip(props: Omit<ChipProps, 'size'> & { size?: Size | null }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AgentChip, { target, props: props as never }); // the deliberate null size: 0.3.3 exported type rejects it, the runtime arm handles it
	flushSync();
	return { target, instance };
}

const VARIANTS: Size[] = ['compact', 'pill', 'chip'];

/** The size-variant classes the element actually carries. */
function variants(el: Element): string[] {
	return VARIANTS.filter((v) => el.classList.contains(v));
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AgentChip — nullish size (the compiler `size ?? ...` arm)', () => {
	it('span mode (L71): size={null} keeps the base identity and invents NO variant class', () => {
		const { target, instance } = mountChip({ label: 'cordis', size: nullSize(), testid: 'chip-null-span' });
		const el = target.querySelector('[data-testid="chip-null-span"]') as HTMLElement;
		expect(el.tagName).toBe('SPAN');
		expect(el.classList.contains('agent-chip')).toBe(true);
		expect(variants(el)).toEqual([]);
		expect(el.className).not.toMatch(/null|undefined/);
		// the icon ternary's else arm: only 'compact' shrinks to 10px — null is not compact
		expect(el.querySelector('svg')?.getAttribute('width')).toBe('12');
		unmount(instance);
	});

	it('button mode (L58): size={null} keeps .on, aria-pressed and the pickKey contract', () => {
		const onpick = vi.fn();
		const { target, instance } = mountChip({
			label: 'coder',
			size: nullSize(),
			interactive: true,
			selected: true,
			pickKey: 'coder',
			onpick,
			testid: 'chip-null-btn'
		});
		const el = target.querySelector('[data-testid="chip-null-btn"]') as HTMLButtonElement;
		expect(el.tagName).toBe('BUTTON');
		expect(el.classList.contains('agent-chip')).toBe(true);
		expect(variants(el)).toEqual([]);
		expect(el.classList.contains('on')).toBe(true);
		expect(el.getAttribute('aria-pressed')).toBe('true');
		el.click();
		expect(onpick.mock.calls).toEqual([['coder']]);
		unmount(instance);
	});

	it('the boundary: an undefined size IS the default (chip); null is "no variant"', () => {
		const { target, instance } = mountChip({ label: 'a', size: undefined, testid: 'chip-undef' });
		expect(variants(target.querySelector('[data-testid="chip-undef"]') as Element)).toEqual(['chip']);
		unmount(instance);
	});
});
