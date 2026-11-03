/**
 * clickOutside — the shared popup dismissal contract (spec 2026-11-01,
 * Composer Popup Dismissal; RCA: the chip/model menus that never closed).
 *
 * While the consumer reports open, one document pointerdown listener and
 * one keydown listener exist; a pointerdown landing OUTSIDE the node (or
 * an Escape anywhere) calls onDismiss. Listeners install on open, remove
 * on close and on destroy — a closed widget costs zero listeners, so
 * mutual exclusivity between two menus falls out of the shared rule: the
 * trigger click of menu B is an outside pointerdown for menu A.
 *
 * LanguageMenu.svelte:32-39 is the in-repo prior art this ports to a
 * reusable action.
 */
interface ClickOutsideParams {
	/** Whether the consumer's popup is currently open. */
	open: boolean;
	/** Called with 'outside' (pointerdown beyond the node) or 'escape'. */
	onDismiss: (reason: 'outside' | 'escape') => void;
}

export function clickOutside(node: HTMLElement, params: ClickOutsideParams): { update(p: ClickOutsideParams): void; destroy(): void } {
	let current = params;

	function onPointerDown(ev: PointerEvent): void {
		if (!(ev.target instanceof Node)) return;
		if (node.contains(ev.target)) return;
		current.onDismiss('outside');
	}

	function onKeyDown(ev: KeyboardEvent): void {
		if (ev.key !== 'Escape') return;
		current.onDismiss('escape');
	}

	function apply(): void {
		if (current.open) {
			document.addEventListener('pointerdown', onPointerDown, true);
			document.addEventListener('keydown', onKeyDown, true);
		} else {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		}
	}

	apply();

	return {
		update(next: ClickOutsideParams): void {
			current = next;
			apply();
		},
		destroy(): void {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		}
	};
}
