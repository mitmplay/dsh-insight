<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PanelLoupe — the reading lens over one floor panel (The Panel Loupe
	 * ADR D2/D5, 2026-09-04): a body-portaled modal dialog that renders
	 * one panel's content at reading size while the floor keeps its
	 * zoom. ANY kind lenses (The Loupe for Every Panel, 2026-09-08): the
	 * route feeds the SAME body snippet the column renders (D7 — one
	 * ladder, two sites) and the header rides the panel's label variant;
	 * the loupe itself carries no conversation logic.
	 *
	 * Contract donor: ImageLightbox (2026-08-28) — the portal, the fixed
	 * inset-0 z-[1000] layer, role="dialog" aria-modal, the mask's
	 * mousedown close, Escape, the × control, focus to the × on open and
	 * back to the opener on close. The portal is load-bearing: the floor
	 * row carries transform: scale(), and a fixed backdrop inside a
	 * transformed ancestor is trapped in that ancestor's box instead of
	 * covering the viewport (ADR D2). The action is inlined here by
	 * decision — the donor is cited, not modified or refactored.
	 *
	 * Lens flag (D8): setLensMode(true) during init, BEFORE children
	 * render — every floor-verb control inside the body snippet reads the
	 * flag at its own init and renders visible-disabled. Context follows
	 * the component tree, so the flag reaches snippet content even after
	 * the portal moves the DOM under document.body (asserted by the loupe
	 * unit tests).
	 *
	 * The lens × and this header's copy-id are the loupe's live controls;
	 * the header's move/close render visible-disabled (the floor verbs).
	 * Openness is the route's session-local state — never persisted (D5).
	 */
	import { setLensMode } from '$lib/services/conversation/lens-context.svelte';
	import PanelHeader from './PanelHeader.svelte';

	let {
		panelId,
		sessionId,
		label = undefined,
		onclose,
		children
	}: {
		/** The louvered panel's floor id — feeds the header strip and the root testid hook. */
		panelId: string;
		/** The session the lens reads — the header's identity label/copy value.
		 *  Empty for the kinds with no session (manager, settings, doc). */
		sessionId: string;
		/** The header's variant title (manager/settings/doc kinds —
		 *  The Loupe for Every Panel, 2026-09-08); undefined renders the
		 *  conversation header verbatim (id + copy button). */
		label?: string;
		/** Dismiss callback — the route owns the open state (D5). */
		onclose: () => void;
		/** The route's shared panel-body snippet (D7) — the real
		 *  ConversationPanel, `panelId={null}` outside the floor (D3). */
		children: import('svelte').Snippet;
	} = $props();

	// The flag lands before any snippet component initializes (D8): a
	// component inside the children snippet has this component as its
	// context parent.
	setLensMode(true);

	/** The close control — focus target when the lens opens. */
	let closeButton = $state<HTMLButtonElement | null>(null);

	/** Portal the mounted root to document.body (the ImageLightbox donor
	 *  action, inlined — ADR D2). */
	function portal(node: HTMLElement): { destroy(): void } {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	$effect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeButton?.focus();
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onclose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			opener?.focus();
		};
	});
</script>

<div
	use:portal
	class="fixed inset-0 z-[1000] grid place-items-center p-10"
	role="dialog"
	aria-modal="true"
	aria-label={t(m.panelLoupe)}
	data-testid="panel-loupe"
	data-panel-id={panelId}
	data-session-id={sessionId}
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --
		The mask is the "click outside closes" surface; keyboard users close
		through Escape and the close control (the ImageLightbox mask shape). -->
	<div
		class="absolute inset-0 bg-black/60"
		aria-hidden="true"
		onmousedown={onclose}
		data-testid="panel-loupe-mask"
	></div>
	<!-- The reading sheet (D2): generous and fixed — never derived from
	     the panel's floor width. The height caps at the padded content
	     box (min(95vh, 100vh − 5rem)): a raw 95vh sheet is taller than
	     the p-10 grid's content box on any viewport under 1600px tall,
	     and a grid item that overflows its track start-pins instead of
	     centering — the sheet crowds the bottom margin (fixed
	     2026-09-07). The wrapper is the ×'s positioning
	     anchor: the close floats at the SHEET's corner, so it hugs the
	     content at any viewport size (a viewport-fixed × would drift
	     hundreds of pixels from a centered 850px sheet on a wide
	     monitor). The body row is a FLEX COLUMN — ConversationPanel's
	     root is flex-1/overflow-auto and bounds its scroll area against
	     a flex parent exactly as the floor's .body does; a block parent
	     would let the transcript grow unbounded and clip instead of
	     scroll. -->
	<div
		class="relative"
		style="width: min(100vw - 4rem, 850px); height: min(95vh, calc(100vh - 5rem));"
		data-testid="panel-loupe-sheet"
	>
		<div
			class="flex h-full w-full flex-col overflow-hidden rounded-xl shadow-2xl"
			style="background: var(--color-surface-primary, var(--color-surface-elevated));"
		>
			<PanelHeader panelId={panelId} {sessionId} {label} lens />
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				{@render children()}
			</div>
		</div>
		<button
			type="button"
			bind:this={closeButton}
			onclick={onclose}
			aria-label={t(m.closeLoupe)}
			data-testid="panel-loupe-close"
			class="absolute -top-3 -right-3 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-lg leading-none text-text-primary shadow-md hover:bg-surface-hover"
		>×</button>
	</div>
</div>
