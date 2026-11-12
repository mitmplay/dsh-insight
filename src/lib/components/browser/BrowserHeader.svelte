<!--
	BrowserHeader — the status strip + proxy controls of BrowserPanel
	(The Glass Browser spec Wave 2, task 2.1; ADR-0029; extended by
	ADR-0031 D1/D2, amended 2 — the header SPEAKS: standard address-bar
	order (back, forward, reload, then the search-style URL input that
	clears on the panel's answer, never on Enter); no title label. The
	panel ACTS: no POST lives here. data-status / data-rebound stay the
	e2e seams).

	Long-press history dropdown (operator-approved 2026-10-28): press
	and HOLD ~350ms on back/forward opens that direction's history
	menu; a quick release keeps the plain single-step verb. The header
	only READS history (GET) and REPORTS the picked index upward — the
	panel performs the travel POST (the ACTS split holds).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ReloadButton from '$lib/components/common/buttons/ReloadButton.svelte';
	import BrowserClosed from './buttons/BrowserClosed.svelte';
	import BackButton from './buttons/BackButton.svelte';
	import ForwardButton from './buttons/ForwardButton.svelte';
	import UrlCopy from './buttons/UrlCopy.svelte';
	import UrlInput from './buttons/UrlInput.svelte';
	import BrowserHistory from './buttons/BrowserHistory.svelte';

	let {
		/** Panel session state — drives the dot color and testid data. */
		status,
		/** True when mount re-bound to a surviving session (ADR-0030 D1). */
		reBound = false,
		/** Registry id; null = session not opened yet (no id shown). */
		sessionId = null,
		/** Double-invocation guard mirrored from the panel while closing. */
		closing = false,
		/** A proxy verb is in flight (panel-owned) — buttons go quiet. */
		busy = false,
		/** History bounds from the panel's last navigate answer (ADR-0031
		 *  give-up: only as fresh as the last answer). */
		canBack = false,
		canForward = false,
		/** Owner-release click (D8): the panel performs the actual close. */
		onclose,
		/** Proxy intents (ADR-0031 D1): reported upward, never performed. */
		onnavigate,
		onreload,
		onhistory,
		/** Long-press dropdown (2026-10-28): the FOCUSED tab's targetId the
		 *  history GET addresses, and the picked-entry reporter — the panel
		 *  performs the travel POST. */
		focusTargetId = null,
		onhistoryto,
		/** glass-tab-ids Task 4: the panel computes the omnibox placeholder —
		 *  the ACTIVE tab's URL (64-char truncated) or the localized fallback. */
		placeholder = undefined,
		/** Focus polish 2026-10-28: the FOCUSED tab's real URL, or null when
		 *  the panel's isNoUrl guard fired (empty / about:blank) — null
		 *  DISABLES the prefix copy-URL icon. */
		copyUrl = null,
		/** ADR-0061 D5: the Paste button's dispatch — the panel reads the
		 *  host clipboard and posts the chunked kind:'text' path; the
		 *  outcome comes back for the honest button state. */
		onpaste = undefined,
	}: {
		status: 'opening' | 'connecting' | 'live' | 'failed' | 'closed';
		reBound?: boolean;
		sessionId?: string | null | undefined;
		closing?: boolean;
		busy?: boolean;
		canBack?: boolean;
		canForward?: boolean;
		onclose?: () => void;
		onnavigate?: (text: string) => void;
		onreload?: () => void;
		onhistory?: (dir: 'back' | 'forward') => void;
		focusTargetId?: string | null;
		onhistoryto?: (index: number) => void;
		placeholder?: string | undefined;
		copyUrl?: string | null;
		onpaste?: () => Promise<'pasted' | 'empty' | 'denied'>;
	} = $props();

	/** Copy feedback: the icon swaps to a check for ~1.5s — no toast. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	/** navigator.clipboard first; the execCommand fallback covers panel
	 *  pages where the async clipboard lacks permission. */
	function legacyCopy(text: string): void {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand('copy');
		} catch {
			/* nothing honest to show — the icon just never flips */
		}
		ta.remove();
	}
	async function copyFocusedUrl(): Promise<void> {
		if (!copyUrl) return;
		try {
			await navigator.clipboard.writeText(copyUrl);
		} catch {
			legacyCopy(copyUrl);
		}
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
	}

	/** ADR-0061 D5: honest paste state on the button — 'denied'/'empty'
	 *  are no-op truths, never a fake success. Resets like the copied chip. */
	let pasteState = $state<'' | 'pasted' | 'empty' | 'denied'>('');
	let pasteTimer: ReturnType<typeof setTimeout> | null = null;
	async function pasteFromHost(): Promise<void> {
		if (!onpaste) return;
		pasteState = await onpaste();
		if (pasteTimer) clearTimeout(pasteTimer);
		pasteTimer = setTimeout(() => (pasteState = ''), 1500);
	}
	function pasteLabel(): string {
		if (pasteState === 'denied') return m.browserPasteDenied();
		if (pasteState === 'empty') return m.browserPasteEmpty();
		return m.browserPaste();
	}

	/** Ephemeral intent, never state (D2): the panel clears it on the
	 *  route ANSWER via clearInput() — success or refusal both answer. */
	let urlText = $state('');

	/** The panel's handle: clears the box when the navigate route answers. */
	export function clearInput(): void {
		urlText = '';
	}

	/** glass-tab-ids Task 4: query-active echoes the active tab's address
	 *  ("tab:N <url>") into the box — readable and re-editable. */
	export function setOmniboxValue(v: string): void {
		urlText = v;
	}

	function submit(): void {
		const t = urlText.trim();
		if (!t) return; // empty Enter is a no-op
		onnavigate?.(t);
	}

	/** ---- Long-press history dropdown (operator-approved 2026-10-28) ----
	 *  Hold ≥350ms on back/forward opens that direction's menu; release
	 *  BEFORE the threshold is the plain verb. If the menu opened, the
	 *  trailing click is SUPPRESSED — it must never double-fire a
	 *  single-step travel on top of the dropdown. The menu stays open
	 *  (the simpler approved variant) and closes on item click / outside
	 *  press / Esc. */
	const HOLD_MS = 350;
	const MENU_MAX = 10;
	type HistEntry = { index: number; url: string; title: string };
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let suppressNextClick = false;
	/** Set SYNCHRONOUSLY in the hold timer's callback, BEFORE the async
	 *  fetch — the release race: a mouseup at ~350ms lands while the
	 *  history fetch is still in flight (menuDir still null), and without
	 *  this flag endHold would let the plain click fire on top of the
	 *  about-to-open dropdown. Pending-open suppresses like opened. */
	let menuPending = false;
	let menuDir: 'back' | 'forward' | null = $state(null);
	let menuEntries: HistEntry[] = $state([]);
	let menuAnchor: HTMLSpanElement | null = $state(null);

	async function openMenu(dir: 'back' | 'forward'): Promise<void> {
		if (!sessionId) {
			menuPending = false;
			return;
		}
		try {
			const q = focusTargetId ? '?targetId=' + encodeURIComponent(focusTargetId) : '';
			const res = await fetch('/api/browser/' + sessionId + '/history' + q);
			if (!res.ok) {
				menuPending = false; // refused — no dropdown, plain click semantics
				return;
			}
			const d = (await res.json()) as { currentIndex: number; entries: HistEntry[] };
			const cur = d.currentIndex;
			// back = nearest first; forward = chronological — 10 each, max
			const picked =
				dir === 'back'
					? d.entries.filter((e) => e.index < cur).slice(-MENU_MAX).reverse()
					: d.entries.filter((e) => e.index > cur).slice(0, MENU_MAX);
			if (picked.length === 0) {
				menuPending = false; // empty direction — no dropdown
				return;
			}
			menuEntries = picked;
			menuDir = dir;
		} catch {
			menuPending = false; // transient — no dropdown, the plain verb stays available
		}
	}

	function startHold(dir: 'back' | 'forward'): void {
		suppressNextClick = false;
		menuPending = false;
		holdTimer = setTimeout(() => {
			holdTimer = null;
			menuPending = true; // SYNCHRONOUS — beats the fetch, closes the race
			void openMenu(dir);
		}, HOLD_MS);
	}

	function endHold(): void {
		if (holdTimer) {
			clearTimeout(holdTimer); // released before 350ms — plain click fires
			holdTimer = null;
		} else if (menuDir !== null || menuPending) {
			// dropdown opened, or its fetch is still in flight — eat the click
			suppressNextClick = true;
		}
	}

	function clickNav(dir: 'back' | 'forward'): void {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		onhistory?.(dir);
	}

	function closeMenu(): void {
		menuDir = null;
		menuEntries = [];
		menuPending = false;
	}

	function pickEntry(index: number): void {
		closeMenu();
		onhistoryto?.(index);
	}

	function windowMousedown(e: MouseEvent): void {
		if (menuDir === null) return;
		// a press INSIDE the open menu (item or scroll) must not close it —
		// the anchor only covers the owning button's span, so test the menu itself
		if (e.target instanceof Element && e.target.closest('[data-testid="browser-history-menu"]')) return;
		if (menuAnchor && e.target instanceof Node && menuAnchor.contains(e.target)) return;
		closeMenu();
	}
	function windowKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && menuDir !== null) closeMenu();
	}

</script>

<svelte:window onmousedown={windowMousedown} onkeydown={windowKeydown} />
<div class="flex items-center gap-1 border-b border-surface-border px-2 py-1 text-xs">
	<span class="flex min-w-0 flex-1 items-center gap-2">
		<!-- proxy controls (ADR-0031 D1): outside the glass input surface -->
		<span class="relative flex items-center gap-1" bind:this={menuAnchor}>
			<BackButton
				class="browser-glyph flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface text-[18px] leading-none hover:bg-surface-active disabled:opacity-40"
				label={m.browserBack()}
				testid="browser-back"
				disabled={busy || !canBack}
				onholdstart={() => startHold('back')}
				onholdend={endHold}
				onclick={() => clickNav('back')}
			/>
			<ForwardButton
				class="browser-glyph flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface text-[18px] leading-none hover:bg-surface-active disabled:opacity-40"
				label={m.browserForward()}
				testid="browser-forward"
				disabled={busy || !canForward}
				onholdstart={() => startHold('forward')}
				onholdend={endHold}
				onclick={() => clickNav('forward')}
			/>
			{#if menuDir}
				<!-- anchored to the PAIR, shifted under the pressed button (w-6 = left-0 back, left-7 forward) -->
				<BrowserHistory dir={menuDir} entries={menuEntries} onpick={pickEntry} class={menuDir === 'back' ? 'left-0' : 'left-7'} />
			{/if}
		</span>
		<!-- ReloadButton (2026-10-28 extraction): the feedback trilogy the
		     workspace-file toolbar carries; the header keeps its chip chrome
		     and stays idle-only (no busy/done machine — YAGNI per operator
		     approval). -->
		<ReloadButton
			onclick={() => onreload?.()}
			label={m.browserReload()}
			testid="browser-reload"
			disabled={status !== 'live' || busy}
			size={12}
			class="browser-glyph flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface text-[18px] leading-none hover:bg-surface-active disabled:opacity-40"
		/>
		<!-- ADR-0061 D5: the wire-clipboard Paste button — the always-
			 available fallback for the state the native paste event misses
			 (nothing focused). The panel performs the dispatch; the header
			 only reports state. -->
		<button
			type="button"
			class="browser-glyph flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface text-[13px] leading-none hover:bg-surface-active disabled:opacity-40"
			title={pasteLabel()}
			aria-label={pasteLabel()}
			data-testid="browser-paste"
			data-paste-state={pasteState || undefined}
			disabled={status !== 'live' || busy || !onpaste}
			onclick={() => void pasteFromHost()}
		>📋</button>
		<!-- Prefix copy-URL (focus polish 2026-10-28): the operator correction —
		 icon on the LEADING edge of the input, following the existing
		 prefix-icon design decision. Copies the FOCUSED tab's URL. -->
		<UrlCopy
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-surface-border bg-surface text-surface-muted hover:bg-surface-active disabled:opacity-40"
			{copied}
			copiedLabel={m.browserCopied()}
			label={m.browserCopyUrl()}
			testid="browser-copy-url"
			disabled={!copyUrl}
			oncopy={() => void copyFocusedUrl()}
		/>
		<UrlInput
			class="min-w-0 flex-1 rounded border border-surface-border bg-surface px-2 py-0.5"
			bind:value={urlText}
			placeholder={placeholder ?? m.browserUrlPlaceholder()}
			disabled={status !== 'live' || busy}
			testid="browser-url-input"
			onsubmit={submit}
		/>
	</span>
	<span class="flex items-center gap-2" data-testid="browser-status" data-status={status} data-rebound={reBound}>
		<span class="inline-block h-2 w-2 rounded-full {status === 'live' ? 'bg-emerald-500' : status === 'failed' || status === 'closed' ? 'bg-red-500' : 'bg-amber-400'}"></span>
		{#if sessionId}<span class="rounded-t-md border border-b-0 border-surface-border bg-surface-elevated px-2 py-0.5 font-mono text-[10px] opacity-80" data-testid="browser-session-tab">{sessionId.slice(0, 8)}</span>{/if}
		<BrowserClosed {closing} {onclose} />
	</span>
</div>
