<script lang="ts">
	/**
	 * SessionAccess (2026-08-26) — the header’s access badge, extracted
	 * from SessionIdAndName: one char in brackets for the session’s
	 * permission mode (ADR-0007 vocabulary, folded from the ledger by
	 * the conversation store). Presentation-only — the mode arrives as
	 * a prop; unknown modes render NOTHING (never a guess).
	 *
	 * Color code (2026-08-25) — a traffic light by consequence (file
	 * power × approval), so the letter reads at a glance without the
	 * tooltip:
	 *   R green  — zero write power; everything beyond reading asks
	 *   W amber  — bounded write power; going beyond the workspace asks
	 *   F red    — whole machine, never asks (danger)
	 *   C slate  — hand-set knobs, no preset = no verdict; NEUTRAL grey,
	 *              not a warning (custom may be as tight as read-only)
	 */

	let {
		access = null
	}: {
		/** Access mode — the permission preset’s current value
		 *  (read-only | workspace-write | danger-full-access | custom);
		 *  null/unknown renders no badge. */
		access?: string | null;
	} = $props();

	const accessBadge = $derived.by<{ letter: string; label: string; cls: string } | null>(() => {
		switch (access) {
			case 'read-only':
				return {
					letter: 'R',
					label: 'Access: Read only',
					cls: 'border-status-pass/30 bg-status-pass/10 text-status-pass'
				};
			case 'workspace-write':
				return {
					letter: 'W',
					label: 'Access: Workspace write',
					cls: 'border-status-pending/30 bg-status-pending/10 text-status-pending'
				};
			case 'danger-full-access':
				return {
					letter: 'F',
					label: 'Access: Full access',
					cls: 'border-danger-wash-border bg-danger-wash text-status-fail'
				};
			case 'custom':
				return {
					letter: 'C',
					label: 'Access: Custom',
					cls: 'border-surface-border bg-surface text-text-secondary'
				};
			default:
				return null;
		}
	});
</script>

<!-- One char in brackets: R (Read only, green), W (Workspace write,
     amber), F (Full access, red), C (Custom, neutral slate); the tooltip
     carries the phrase. Hidden when the mode is unknown. -->
{#if accessBadge}
	<span
		class="inline-flex shrink-0 items-center rounded border px-1 font-mono text-[10px] leading-4 {accessBadge.cls}"
		data-testid="session-access"
		data-access={access}
		title={accessBadge.label}
		aria-label={accessBadge.label}
	>
		{accessBadge.letter}
	</span>
{/if}
