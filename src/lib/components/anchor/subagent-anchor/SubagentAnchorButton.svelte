<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { Bot } from '@lucide/svelte';
	import SubagentPopup from './SubagentPopup.svelte';
	import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
	import type { DsiSubagentRow } from '$lib/types';

	/**
	 * SubagentAnchorButton — the ledger leaf of the conversation page's
	 * FloatingAnchor stack (Subagent Anchor ADR D1, placement REVISED
	 * 2026-10-26: the operator's 'anchor' means the right-edge icon
	 * column beside the transcript — JobsButton's seat — NOT the sidebar
	 * header). Lists THIS conversation's sub-agents only (the ?parent
	 * scoping, DSH dropdown parity) — one click: title, tokens, elapsed.
	 * Hidden at zero rows so the stack keeps its shape. Owns the poll:
	 * one GET per few seconds while mounted, each answer fed to the
	 * subagent-clock registry as its spine tick (ADR D3).
	 */
	let {
		sessionId,
		onopensession = undefined,
		pollMs = 4000
	}: {
		/** The conversation session whose children are listed. */
		sessionId: string;
		/** Row click — the session-open routing, threaded from the host. */
		onopensession?: (sessionId: string) => void;
		/** Poll cadence ms (test seam — the badge tick's rhythm). */
		pollMs?: number;
	} = $props();

	let rows = $state<DsiSubagentRow[]>([]);
	let open = $state(false);
	/** The toggle's wrapper — the shell's close-contract exclusion. */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	function captureTrigger(node: HTMLElement): Attachment {
		triggerEl = node;
		// an attachment returns its teardown fn directly (not an action's {destroy})
		return () => {
			triggerEl = undefined;
		};
	}

	async function poll(): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch('/api/dsh/subagents?parent=' + encodeURIComponent(sessionId));
			const body = (await res.json()) as { ok?: boolean; subagents?: DsiSubagentRow[] };
			if (body?.ok === true && Array.isArray(body.subagents)) {
				rows = body.subagents;
				subagentClock.observe(rows); // the sighting lane (ADR D3)
			}
		} catch {
			// the floor blipped — keep the last honest frame
		}
	}

	onMount(() => {
		void poll();
		const iv = setInterval(() => void poll(), pollMs);
		return () => clearInterval(iv);
	});

	const runningCount = $derived(rows.filter((r) => r.running).length);
</script>

{#if rows.length > 0}
	<div class="relative" {@attach captureTrigger} data-testid="subagent-anchor-button">
		<button
			type="button"
			class="floating-anchor-btn {runningCount > 0 ? 'tone-purple' : 'tone-idle'}"
			class:active={open}
			title={t(m.subagentAnchorLabel)}
			aria-label={t(m.subagentAnchorLabel)}
			data-testid="subagent-anchor-trigger"
			onclick={() => (open = !open)}
		>
			<Bot size={13} aria-hidden="true" />
			<!-- D4 live-set marker: the RUNNING count while any helper works;
			     at idle the total (the JobsButton label parity). -->
			<span data-testid="subagent-anchor-badge">{runningCount > 0 ? runningCount : rows.length}</span>
		</button>
		<SubagentPopup bind:open {triggerEl} {rows} onopenrow={onopensession} />
	</div>
{/if}

<style>
	/* The anchor-stack button grammar (JobsButton parity): a round leaf
	   beside the transcript; purple = at least one descendant running
	   (the Lineage Pin delegation family), idle otherwise. */
	.floating-anchor-btn {
		pointer-events: auto; /* the column is pointer-events-none — re-entry (the stack contract) */
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: background 0.15s, color 0.15s, transform 0.1s;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
	}

	.floating-anchor-btn:hover {
		transform: scale(1.08);
	}

	.tone-purple {
		border: 1px solid var(--color-accent-purple, #a855f7);
		background: color-mix(in srgb, var(--color-accent-purple, #a855f7) 12%, transparent);
		color: var(--color-accent-purple, #a855f7);
	}

	.tone-purple:hover,
	.tone-purple.active {
		color: var(--color-text-primary, #212529);
	}

	.tone-purple.active {
		background: var(--color-accent-purple, #a855f7);
		color: #fff;
		border-color: var(--color-accent-purple, #a855f7);
	}

	/* idle tone — helpers exist but none running */
	.tone-idle {
		border: 1px solid var(--color-slate-neutral, #6c757d);
		background: color-mix(in srgb, var(--color-slate-neutral, #6c757d) 10%, transparent);
		color: var(--color-slate-neutral, #6c757d);
	}

	.tone-idle:hover,
	.tone-idle.active {
		color: var(--color-text-primary, #212529);
	}

	.tone-idle.active {
		background: var(--color-slate-neutral, #6c757d);
		color: #fff;
		border-color: var(--color-slate-neutral, #6c757d);
	}
</style>