<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import PromptInputText from '$lib/components/composer/sibling/PromptInputText.svelte';
	import SlashMenu, { slashMenuMatches } from '$lib/components/composer/menu/SlashMenu.svelte';
	import SuggestStrip from '$lib/components/composer/menu/suggest-strip/SuggestStrip.svelte';
	import { ArrowUp, X } from '@lucide/svelte';
	import {
		acceptSyncSlashExecute,
		acceptSyncSlashInsert,
		acceptSyncStrip,
		cancelSync,
		cycleSyncSlash,
		cycleSyncStrip,
		dismissSyncSlash,
		dismissSyncStrip,
		pushSharedText,
		readSharedText,
		submitAll,
		syncCheckedCount,
		syncSlashState,
		syncStripState
	} from '$lib/services/chat/prompt-sync.svelte';

	/**
	 * SidebarPromptSync — the sidebar footer's broadcast box (ADR "The
	 * Prompt Sync", 2026-09-04): one draft carried to every checked panel
	 * composer. Component-level visibility (D7 — the SuggestStrip rule):
	 * renders nothing while no panel is checked, so SidebarFooter stays a
	 * pure shell that just mounts this above NewChatButton.
	 *
	 * The textarea IS the store's shared text — a getter/setter bind makes
	 * this box the one writer (D3) and every store clear (submit, cancel,
	 * uncheck-all) lands in the box with no local copy to drift.
	 *
	 * Submit runs submitAll (D5): each checked panel's OWN ladder judges
	 * the draft, in check order; a pass where every panel refused (empty,
	 * streaming, locked) earns the inline note — never a silent success.
	 * Cancel restores every panel's pristine snapshot (D4). The box owns
	 * NO surface of its own — shapes are judged by each panel's ladder,
	 * not twice. The borrowed pieces are the broadcast VIEWS (amended
	 * 2026-09-04): the panels' live strip rows AND their live slash menu
	 * render over this box; arrows cycle every highlight, Tab accepts,
	 * Esc dismisses. The accept splits by kind: a strip find pick or a
	 * slash INSERT pick (gesture / hinted command / skill) writes the
	 * seeded draft through the mirror — press 2 is the operator's own
	 * Enter; a strip run pick or a slash EXECUTE pick (hint-less command)
	 * replays per panel and ENDS the broadcast. Enter accepts a live
	 * run-mode strip view or slash view; a find-mode or plain draft's
	 * Enter is always the broadcast send.
	 */

	/** Row cap for the box — a broadcast is a prompt, not an editor. */
	const MAX_ROWS = 3;

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let isOverflow = $state(false);
	/** In-flight submitAll — locks the box (the panel `awaiting` grammar). */
	let syncing = $state(false);
	/** The honest receipt when the pass dispatched nothing. */
	let note = $state<string | null>(null);
	let isComposing = $state(false);

	const visible = $derived(syncCheckedCount() > 0);
	const count = $derived(syncCheckedCount());
	const canSubmit = $derived(readSharedText().trim().length > 0 && !syncing);
	/** The broadcast strip view (amended 2026-09-04): the first live
	 *  member's rows/index/query/mode, rendered over this box — null while
	 *  no member's strip shows rows. */
	const stripView = $derived(syncStripState());
	/** The broadcast slash view (amended 2026-09-04 — the third surface):
	 *  the first live member's menu, rendered over this box — null while
	 *  no member's menu is open. */
	const slashView = $derived(syncSlashState());

	/** The view's MATCHED composite — gestures, commands, then skills
	 *  (the menu's own order, the SAME exported matcher), kind-tagged so
	 *  a clicked or highlighted row resolves into the replay intent.
	 *  Empty while the catalog loads: status rows never match and never
	 *  intercept (the menu's own rule). */
	type BoxSlashRow =
		| { kind: 'gesture'; seed: string }
		| { kind: 'command-execute'; name: string }
		| { kind: 'command-hint'; name: string }
		| { kind: 'skill'; name: string };
	const slashRows = $derived.by(() => {
		const view = slashView;
		if (view === null || view.state !== 'ready') return [] as BoxSlashRow[];
		const rows: BoxSlashRow[] = [];
		for (const row of view.gestures)
			if (slashMenuMatches(row, view.query)) rows.push({ kind: 'gesture', seed: row.seed });
		for (const row of view.commands)
			if (slashMenuMatches(row, view.query))
				rows.push(
					row.input?.hint !== undefined
						? { kind: 'command-hint', name: row.name }
						: { kind: 'command-execute', name: row.name }
				);
		for (const row of view.skills)
			if (slashMenuMatches(row, view.query)) rows.push({ kind: 'skill', name: row.name });
		return rows;
	});

	// The bind's two hands: the getter reads the store (reactive), the
	// setter writes it — this box is the ONE writer of the shared text.
	function getSharedText(): string {
		return readSharedText();
	}
	function setSharedText(text: string): void {
		pushSharedText(text);
	}

	// Auto-grow clamp — the Composer measure, verbatim, at the box's
	// own row cap (the px() guard: unresolved styles yield NaN, and both
	// browsers and happy-dom reject "NaNpx" without error).
	$effect(() => {
		void readSharedText(); // re-measure per keystroke (writes ride the bind)
		if (!textareaEl) return;
		const px = (v: string, fallback: number): number => {
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : fallback;
		};
		const style = getComputedStyle(textareaEl);
		// Fallbacks match the classes: text-sm × leading-relaxed, py-2.
		const lineHeight = px(style.lineHeight, 22.75);
		const maxHeight = Math.round(
			MAX_ROWS * lineHeight + px(style.paddingTop, 8) + px(style.paddingBottom, 8)
		);
		textareaEl.style.height = 'auto';
		const fits = Math.min(textareaEl.scrollHeight, maxHeight);
		textareaEl.style.height = `${fits}px`;
		isOverflow = textareaEl.scrollHeight > maxHeight;
	});

	// A stale note must not outlive its broadcast: the set emptying (the
	// box hiding) clears whatever the last pass reported.
	$effect(() => {
		if (!visible) note = null;
	});

	async function run(): Promise<void> {
		if (syncing || readSharedText().trim().length === 0) return;
		syncing = true;
		note = null;
		try {
			const result = await submitAll();
			if (result.dispatched === 0) {
				note = 'Nothing sent — every panel declined (empty, streaming, locked, or a ! macro line)';
			}
		} finally {
			syncing = false;
		}
	}

	function cancel(): void {
		cancelSync();
		note = null;
	}

	function handleInput(): void {
		note = null;
	}

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		// IME composes pass through (the composer's BC-8 guard) — Enter
		// during composition is a keystroke of text, never a broadcast.
		if (isComposing) return;
		// The broadcast strip (amended 2026-09-04): while the checked
		// panels' strips show rows, this box renders their view above the
		// textarea and speaks the navigation grammar — arrows cycle every
		// highlight (this strip's own follows the borrowed view), Tab
		// accepts, Esc dismisses. Enter accepts a live RUN-mode view (the
		// replay above); a find-mode or plain draft's Enter falls through
		// to the broadcast send, whose ladders now honestly refuse a
		// `!`-macro line instead of shipping it to the models.
		const strip = syncStripState();
		if (strip !== null) {
			if (event.key === 'ArrowDown' && strip.rows.length > 1) {
				event.preventDefault();
				cycleSyncStrip(1);
				return;
			}
			if (event.key === 'ArrowUp' && strip.rows.length > 1) {
				event.preventDefault();
				cycleSyncStrip(-1);
				return;
			}
			if (event.key === 'Tab') {
				event.preventDefault();
				if (event.shiftKey) {
					if (strip.rows.length > 1) cycleSyncStrip(-1);
					return;
				}
				acceptAt(strip.index);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				dismissSyncStrip();
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey && strip.mode === 'run') {
				// The run-mode Enter (amended 2026-09-04, the owner's live-use
				// override): the highlighted macro executes in every checked
				// panel and the broadcast ends — broadcasting the raw line
				// would ship `!query` to the models (the ladders refuse it,
				// but refusing is not running). Find-mode Enter keeps the
				// broadcast send below.
				event.preventDefault();
				acceptAt(strip.index);
				return;
			}
		}
		// The broadcast slash view (amended 2026-09-04 — the third
		// surface): while the checked panels' menus are open, this box
		// speaks the menu grammar — arrows cycle every highlight, Tab
		// accepts, Shift+Tab cycles back, Esc dismisses, and Enter
		// accepts too: a live `/`-draft never broadcasts (shipping the
		// literal line to the models is the verified defect this view
		// exists to kill). A row-less view (loading, no match) keeps the
		// plain grammar — the ladders judge what ships.
		const slash = slashView;
		if (slash !== null && slashRows.length > 0) {
			if (event.key === 'ArrowDown' && slashRows.length > 1) {
				event.preventDefault();
				cycleSyncSlash(1);
				return;
			}
			if (event.key === 'ArrowUp' && slashRows.length > 1) {
				event.preventDefault();
				cycleSyncSlash(-1);
				return;
			}
			if (event.key === 'Tab') {
				event.preventDefault();
				if (event.shiftKey) {
					if (slashRows.length > 1) cycleSyncSlash(-1);
					return;
				}
				acceptSlashAt(slash.index);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				dismissSyncSlash();
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				acceptSlashAt(slash.index);
				return;
			}
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			await run();
		}
	}

	/** The box's strip accept (amended 2026-09-04): a find-mode pick
	 *  WRITES THROUGH the mirror — the row text becomes the shared draft,
	 *  so the box and every panel hold the same accepted prompt (the
	 *  journey stays in-sync, and the pick survives as panel drafts the
	 *  ladders will send). A run-mode pick replays per panel: the macro
	 *  must fire in each member's own executor (D5). */
	function acceptAt(i: number): void {
		const view = syncStripState();
		if (view === null) return;
		const row = view.rows[i];
		if (row === undefined) return;
		if (view.mode === 'run') {
			acceptSyncStrip(view.mode);
			return;
		}
		pushSharedText(row.text);
	}

	/** The box's slash accept (amended 2026-09-04 — the third surface).
	 *  INSERT kinds (gesture seed, hinted command, skill) write the
	 *  seeded draft through the mirror and keep the broadcast alive —
	 *  press 2 is the operator's own Enter, same as the strip's
	 *  write-through. The EXECUTE kind (hint-less command) runs each
	 *  member's OWN draft line host-side and ends the broadcast — the
	 *  run-accept's rule: the run consumed the intent. */
	function acceptSlashAt(i: number): void {
		const row = slashRows[i];
		if (row === undefined) return;
		if (row.kind === 'command-execute') {
			acceptSyncSlashExecute(row.name);
			return;
		}
		const text = row.kind === 'gesture' ? row.seed : `/${row.name} `;
		acceptSyncSlashInsert(text); // every member seeds + memo-closes (no focus steal)
		pushSharedText(text); // the box's one write: box + claims land the same draft
	}

	/** The box-menu click → composite index (the menu's pick callbacks
	 *  name the row; the replay needs its index in the matched set). */
	function slashIndexOf(kind: BoxSlashRow['kind'], key: string): number {
		return slashRows.findIndex((row) => {
			if (row.kind !== kind) return false;
			return row.kind === 'gesture' ? row.seed === key : row.name === key;
		});
	}
</script>

{#if visible}
	<!-- The broadcast gradient (2026-09-04): the box wears the same
	     yellowgreen→oldlace→cream wash as the checked panels' footers —
	     one pastel face for the whole broadcast surface. -->
	<div
		class="rounded-md border border-surface-border bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-status-pass)_18%,var(--color-surface)),var(--color-header-wash)_65%,var(--color-surface))] p-1.5"
		data-testid="sidebar-prompt-sync"
	>
		<p
			class="mb-1 px-0.5 text-[0.6875rem] font-medium uppercase tracking-wide text-text-secondary"
			data-testid="prompt-sync-count"
		>
			{t(m.broadcast)} {count} panel{count === 1 ? '' : 's'}
		</p>
		<div class="flex items-end gap-1.5">
			<div class="relative min-w-0 flex-1">
				{#if stripView !== null}
					<!-- The broadcast strip view (amended 2026-09-04): the same
					     rows the checked panels' strips show, floating over this
					     box — pick-only (no ⋯/⚙), and the write-through accept
					     keeps the box and the panels on the same draft. -->
					<SuggestStrip
						rows={stripView.rows}
						activeIndex={stripView.index}
						query={stripView.query}
						mode={stripView.mode}
						onpick={(i) => acceptAt(i)}
						onrefocus={() => textareaEl?.focus()}
					/>
				{/if}
				{#if slashView !== null}
					<!-- The broadcast slash view (amended 2026-09-04 — the third
					     surface): the first live member's menu over this box — the
					     same rows, the same highlight; picks replay per panel
					     (insert writes through, execute runs host-side). -->
					<SlashMenu
						gestures={slashView.gestures}
						commands={slashView.commands}
						skills={slashView.skills}
						state={slashView.state}
						query={slashView.query}
						activeIndex={slashView.index}
						onpickgesture={(seed) => acceptSlashAt(slashIndexOf('gesture', seed))}
						onpickcommand={(name) => acceptSlashAt(slashIndexOf('command-execute', name))}
						onpickcommandwithhint={(name) => acceptSlashAt(slashIndexOf('command-hint', name))}
						onpickskill={(name) => acceptSlashAt(slashIndexOf('skill', name))}
					/>
				{/if}
				<PromptInputText
					bind:el={textareaEl}
					bind:value={getSharedText, setSharedText}
					maxRows={MAX_ROWS}
					isStreaming={false}
					locked={syncing}
					awaiting={false}
					{isOverflow}
					placeholder={t(() => m.broadcastSyncedTo({ count })) + (count === 1 ? '' : 's')}
					onkeydown={onkeydown}
					onpaste={() => {}}
					oninput={handleInput}
					onfocus={() => {}}
					onblur={() => {}}
					oncompositionstart={() => (isComposing = true)}
					oncompositionend={() => (isComposing = false)}
				/>
			</div>
			<div class="flex shrink-0 flex-col items-center gap-1">
				<button
					type="button"
					data-testid="prompt-sync-cancel"
					title={t(m.discardBroadcastTitle)}
					aria-label={t(m.discardBroadcast)}
					class="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text-secondary"
					onclick={cancel}
				>
					<X size={14} />
				</button>
				<button
					type="button"
					data-testid="prompt-sync-submit"
					title={t(m.sendCheckedPanels)}
					aria-label={t(m.sendCheckedPanels)}
					class="prompt-sync-submit flex h-7 w-7 items-center justify-center rounded-md bg-accent-blue text-accent-blue-ink transition-colors hover:bg-accent-blue disabled:cursor-not-allowed disabled:opacity-30"
					disabled={!canSubmit}
					onclick={() => void run()}
				>
					<ArrowUp size={14} />
				</button>
			</div>
		</div>
		{#if note !== null}
			<p class="mt-1 px-0.5 text-xs text-status-pending" role="alert" data-testid="prompt-sync-note">
				{note}
			</p>
		{/if}
	</div>
{/if}

<style>
	/* Control-owned icon color (the Composer app.css exception): the
	   submit surface is saturated blue with a white glyph — the global
	   purple icon default must not paint the icon into its own surface. */
	button :global(svg) {
		color: inherit;
	}
</style>
