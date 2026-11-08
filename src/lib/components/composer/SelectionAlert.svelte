<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { X } from '@lucide/svelte';

	/**
	 * SelectionAlert — the shared missing-selection alert (2026-11-08
	 * refactor): one component serves both hosts of the NewChatButton
	 * alert (inline in NewChatButton, hosted in SidebarFooter). The
	 * message renders as TWO sibling spans — the i18n sentence
	 * (m.needAgent) and the parenthetical (m.plusWorkspace) — with the
	 * parenthetical non-breaking (whitespace-nowrap), so narrow widths
	 * wrap BETWEEN the spans and never cut inside "(+ Workspace)".
	 *
	 * Carries its own × dismiss (the PanelHeader close grammar): closing
	 * only hides the message — the next unarmed click re-raises it.
	 * Call sites keep their testids via `testid`; `inset` drops the
	 * bottom margin for hosts that space the alert row themselves
	 * (the footer's .footer-create gap).
	 */

	let {
		/** The alert state — bindable so a host (the sidebar footer) can
		 *  render the alert itself, spanning its row. */
		alert = $bindable(false),
		/** data-testid prefix; the close button takes `${testid}-close`. */
		testid = 'new-chat-selection-alert',
		/** Hosted variant — no bottom margin (the host supplies spacing). */
		inset = false
	}: {
		alert?: boolean;
		testid?: string;
		inset?: boolean;
	} = $props();
</script>

{#if alert}
	<p
		data-testid={testid}
		class="flex w-full items-start justify-between gap-2 text-xs text-status-pending"
		class:mb-1={!inset}
		role="alert"
	>
		<!-- One inline run in a flex-1 wrapper: the sentence flows first
		     and "(+ Workspace)" (nowrap) follows as its own unbreakable
		     unit — a narrow width wraps BETWEEN the spans, and the ×
		     aligns with the FIRST line (items-start), never floats
		     mid-line against a wrapped sentence. -->
		<span class="min-w-0 flex-1">
			<span>{t(m.needAgent)}</span>
			<span class="whitespace-nowrap">{t(m.plusWorkspace)}</span>
		</span>
		<button
			type="button"
			class="shrink-0 rounded p-0.5 leading-none text-status-pending hover:bg-status-pending/20 hover:text-status-pending"
			data-testid={`${testid}-close`}
			aria-label={t(m.dismissAlert)}
			title={t(m.dismiss)}
			onclick={() => (alert = false)}
		>
			<X size={11} aria-hidden="true" />
		</button>
	</p>
{/if}
