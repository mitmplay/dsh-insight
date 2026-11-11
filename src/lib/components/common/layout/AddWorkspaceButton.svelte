<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * AddWorkspaceButton — the sidebar header's workspace adoption control
	 * (2026-08-23, DSH parity: DSH's own Web UI ships an aria-label="Add
	 * workspace" button over host workspace.create).
	 *
	 * 2026-08-24: a real folder picker, not a path form — adaptive over the
	 * host's composed directory-picker capability, exactly like DSH's own
	 * client (which composes one flow per backend and never branches):
	 *
	 *   browse  → the panel browses the host filesystem one level at a
	 *             time over GET /api/dsh/directory (host.listDirectory —
	 *             the same wire DSH's directory browser drives): crumbs
	 *             jump, rows descend, the listed level is the target.
	 *   native  → the host serves the OS chooser (the auto backend on a
	 *             local darwin/win32 host). host.listDirectory refuses
	 *             directory-picker/unavailable with details
	 *             {capability:'native'}; the flow then drives POST
	 *             /api/dsh/pick-directory (host.pickDirectory) and the
	 *             host opens the system dialog — Cancel here aborts the
	 *             RPC, which closes the host's dialog mid-choice.
	 *
	 * Confirm runs the whole payoff in one click — adopt the folder into
	 * the workspace registry (POST /api/dsh/workspaces), then open a fresh
	 * session there (POST /api/dsh/sessions {cwd}) with NO preset step:
	 * the host default agent runs the chat.
	 *
	 * The panel is position:fixed anchored under the button — the rail's
	 * overflow:hidden cannot clip it. Outside click and Escape close it
	 * (unless busy: an in-flight adopt+create must not be dismissed).
	 */
	import { ChevronRight, Folder, FolderPlus, Home } from '@lucide/svelte';
	import type { DsiDirectoryListing } from '$lib/types';

	let {
		/** Fresh session created in the adopted workspace — parent navigates. */
		oncreated,
		/** Selected agent preset (SidebarSessionFilter pill) — rides the create
		 *  so the fresh session runs THAT agent (2026-09-15 bug: the create
		 *  always landed on the host default). Null falls back to the host
		 *  default, as before. */
		agent = null
	}: {
		oncreated: (sessionId: string, agentPreset: string | null, path: string) => void;
		agent?: string | null;
	} = $props();

	type Step = 'idle' | 'browse' | 'native' | 'done';

	let step = $state<Step>('idle');
	let listing = $state<DsiDirectoryListing | null>(null);
	let loading = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let showHidden = $state(false);
	/** Supersession guard: only the newest listing request may land. */
	let requestSeq = 0;
	/** Native pick in flight — aborting closes the host's OS dialog. */
	let pickController: AbortController | undefined;

	/** Button element — the panel anchors under it. */
	let btnEl: HTMLElement | undefined = $state(undefined);
	/** Fixed-panel coordinates, captured when the panel opens. */
	let panelX = $state(0);
	let panelY = $state(0);

	const PANEL_WIDTH = 380;

	/** Display crumbs: inside the home subtree the chain roots at a Home
	 *  crumb; outside it the full ancestry shows (DSH displayCrumbs rule). */
	const crumbs = $derived.by(() => {
		const l = listing;
		if (!l) return [];
		const homeIndex = l.crumbs.findIndex((c) => c.path === l.home);
		if (homeIndex === -1) return l.crumbs;
		return [{ name: 'Home', path: l.home, hidden: false }, ...l.crumbs.slice(homeIndex + 1)];
	});

	const visibleEntries = $derived(
		(listing?.entries ?? []).filter((e) => showHidden || !e.hidden)
	);

	function open(): void {
		if (step !== 'idle') return; // one flow at a time
		errorMessage = null;
		showHidden = false;
		const rect = btnEl?.getBoundingClientRect();
		panelX = rect ? rect.left : 0;
		panelY = rect ? rect.bottom + 6 : 0;
		step = 'browse';
		void load(undefined);
	}

	function close(): void {
		if (busy) return; // in-flight adopt+create pins the flow
		requestSeq += 1; // a late listing must not repopulate a closed panel
		pickController?.abort(); // a dismissed native pick closes the host's dialog
		pickController = undefined;
		step = 'idle';
		listing = null;
		loading = false;
		errorMessage = null;
	}

	function onWindowClick(e: MouseEvent): void {
		if (step === 'idle') return;
		// A visible failure pins the panel too (2026-09-11 bug: an adopt error
		// lived only inside the panel, so one outside click erased the only
		// signal — the flow read as silently doing nothing). Cancel still works.
		if (busy || errorMessage !== null) return;
		const panel = document.querySelector('[data-testid="add-workspace-panel"]');
		if (panel?.contains(e.target as Node)) return;
		if (btnEl?.contains(e.target as Node)) return;
		close();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && step !== 'idle') close();
	}

	/** Fetch one level; only the newest request may land (supersede rule).
	 *  A native host refuses the browse method — that refusal is not an
	 *  error to show but the signal to switch to the OS-dialog flow. */
	async function load(path: string | undefined): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		errorMessage = null;
		try {
			const res = await fetch(`/api/dsh/directory${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`);
			const body = (await res.json()) as {
				ok: boolean;
				listing?: DsiDirectoryListing;
				error?: { code: string; message: string; details?: { capability?: unknown } };
			};
			if (seq !== requestSeq) return; // superseded
			if (!res.ok || !body.ok || !body.listing) {
				const err = body.error;
				// 0.1.2-alpha.2+ wire vocabulary: <domain>/<reason> codes — the
				// dash form 'directory-picker-unavailable' is a pre-rename
				// spelling no current host answers.
				if (err?.code === 'directory-picker/unavailable' && err.details?.capability === 'native') {
					startNativePick();
					return;
				}
				errorMessage = err?.message ?? `listing failed (${res.status})`;
				return;
			}
			listing = body.listing;
		} catch (err) {
			if (seq !== requestSeq) return;
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	/** Native flow: the HOST opens the OS chooser (host.pickDirectory) and
	 *  resolves the path — null is a quiet cancel, a path runs the whole
	 *  adopt+create payoff against it. DSH parity: the dialog IS the
	 *  picker; DSI renders only the wait + cancel. */
	async function startNativePick(): Promise<void> {
		step = 'native';
		loading = false;
		errorMessage = null;
		pickController = new AbortController();
		const controller = pickController;
		try {
			const res = await fetch('/api/dsh/pick-directory', {
				method: 'POST',
				signal: controller.signal
			});
			const body = (await res.json()) as {
				ok: boolean;
				path?: string | null;
				error?: { code: string; message: string };
			};
			if (controller.signal.aborted) return; // dismissed — the panel is gone
			if (!res.ok || !body.ok) {
				errorMessage = body.error?.message ?? `pick failed (${res.status})`;
				return; // stay open — the operator can cancel
			}
			if (body.path === null || body.path === undefined) {
				close(); // operator cancelled the OS dialog
				return;
			}
			await adoptAndCreate(body.path);
		} catch (err) {
			if (controller.signal.aborted) return; // our own cancel, not a failure
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			if (!controller.signal.aborted) pickController = undefined;
		}
	}

	/** The payoff — adopt the folder into the workspace registry, then open
	 *  a session in it with the host default agent (no preset step).
	 *  Adoption stands even if the create fails; the error shows and the
	 *  folder stays adopted. */
	async function adoptAndCreate(target: string): Promise<void> {
		if (busy) return;
		busy = true;
		errorMessage = null;
		try {
			const adoptRes = await fetch('/api/dsh/workspaces', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: target })
			});
			const adoptBody = (await adoptRes.json()) as { ok: boolean; error?: { code: string; message: string } };
			if (!adoptRes.ok || !adoptBody.ok) {
				errorMessage = adoptBody.error?.message ?? `adopt failed (${adoptRes.status})`;
				return; // stay on the picker — retry or cancel
			}
			// Immediate pill: nudge the sidebar's registry load instead of
			// waiting for its cadence tick (2026-09-11 bug: the new workspace's
			// pill lagged the adoption by up to one refreshMs cycle).
			window.dispatchEvent(new Event('dsi:workspaces-changed'));
			// NewChatButton parity: the armed agent pill rides the create —
			// an unselected pill still lands on the host default agent.
			const createRes = await fetch('/api/dsh/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(agent ? { cwd: target, agentPreset: agent } : { cwd: target })
			});
			const createBody = (await createRes.json()) as {
				ok: boolean;
				sessionId?: string;
				agentPreset?: string | null;
				error?: { code: string; message: string };
			};
			if (!createRes.ok || !createBody.ok || !createBody.sessionId) {
				errorMessage = createBody.error?.message ?? `create failed (${createRes.status})`;
				return;
			}
			// Full success dismisses the panel — a lingering dialog with a
			// disabled confirm over the fresh session read as a stuck flow
			// (2026-09-15 bug: the 'done' step kept the panel rendered after a
			// native pick, where listing is null so confirm could never enable).
			requestSeq += 1;
			step = 'idle';
			listing = null;
			try {
				oncreated(createBody.sessionId, createBody.agentPreset ?? null, target);
			} catch (err) {
				// The adopt+create SUCCEEDED — a broken navigation callback must not
				// swallow the outcome into silence (2026-09-11 bug). Reopen the panel
				// ('done' renders no picker rows, only the error + Cancel) so the
				// failure is visible and the panel stays dismissible.
				step = 'done';
				errorMessage = err instanceof Error ? err.message : String(err);
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<button
	type="button"
	class="icon-btn"
	bind:this={btnEl}
	onclick={open}
	aria-label={t(m.addWorkspace)}
	title={t(m.addWorkspace)}
	data-testid="add-workspace-button"
>
	<FolderPlus size={14} />
</button>

{#if step !== 'idle'}
	<div
		class="panel"
		data-testid="add-workspace-panel"
		style="left: {panelX}px; top: {panelY}px; width: {PANEL_WIDTH}px"
		role="dialog"
		aria-label={t(m.addWorkspace)}
	>
		<div class="panel-head">
			<span class="panel-title">{t(m.addWorkspace)}</span>
			{#if step === 'browse'}
				<button
					type="button"
					class="hidden-toggle"
					aria-pressed={showHidden}
					onclick={() => (showHidden = !showHidden)}
					disabled={busy}
					data-testid="add-workspace-hidden-toggle"
				>
					hidden
				</button>
			{/if}
		</div>

		{#if step === 'native'}
			<p class="hint" data-testid="add-workspace-native">
				{t(m.chooseFolder)}
			</p>
		{:else if listing}
			<nav class="crumbs" aria-label={t(m.dirBreadcrumbs)}>
				{#each crumbs as crumb, i (crumb.path)}
					{#if i > 0}<span class="crumb-sep"><ChevronRight size={11} /></span>{/if}
					<button
						type="button"
						class="crumb"
						class:current={i === crumbs.length - 1}
						onclick={() => void load(crumb.path)}
						disabled={busy}
						data-testid="add-workspace-crumb"
						data-path={crumb.path}
					>
						{#if i === 0 && crumb.name === 'Home'}<Home size={11} />{:else}{crumb.name}{/if}
					</button>
				{/each}
			</nav>
		{:else if loading}
			<p class="hint" data-testid="add-workspace-loading">{t(m.loading)}</p>
		{/if}

		{#if step !== 'native' && listing}
			<div class="rows" data-testid="add-workspace-listing">
				{#if visibleEntries.length === 0}
					<p class="hint" data-testid="add-workspace-empty">{t(m.noSubdirectories)}</p>
				{:else}
					{#each visibleEntries as entry (entry.path)}
						<button
							type="button"
							class="row"
							class:hidden={entry.hidden}
							onclick={() => void load(entry.path)}
							disabled={busy}
							data-testid="add-workspace-entry"
							data-name={entry.name}
						>
								<Folder size={13} />
							<span class="row-name">{entry.name}</span>
							<span class="row-chev"><ChevronRight size={12} /></span>
						</button>
					{/each}
				{/if}
			</div>
			{#if listing.truncated}
				<p class="hint" data-testid="add-workspace-truncated">{t(m.listingTruncated)}</p>
			{/if}
		{/if}

		{#if errorMessage}
			<p class="error" data-testid="add-workspace-error" role="alert">{errorMessage}</p>
		{/if}

		<div class="panel-actions">
			<button type="button" class="btn ghost" onclick={close} disabled={busy}>{t(m.cancel)}</button>
			{#if step === 'native'}
				<button
					type="button"
					class="btn solid"
					onclick={() => void startNativePick()}
					disabled={busy}
					data-testid="add-workspace-native-retry"
				>
					{t(m.openDialogAgain)}
				</button>
			{:else}
				<button
					type="button"
					class="btn solid"
					onclick={() => {
						if (listing) void adoptAndCreate(listing.path);
					}}
					disabled={busy || loading || !listing}
					data-testid="add-workspace-confirm"
				>
					{busy ? t(m.adding) : t(m.addWorkspaceStart)}
				</button>
			{/if}
		</div>
		{#if step !== 'native' && listing}
			<p class="target mono" data-testid="add-workspace-target">{listing.path}</p>
		{/if}
	</div>
{/if}

<style>
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 0.25rem;
		color: var(--color-text-secondary, #6c757d);
		background: transparent;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.icon-btn:hover,
	.icon-btn:focus-visible {
		color: var(--color-accent-blue, #3b82f6);
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
		outline: none;
	}

	/* Fixed panel — escapes the rail's overflow:hidden. */
	.panel {
		position: fixed;
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
		background: var(--color-surface-elevated, var(--color-surface-elevated));
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-primary, #212529);
	}

	.hidden-toggle {
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 999px;
		padding: 0.0625rem 0.5rem;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		background: transparent;
		cursor: pointer;
	}

	.hidden-toggle[aria-pressed='true'] {
		color: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		overflow-x: auto;
		white-space: nowrap;
		padding-bottom: 0.125rem;
	}

	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 0.1875rem;
		border: none;
		background: transparent;
		padding: 0.0625rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-accent-blue, #3b82f6);
		cursor: pointer;
	}

	.crumb:hover {
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
	}

	.crumb.current {
		color: var(--color-text-primary, #212529);
		font-weight: 600;
		cursor: default;
	}

	.crumb-sep {
		color: var(--color-text-secondary, #6c757d);
		flex-shrink: 0;
	}

	.rows {
		display: flex;
		flex-direction: column;
		max-height: 240px;
		overflow-y: auto;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		padding: 0.25rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		border: none;
		background: transparent;
		padding: 0.3125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		text-align: left;
		cursor: pointer;
	}

	.row:hover,
	.row:focus-visible {
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
		outline: none;
	}

	.row.hidden {
		opacity: 0.55;
	}

	.row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-chev {
		color: var(--color-text-secondary, #6c757d);
		flex-shrink: 0;
	}

	.hint {
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}

	.panel-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
	}

	.btn {
		border-radius: 0.375rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.btn.ghost {
		border: 1px solid var(--color-surface-border, #dee2e6);
		background: transparent;
		color: var(--color-text-secondary, #6c757d);
	}

	.btn.ghost:hover {
		color: var(--color-text-primary, #212529);
	}

	.btn.solid {
		border: 1px solid var(--color-accent-blue, #3b82f6);
		background: var(--color-accent-blue, #3b82f6);
		color: #fff;
		font-weight: 500;
	}

	.btn.solid:disabled,
	.btn.ghost:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.target {
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		overflow-wrap: anywhere;
		margin: 0;
	}

	.mono {
		font-family: ui-monospace, monospace;
		font-weight: 400;
	}

	.error {
		font-size: 0.6875rem;
		color: var(--color-status-fail, var(--color-status-fail));
		overflow-wrap: anywhere;
	}
</style>
