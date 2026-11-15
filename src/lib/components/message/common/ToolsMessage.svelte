<!--
	ToolsMessage — the hover-revealed action row for a message bubble:
	[Copy text] [Copy canvas as image] [Raw markdown ⇄ rendered] [Save prompt]
	[Fork from this turn] (extracted from PromptBubble, 2026-08-22; Save
	prompt joined the row Suggest Strip Wave 3, ADR E4). Save prompt is
	prompt-side only (2026-08-30): saving to the prompts library is a
	human-prompt action, so AssistantTurn mounts pass showSave={false}
	while PromptBubble keeps the default. Fork-here joined the row with
	the Fork-Here Button ADR (2026-09-02): the optional `fork` slot arms
	the row on assistant turns of forkable panels — including tool-only
	turns, whose row then carries canvas + fork only (copy and the raw
	flip stay text-gated). PromptBubble mounts pass no `fork`.

	Positioning contract: absolute bottom-center at the bubble's content
	edge (bottom-0.15 left-1/2), opacity-gated on the host's
	group-hover/bubble — mount it inside a `group/bubble` element.

	All state stays with the host: text (copy + save value; undefined on
	fork-only rows), container (canvas capture target), showRaw (bindable
	raw ⇄ rendered flip), fork (the turn's anchor + refusal callback).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import { CanvasCopyButton } from '@deepseek-insight/container-base';
	import SavePromptButton from '$lib/components/common/buttons/SavePromptButton.svelte';
	import ForkHereButton from '$lib/components/common/buttons/ForkHereButton.svelte';
	import RawPreviewToggle from '$lib/components/common/viewers/RawPreviewToggle.svelte';

	let {
		text,
		container,
		showSave = true,
		showRaw = $bindable(false),
		fork = null
	}: {
		/** Copy-text value — the bubble's markdown body; undefined on
		 *  fork-only rows (a tool-only turn has no text to copy). */
		text?: string;
		/** Canvas capture target — the bubble element. */
		container: HTMLElement | null | undefined;
		/** Save-prompt button on the row — prompt bubbles only;
		 *  AssistantTurn passes false (a turn is not a prompt). */
		showSave?: boolean;
		/** Raw ⇄ rendered flip state — owned by the host. */
		showRaw: boolean;
		/** Fork-here slot (The Fork-Here Button ADR, 2026-09-02): the
		 *  turn's anchor and refusal callback; null = no fork button
		 *  (prompt bubbles, sub-agent panels). */
		fork?: {
			sessionId: string;
			atSeq: number;
			title?: string | null;
			agentPreset?: string | null;
			onrefusal?: (message: string) => void;
		} | null;
	} = $props();
</script>

<div
	class="flex items-center gap-1 absolute bottom-0.15 left-1/2 -translate-x-1/2 opacity-0 group-hover/bubble:opacity-100 transition-opacity"
	data-testid="prompt-action-row"
>
	{#if text !== undefined}
		<CopyButton
			value={text}
			title={t(m.copyText)}
			size={12}
			class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
		/>
	{/if}
	{#if text !== undefined}
		<RawPreviewToggle bind:showRaw />
	{/if}
	{#if showSave && text !== undefined}
		<SavePromptButton
			{text}
			size={12}
			title={t(m.savePrompt)}
			class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
		/>
	{/if}
	{#if fork}
		<ForkHereButton
			sessionId={fork.sessionId}
			atSeq={fork.atSeq}
			title={fork.title ?? null}
			agentPreset={fork.agentPreset ?? null}
			onrefusal={fork.onrefusal}
			class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
		/>
	{/if}
	<CanvasCopyButton
		{container}
		size={12}
		class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
	/>
</div>
