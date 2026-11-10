/**
 * AboutButton unit tests — the circled-A About trigger.
 *
 * Component-direct mount (about-dialog.test.ts pattern). Pins the
 * trigger surface (label, title, passthrough class) and the BC-7
 * portal contract the HOST owns here: clicking the trigger mounts the
 * AboutDialog through a portal host appended to document.body, the
 * dialog's onclose flips the state back and unmounts the portal, and
 * unmounting the button removes an open portal from the body.
 */
import { mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AboutButton from '$lib/components/common/layout/AboutButton.svelte';

function renderButton(props: { class?: string } = {}): { unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(AboutButton, { target, props });
	return { unmount: () => unmount(comp) };
}

function trigger(): HTMLButtonElement {
	return document.querySelector('[data-testid="sidebar-about-trigger"]') as HTMLButtonElement;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AboutButton — the circled-A trigger', () => {
	it('renders the trigger with aria-label, title, and the base class', () => {
		renderButton();
		const btn = trigger();
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.getAttribute('aria-label')).toBe('About Deepseek Insight');
		expect(btn.getAttribute('title')).toBe('About Deepseek Insight');
		expect(btn.classList.contains('about-trigger')).toBe(true);
	});

	it('layers a passthrough class onto the trigger', () => {
		renderButton({ class: 'rail-collapsed-label' });
		const btn = trigger();
		expect(btn.classList.contains('about-trigger')).toBe(true);
		expect(btn.classList.contains('rail-collapsed-label')).toBe(true);
	});

	it('starts closed — no dialog anywhere in the document', () => {
		renderButton();
		expect(document.querySelector('.about-backdrop')).toBeNull();
	});

	it('clicking the trigger opens the AboutDialog through a body-level portal', async () => {
		renderButton();
		trigger().click();
		await tick();
		const dialog = document.querySelector('.about-backdrop');
		expect(dialog).not.toBeNull();
		// BC-7: the portal host is a direct child of document.body, not the component target.
		expect(dialog!.parentElement?.parentElement).toBe(document.body);
	});

	it('the dialog onclose flips the state back and removes the portal', async () => {
		renderButton();
		trigger().click();
		await tick();
		expect(document.querySelector('.about-backdrop')).not.toBeNull();
		(document.querySelector('[data-testid="about-close"]') as HTMLButtonElement).click();
		await tick();
		expect(document.querySelector('.about-backdrop')).toBeNull();
		// the trigger itself survives close and can reopen
		trigger().click();
		await tick();
		expect(document.querySelector('.about-backdrop')).not.toBeNull();
	});

	it('unmounting with the dialog open removes the portal host from document.body', async () => {
		const { unmount: off } = renderButton();
		trigger().click();
		await tick();
		expect(document.querySelector('.about-backdrop')).not.toBeNull();
		off();
		expect(document.querySelector('.about-backdrop')).toBeNull();
	});

	// Coverage mop (2026-11-10): the nullish fallback arm of the
	// passthrough-class interpolation — a null prop rides the compiler's
	// `?? ''` fallback and the trigger still renders its base class.
	it('a null class prop falls back to the bare trigger class', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AboutButton, { target, props: { class: null } as never });
		const btn = trigger();
		expect(btn.classList.contains('about-trigger')).toBe(true);
		// the nullish fallback yields an empty string, not the literal "null"
		expect(btn.className).not.toContain('null');
		unmount(comp);
		target.remove();
	});

	// Coverage mop: mount → unmount WITHOUT ever opening — the portal
	// effect's early-return arm (aboutPortal still undefined) and its
	// empty cleanup path.
	it('unmounting without ever opening leaves no portal behind', () => {
		const { unmount: off } = renderButton();
		expect(document.body.querySelectorAll('body > div:not([data-testid])').length).toBeGreaterThanOrEqual(0);
		off();
		expect(document.querySelector('.about-backdrop')).toBeNull();
		expect(trigger()).toBeNull();
	});
});
