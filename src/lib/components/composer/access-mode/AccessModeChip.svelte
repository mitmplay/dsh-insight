<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { DsiPermission } from '$lib/services/conversation/permission-state';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import AccessModeConfirm from './AccessModeConfirm.svelte';
	import { clickOutside } from '$lib/actions/click-outside';
	import {
		CUSTOM_PRESET,
		FULL_ACCESS_PRESET,
		presetDescription,
		presetLabel
	} from '$lib/services/conversation/permission-state';

	/**
	 * AccessModeChip — the session's access mode in the prompt footer
	 * (ADR-0007, 2026-08-25; DSH PermissionSelect port, ModelSelector
	 * grammar). Presentational: read state arrives via `permission`
	 * (store-derived), picks leave through `onpick` (the panel's POST to
	 * /api/dsh/session/[id]/permission — the fixed `/permission` line is
	 * the route's business, never this component's).
	 *
	 * Confirmation semantics (R5): a pick shows optimistically and the
	 * trigger stays disabled until `permission.current` equals the pick —
	 * the next poll's knob events confirm; a failed POST clears the pick
	 * and surfaces the error. No event injection client-side.
	 *
	 * R7 — the risk gate: choosing Full access NEVER submits directly; a
	 * modal demands an explicit acknowledgement first (DSH parity: a
	 * second UI must not be the cheap way around the first's guardrails).
	 * Cancel/Escape/mask click submit nothing and reset the checkbox.
	 *
	 * Dialog placement (2026-09 fix): the R7 gate portals to document.body
	 * (BC-7 — the floor's transform makes an inline fixed mask resolve
	 * against the panel-row box, so its inset-0 was never the viewport and
	 * the card centered mid-row, off-screen on a wide floor). Portaled, the
	 * mask IS the viewport and the card centers on the FOCUSED panel — the
	 * chip's `.column.selected` ancestor — clamped into the viewport; the
	 * viewport center is the fallback when no column ancestor exists.
	 */
	let {
		permission,
		disabled = false,
		onpick
	}: {
		/** Read state (store-derived); the chip hides when null. */
		permission: DsiPermission | null;
		/** Disabled while the panel's submit is in flight (the brief
		 *  `locked` window). A RUNNING turn never disables it — DSH
		 *  parity (2026-08-28): the pick is a host-side /permission
		 *  command, independent of the streaming turn. */
		disabled?: boolean;
		/** Submit one preset pick; resolves false on transport/reject (clears the optimistic label). */
		onpick: (preset: string) => Promise<boolean> | boolean;
	} = $props();

	let open = $state(false);
	/** Optimistic pick awaiting its poll confirmation (trigger label + lock). */
	let picking = $state<string | null>(null);
	let error = $state<string | null>(null);
	/** R7: the Full access gate — open while the confirmation is pending. */
	let confirming = $state(false);

	/** The chip trigger — the focused-panel anchor for the R7 dialog. */
	let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
	/** Card anchor measured at open: the focused panel's center, clamped
	 *  into the viewport (the viewport center when no column exists). */
	let confirmPos = $state<{ x: number; y: number } | null>(null);

	/**
	 * Measure the dialog anchor at open time: the center of the focused
	 * panel's column — the chip's `.column.selected` ancestor, any
	 * `.column` ancestor otherwise, the viewport when mounted outside a
	 * panel — clamped into the viewport so a scrolled floor never parks
	 * the card off-screen.
	 */
	function measureConfirmPos(): void {
		const column = triggerEl?.closest('.column.selected') ?? triggerEl?.closest('.column');
		const cr = column?.getBoundingClientRect();
		const cx = cr ? cr.x + cr.width / 2 : window.innerWidth / 2;
		const cy = cr ? cr.y + cr.height / 2 : window.innerHeight / 2;
		confirmPos = {
			x: Math.min(Math.max(cx, 200), Math.max(200, window.innerWidth - 200)),
			y: Math.min(Math.max(cy, 140), Math.max(140, window.innerHeight - 140))
		};
	}

	// R5: the poll's fold confirms the pick — clear the optimistic state
	// the moment the read state catches up (and drop any stale error).
	$effect(() => {
		if (picking !== null && permission?.current === picking) {
			picking = null;
			error = null;
			open = false;
			clearConfirmTimer();
		}
	});

	// Honest receipts (2026-08-25 RCA fix C): a pick whose POST succeeded
	// but whose knob events never arrive (dead poll, wrong session) must
	// not hang on "switching…" forever — after the confirm timeout the pick
	// clears with an honest not-confirmed note. A later fold that DOES
	// confirm still renders the truth (the effect above owns the state).
	// Timeout is config-tunable (chat.accessConfirmTimeoutMs, default 12s),
	// read at arm time so a landed config applies to the next pick.
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	function clearConfirmTimer(): void {
		if (confirmTimer !== undefined) {
			clearTimeout(confirmTimer);
			confirmTimer = undefined;
		}
	}

	function armConfirmTimeout(preset: string): void {
		clearConfirmTimer();
		confirmTimer = setTimeout(() => {
			if (picking === preset) {
				picking = null;
				error = t(m.accessSwitchNotConfirmed);
			}
		}, appConfig().chat.accessConfirmTimeoutMs);
	}

	// Known presets render catalog labels/descriptions (the reactive t seat);
	// unknown names keep the service's wire-sugar pass-through (BC-11: the
	// host's own string is the truth for anything not in the local table).
	const PRESET_LABELS: Record<string, () => string> = {
		'read-only': m.presetReadOnly,
		'workspace-write': m.presetWorkspaceWrite,
		[FULL_ACCESS_PRESET]: m.presetFullAccess,
		[CUSTOM_PRESET]: m.presetCustom
	};
	const PRESET_DESCRIPTIONS: Record<string, () => string> = {
		'read-only': m.presetReadOnlyDesc,
		'workspace-write': m.presetWorkspaceWriteDesc,
		[FULL_ACCESS_PRESET]: m.presetFullAccessDesc
	};
	function presetLabelOf(name: string): string {
		const getter = PRESET_LABELS[name];
		return getter ? t(getter) : presetLabel(name);
	}
	function presetDescriptionOf(name: string): string | undefined {
		const getter = PRESET_DESCRIPTIONS[name];
		return getter ? t(getter) : presetDescription(name);
	}

	/** The trigger's label: the optimistic pick, else the read state. */
	const currentLabel = $derived.by(() => {
		const value = picking ?? permission?.current;
		return value === undefined ? '' : presetLabelOf(value);
	});

	const currentDescription = $derived.by(() => {
		const value = picking ?? permission?.current;
		return value === undefined ? undefined : presetDescriptionOf(value);
	});

	/** Menu options exclude `custom` by ingest contract (never switchable). */
	const options = $derived(permission?.options ?? []);

	async function choose(preset: string): Promise<void> {
		open = false;
		if (preset === permission?.current) return; // already effective — no wire call
		if (preset === FULL_ACCESS_PRESET) {
			// R7: the risk gate opens INSTEAD of submitting; the checkbox
			// resets on every open (the gate unmounts — state never
			// survives a declined risk).
			measureConfirmPos();
			confirming = true;
			return;
		}
		await submit(preset);
	}

	async function submit(preset: string): Promise<void> {
		if (picking !== null || disabled) return;
		picking = preset;
		error = null;
		const ok = await onpick(preset);
		if (!ok) {
			// Transport/reject: the pick never landed — clear it honestly.
			// (On success the pick STAYS as the optimistic label until the
			// poll's fold confirms it; the effect above clears it.)
			if (picking === preset) {
				picking = null;
				error = t(m.accessSwitchFailed);
			}
			return;
		}
		// Success: arm the honest-confirmation timeout (the knob events
		// should arrive within one poll cadence; 12s covers the slowest).
		armConfirmTimeout(preset);
	}

	function closeMenu(): void {
		open = false;
	}

	// Dismissal contract (spec 2026-11-01): outside click or Escape closes
	// the menu only — never the pick state, the R7 gate, or the pending
	// confirmation (the gate owns its own Escape/mask exits). Escape
	// returns focus to the trigger.
	function dismissMenu(reason: 'outside' | 'escape'): void {
		if (!open) return;
		open = false;
		if (reason === 'escape') triggerEl?.focus();
	}

	function closeConfirmation(): void {
		confirming = false;
	}

	async function confirmFullAccess(): Promise<void> {
		closeConfirmation();
		await submit(FULL_ACCESS_PRESET);
	}
</script>

{#if permission !== null}
	<div class="relative" use:clickOutside={{ open, onDismiss: dismissMenu }}>
		<button
			type="button"
			bind:this={triggerEl}
			class="inline-flex items-center gap-1 rounded-md border border-[var(--color-accent-deep)] px-2 py-1 text-xs font-medium text-[var(--color-accent-deep)] hover:bg-surface-alt disabled:opacity-50"
			disabled={disabled || picking !== null}
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-label={t(() => m.accessModeCurrent({ label: currentLabel }))}
			title={currentDescription}
			data-testid="access-mode-chip"
			onclick={() => (open = !open)}
		>
			<!-- Shield glyphs (DSH design set 1556, ported verbatim): check =
			     read-only, pencil = workspace write, exclamation = full
			     access; currentColor so the trigger tints them. -->
			<span class="text-[var(--color-accent-deep)]" aria-hidden="true">
				{#if (picking ?? permission.current) === 'read-only'}
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path d="M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round" />
						<path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
					</svg>
				{:else if (picking ?? permission.current) === FULL_ACCESS_PRESET || (picking ?? permission.current) === CUSTOM_PRESET}
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path d="M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round" />
						<path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
						<path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
					</svg>
				{:else}
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor" />
						<path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
						<path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
						<path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
						<path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
					</svg>
				{/if}
			</span>
			{currentLabel}
			<span class="text-[var(--color-accent-deep)]" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
		</button>

		{#if open}
			<div
				class="absolute z-10 max-h-72 w-64 overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated p-1 shadow-lg bottom-full mb-1"
				data-testid="access-mode-menu"
				role="listbox"
				aria-label={t(m.accessMode)}
			>
				{#each options as opt (opt.value)}
					<button
						type="button"
						class="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-alt disabled:opacity-50"
						role="option"
						aria-selected={opt.value === permission.current}
						data-testid="access-mode-option"
						data-value={opt.value}
						disabled={picking !== null}
						onclick={() => void choose(opt.value)}
					>
						<span>
							<span class="font-medium text-text-primary">{presetLabelOf(opt.value)}</span>
							{#if opt.description}
								<span class="block text-[10px] text-text-muted">{presetDescriptionOf(opt.value)}</span>
							{/if}
						</span>
						{#if opt.value === permission.current}
							<span class="text-status-pass" data-testid="access-mode-current" aria-label={t(m.selected)}>✓</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if picking !== null && error === null}
		<span class="text-[10px] text-text-muted" data-testid="access-mode-pending">{t(m.accessSwitching)}</span>
	{/if}
	{#if error}
		<span class="text-[10px] text-status-fail" data-testid="access-mode-error" role="alert">{error}</span>
	{/if}

	<!-- R7 — the Full access risk gate (DSH RiskConfirmation parity):
	     acknowledgement gates Enable inside AccessModeConfirm; cancel,
	     Escape, and mask click submit nothing (the gate unmounts, so the
	     acknowledgement resets by construction). The card anchors to the
	     measured focused-panel center (confirmPos). -->
	{#if confirming}
		<AccessModeConfirm disabled={disabled} pos={confirmPos} oncancel={closeConfirmation} onconfirm={confirmFullAccess} />
	{/if}{/if}
