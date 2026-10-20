<script lang="ts">
	import Composer from '$lib/components/composer/Composer.svelte';
	import type { SerializedImage } from '$lib/services/chat/attachment-service.svelte';
	import type { DsiPermission } from '$lib/services/conversation/permission-state';
	import type { DsiImageLimits } from '$lib/services/conversation/image-limits';
	import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';
	import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
	import { isSyncChecked } from '$lib/services/chat/prompt-sync.svelte';

	/**
	 * ConversationFooter — the conversation page's send surface wrapper
	 * (extracted from the page, 2026-08-23): the bottom bar hosting
	 * Composer. Pure layout shell — every input prop passes through
	 * unchanged; the send/cancel intents and page state stay page-owned.
	 *
	 * Focus tint (2026-08-28): on the panel floor the focused panel's
	 * footer tints oldlace — with N conversations side by side, the
	 * composer you would type into is the tinted one. The broadcast
	 * checkmark wears a pastel gradient instead (2026-09-04): a
	 * yellowgreen wash fading into oldlace — a checked composer is one
	 * the sidebar box is about to type into, the same "aimed at"
	 * signal read straight from the sync store, at one hue past focus.
	 */
	let {
		onsubmit,
		oncancel,
		isStreaming,
		sending,
		sessionId,
		contextTokens,
		totalContextLimit = undefined,
		permission = null,
		onpermission = undefined,
		imageLimits = undefined,
		onrunmacro = undefined,
		onstep = undefined,
		onrows = undefined,
		slashCatalog = null,
		onslashopen = undefined,
		onpickcommand = undefined,
		focusOnMount = false,
		onfocused = undefined,
		focused = false
	}: {
		/** Submit one prompt (page-owned intent); images serialized at submit (W2). */
		onsubmit: (text: string, images: SerializedImage[]) => boolean | Promise<boolean>;
		/** Cancel the running turn (page-owned intent). */
		oncancel: () => void | Promise<void>;
		/** A turn is running — Send flips to Cancel. */
		isStreaming: boolean;
		/** A submit is awaiting its receipt. */
		sending: boolean;
		/** Session id — Composer's model selector mount. */
		sessionId: string;
		/** Context tokens consumed by the last model request. */
		contextTokens: number | undefined;
		/** Context window limit (client-resolved catalog, OCI parity);
		 *  undefined → the label keeps its no-limit fallback. */
		totalContextLimit?: number | undefined;
		/** Access-mode read state (ADR-0007); null hides the chip. */
		permission?: DsiPermission | null;
		/** Submit one preset pick (ADR-0007 — the /permission POST). */
		onpermission?: (preset: string) => Promise<boolean> | boolean;
		/** Host admission numbers (imageLimits projection, W4) — pass-through. */
		imageLimits?: DsiImageLimits;
		/** Prompt Macro: run-accept (`!` Enter/Tab/click) — panel starts the run. */
		onrunmacro?: (index: number) => void;
		/** Prompt Macro: ⏯ Step — panel starts the run held. */
		onstep?: (index: number) => void;
		/** Prompt Macro: strip-rows mirror for index resolution. */
		onrows?: (rows: SuggestedPrompt[]) => void;
		/** Slash Menu: the panel-held catalog view — pass-through (the
		 *  panel owns directoryFor; the footer owns no behavior). */
		slashCatalog?: SlashDirectory | null;
		/** Slash Menu: re-query bridge — pass-through. */
		onslashopen?: () => void;
		/** Slash Menu: execute a picked host command — pass-through
		 *  (the BC-A3 boolean rides verbatim). */
		onpickcommand?: (line: string) => boolean | Promise<boolean>;
		/** Focus the composer's textarea once at mount (the /new swap-focus) —
		 *  pass-through to Composer; absent keeps ordinary mounts unfocused. */
		focusOnMount?: boolean;
		/** Fired once after the mount focus landed — pass-through. */
		onfocused?: () => void;
		/** This panel is the floor's focused panel (the route's
		 *  selectedPanelId) — the footer tints oldlace. */
		focused?: boolean;
	} = $props();

	/** The tint: a checked footer wears the pastel broadcast gradient — a
	 *  yellowgreen wash (the checkmark's own hue) fading into oldlace —
	 *  because the sidebar box is about to type into it; a focused-only
	 *  footer wears the flat oldlace focus tint. Checked wins when both
	 *  hold: membership is the more specific "aimed at" signal. */
	const tintClass = $derived(
		isSyncChecked(sessionId)
			? 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-status-pass)_18%,var(--color-surface)),var(--color-header-wash)_65%,var(--color-surface))]'
			: focused
				? 'bg-header-wash'
				: 'bg-surface-elevated'
	);
</script>

<footer
	class="border-t border-surface-border px-1 py-1 {tintClass}"
	data-testid="conversation-footer"
	data-focused={focused ? 'true' : 'false'}
>
	<div class="mx-auto max-w-3xl">
		<Composer
			{onsubmit}
			{oncancel}
			{isStreaming}
			{sending}
			{sessionId}
			{contextTokens}
			{totalContextLimit}
			{permission}
			{onpermission}
			{imageLimits}
			{onrunmacro}
			{onstep}
			{onrows}
			{slashCatalog}
			{onslashopen}
			{onpickcommand}
			{focusOnMount}
			{onfocused}
		/>
	</div>
</footer>
