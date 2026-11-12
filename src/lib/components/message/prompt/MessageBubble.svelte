<script lang="ts">
	/**
	 * MessageBubble — the chat bubble shell one message sits in
	 * (extracted from PromptBubble, 2026-09-02). Owns the rounded bubble
	 * frame, the raw ⇄ rendered body flip, the children slot, the
	 * ToolsMessage action row, and the RelativeTime stamp:
	 *
	 *   role user      — right tail (rounded-br-sm), stamp bottom-right
	 *   role assistant — left tail (rounded-bl-sm), stamp bottom-left
	 *
	 * The skin (tint + border classes) comes from the host: prompt blue,
	 * context gray, assistant surface — this shell is tone-agnostic. When
	 * the bubble carries a body (text) and a time, the action row and
	 * stamp mount at the content edge (hover-reveal family, OCI
	 * placement); children-only mounts (context chips) get neither.
	 */
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
	import ToolsMessage from '$lib/components/message/common/ToolsMessage.svelte';
	import RelativeTime from '$lib/components/message/common/RelativeTime.svelte';

	let {
		role,
		skin,
		text,
		time,
		showSave = true,
		children,
		onFileLink,
		hideMarkdown = false,
		workspaceRoot = undefined
	}: {
		/** Which side of the conversation the bubble speaks for — picks
		 *  the square tail corner, data-role, and the stamp's edge. */
		role: 'user' | 'assistant';
		/** Tone classes (background + border) — the host's skin. */
		skin: string;
		/** Markdown body — omitted in children-only mounts (context chips). */
		text?: string;
		/** Wire: entry.time (ms epoch) — optional only for test mounts. */
		time?: number;
		/** Save-prompt button on the action row — prompt bubbles only. */
		showSave?: boolean;
		children?: import('svelte').Snippet;
		/** File Link Intent: forward the transcript click so a file link in
		 *  a USER bubble opens the workspace file too (parity with the
		 *  assistant turn) — without it the anchor natively navigates. */
		onFileLink?: (path: string) => void;
		/** The children snippet IS the body (2026-10-29 injected data-table):
		 *  suppress the markdown/raw render while text still rides the props
		 *  — the action row's Copy/Raw keep the real wire text, and the
		 *  action row + stamp mount exactly as for a text bubble. */
		hideMarkdown?: boolean;
		/** Inline images (ADR "The Silent Root" D1, 2026-11-12): the session
		 *  workspace root forwarded to MarkdownContent's img data-ws-src → src
		 *  rewrite. Absent → imgs stay alt-only (the D1 fallback). */
		workspaceRoot?: string;
	} = $props();

	/** Raw ⇄ rendered flip state — owned here, wired to ToolsMessage. */
	let showRaw = $state(false);
	/** Bubble element ref — capture target for the canvas copy button. */
	let bubbleEl: HTMLDivElement | undefined = $state();

	const tail = $derived(role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions — hover only fades
     in the always-present action buttons (cosmetic reveal; the buttons
     themselves remain keyboard-accessible) -->
<div
	class="group/bubble relative max-w-[80%] rounded-2xl {tail} border px-4 pt-2 pb-3 text-sm leading-relaxed text-text-primary {skin}"
	bind:this={bubbleEl}
	data-testid="message-bubble"
	data-role={role}
	onmouseenter={() => {}}
	onmouseleave={() => {}}
>
	{#if text !== undefined && !hideMarkdown}
		{#if showRaw}
			<pre
				class="whitespace-pre-wrap break-words font-mono text-text-secondary text-sm leading-relaxed"
				data-testid="message-raw"
			>{text}</pre>
		{:else}
			<MarkdownContent content={text} hideToggle {onFileLink} {workspaceRoot} />
		{/if}
	{/if}
	{#if children}
		<div class={text === undefined ? '' : 'mt-1'}>{@render children()}</div>
	{/if}

	{#if text !== undefined && time !== undefined}		<!-- 3-button action row lives in ToolsMessage; the timestamp in
		     RelativeTime (per-bubble, same hover-reveal family) -->
		<ToolsMessage {text} container={bubbleEl} bind:showRaw {showSave} />
		<RelativeTime
			{time}
			{role}
			class="absolute bottom-0.5 {role === 'user' ? 'right-3' : 'left-3'} text-[10px] text-text-muted/60 group-hover/bubble:text-[var(--color-accent-deep)]"
		/>
	{/if}
</div>
