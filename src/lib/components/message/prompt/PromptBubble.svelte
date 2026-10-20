<script lang="ts">
	/**
	 * PromptBubble — one user prompt: anything the user sends to the LLM
	 * (OCI pattern, 2026-08-21). Right-aligned, square bottom-RIGHT corner —
	 * the "I am speaking" tail.
	 *
	 * Two skins (tone):
	 *   prompt  (default) — accent-blue tint: a human prompt
	 *   context            — lighter azure tint: harness context
	 *                       injections (workspace instructions · runtime
	 *                       context · skill catalog · user-approval
	 *                       notices · the System prompt disclosure),
	 *                       wrapped by ContextInjection / SystemPromptChip
	 *                       — same prompt-column contract, visually
	 *                       quieter than a human prompt
	 *
	 * The bubble shell (frame, raw ⇄ rendered body, action row, timestamp)
	 * lives in MessageBubble; this component owns the column, the skin,
	 * and the attachment gallery. Markdown body renders via the shared
	 * MarkdownContent (OCI parity, 2026-08-22) + optional children
	 * (context chips, streaming dots) + per-entry timestamp. Attachment
	 * previews (imageRefs, 2026-08-28) render ON TOP of the bubble — a
	 * sibling gallery above it, separated by the column's small gap —
	 * never inside the bubble. Action row (OCI port, 2026-08-22):
	 * when the bubble carries a body and a time, the ToolsMessage row
	 * (copy / canvas capture / save prompt / raw toggle) renders at the
	 * content edge —
	 * [Copy text]           — value to clipboard, 2s ✓ feedback
	 * [Copy canvas as image] — html-to-image capture; Shift+Click saves PNG
	 * [Save prompt]          — adds the text to the prompts library
	 *                          (ADR E4; prompt-side only — AssistantTurn
	 *                          hides it)
	 * [Raw markdown]         — flips rendered ⇄ raw source
	 * Timestamp moves under the bubble's bottom edge (opacity-fade pair with
	 * the row, OCI placement). Assistant responses live in AssistantTurn —
	 * this bubble is user-side only.
	 */
	import MessageBubble from './MessageBubble.svelte';
	import MessageImages from './MessageImages.svelte';
	import type { DsiImageRef } from '$lib/types';

	let {
		text,
		time,
		tone = 'prompt',
		imageRefs = [],
		sessionId,
		children,
		onFileLink
	}: {
		/** Markdown body — omitted in children-only mounts (context chips). */
		text?: string;
		/** Wire: entry.time (ms epoch) — optional only for test mounts. */
		time?: number;
		/** Skin: prompt (blue, human) vs context (light-gray, harness). */
		tone?: 'prompt' | 'context';
		/** Durable image refs from this message's blocks (Wave 3 task 3.4):
		 *  rendered through the session-authorized read, never the draft. */
		imageRefs?: DsiImageRef[];
		/** Owning session — the attachment read's authorization scope. */
		sessionId?: string;
		children?: import('svelte').Snippet;
		/** File Link Intent forwarder — reaches the bubble's markdown body. */
		onFileLink?: (path: string) => void;
	} = $props();

	const skin = $derived(
		tone === 'context' ? 'bg-accent-blue/10 border-accent-blue/20' : 'bg-accent-blue/15 border-accent-blue/20'
	);
</script>

<div class="flex w-full min-w-0 flex-col items-end gap-1.5">
	<!-- Attachment previews ride ON TOP of the bubble (2026-08-28): the
	     gallery renders ABOVE the bubble as a sibling — never inside it —
	     and the column's small gap owns the gallery↔bubble rhythm. The
	     gallery shares the bubble's 80% width budget, right-aligned. -->
	{#if imageRefs.length > 0 && sessionId !== undefined}
		<div class="max-w-[80%]">
			<MessageImages refs={imageRefs} {sessionId} />
		</div>
	{/if}
	<MessageBubble role="user" {skin} {text} {time} {onFileLink}>
		{#if children}{@render children()}{/if}
	</MessageBubble>
</div>
