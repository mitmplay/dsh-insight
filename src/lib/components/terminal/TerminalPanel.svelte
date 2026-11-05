<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import { themePrefs } from '$lib/utils/theme-prefs.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pickTerminalTheme } from './terminal-theme';
	import { panelHot } from './terminal-hmr.js';
import { TERM_FONT_DEFAULT } from '$lib/utils/panel-prefs';
import TermFontSlider from './TermFontSlider.svelte';
	import {
		initialTerminalPanelState,
		reduceTerminalFrame,
		type TerminalPanelState
	} from './frame-state.js';

	let {
		/** Fired once after the shell exits (a settled frame with reason
		 *  'session_exit'), following a short pause so the badge stays
		 *  readable. The route maps it to removing the terminal panel —
		 *  shell exit closes the panel the way the header × would. */
		onShellExit,
		assigned = null,
		onAssigned,
		zoom = 1,
		termFontSize = TERM_FONT_DEFAULT,
		onFontChange
	}: {
		onShellExit?: () => void;
		/** Row mode (Terminal Desk, Wave 2): the desk opened the session and
		 *  hands it down — the panel SKIPS the probe/reattach ladder entirely
		 *  and attaches the given session. Null (default) = solo mode: the
		 *  panel runs the Surviving-Shell mount ladder itself, byte-identical
		 *  to pre-desk behavior. */
		assigned?: { sessionId: string; token: string } | null;
		/** Fired (both modes) once the panel holds a live session — the desk
		 *  records it per row (the Wave 3 blob mirror's raw material). */
		onAssigned?: (sessionId: string, token: string) => void;
		/** Floor zoom (ADR-0041 Am.3, the terminal pocket): the panel renders
		 *  inside PanelsZoom's scale(zoom) row, which splits xterm's cell math
		 *  from the visual space and mis-maps mouse selection. The pocket
		 *  wrapper counter-scales (net 1 — layout == visual) and the zoom
		 *  reaches the glyphs as fontSize × zoom. Null/undefined = 1. */
		zoom?: number | null;
		/** Terminal base font in px (ADR-0041 Am.4): the operator's
		 *  preference NUMBER; zoom multiplies on top. Clamped by the
		 *  caller (the pagePrefs seed). */
		termFontSize?: number;
		/** Slider-up callback — the desk forwards to the route, which
		 *  writes pagePrefs (the persisted floor blob). */
		onFontChange?: (px: number) => void;
	} = $props();

	/** Coerced zoom — the pocket's single source (null-safe default 1). */
	const pocketZoom = $derived(zoom ?? 1);
	/** Coerced base font — the glyph-size preference (null-safe). */
	const baseFont = $derived(termFontSize ?? TERM_FONT_DEFAULT);

	let panelState = $state<TerminalPanelState>({ ...initialTerminalPanelState });
	let disabled = $state(false);
	let opening = $state(false);
	let sessionId = $state<string | null>(null);
	let token = $state<string | null>(null);
	let termEl = $state<HTMLDivElement | null>(null);
	let hostEl = $state<HTMLDivElement | null>(null);
	let fallbackText = $state('');
	let typedLine = $state('');
	let xtermFailed = $state(false);
	// Terminal Theming (ADR-0023 follow-up): while terminal.theming is on,
	// the palette follows html[data-theme] live (theme-prefs store). Off =
	// null theme = xterm's self-dark default, the ADR keep-list position.
	$effect(() => {
		const theme = pickTerminalTheme(theming, themePrefs.resolved);
		if (xterm) xterm.options.theme = theme ?? undefined;
	});

	// Terminal pocket zoom (ADR-0041 Am.3): the visual zoom reaches the
	// terminal the way terminals zoom — the font — then one refit (the
	// existing ResizeObserver plumbing picks up the re-fit dims and the
	// syncPtyDims gate decides whether the PTY cares). Mirrors the theme
	// effect idiom above: an option-setter on the live instance.
	$effect(() => {
		// READ BOTH SIGNALS BEFORE the xterm guard: an early return on the
		// first run (xterm attaches later, a plain let invisible to the
		// scheduler) would leave baseFont untracked — a later font-drag
		// would never re-fire this effect (found live, 2026-11-05 e2e).
		const z = pocketZoom;
		const f = baseFont;
		if (!xterm) return;
		xterm.options.fontSize = Math.round(f * z * 100) / 100;
		fitAddon?.fit();
	});

	let xterm: import('@xterm/xterm').Terminal | null = null;
	/** terminal.theming from the probe (default false = self-dark). */
	let theming = $state(false);
	let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;
	let resizeObserver: ResizeObserver | null = null;

	let writeChain = Promise.resolve();

	/** Focus the live xterm surface (the desk's ⌥+N tab shortcut,
	 *  2026-09-25): the real terminal when attached, the fallback
	 *  input's textarea otherwise. */
	export function focusTerminal(): void {
		if (xterm) xterm.focus();
		else termEl?.querySelector('textarea')?.focus();
	}

	let shellExitTimer: ReturnType<typeof setTimeout> | null = null;
	let shellExitFired = false;

	/** Serialized keystroke writes: separate fetches race on the server, so
	 *  the chain is the ordering guarantee for the PTY byte stream. Failures
	 *  INSIDE writeWithHeal are handled (the token auto-heal); only network
	 *  errors are swallowed here — a dead fetch must not break the chain. */
	function queueWrite(data: string): void {
		writeChain = writeChain.then(() => writeWithHeal(data), () => undefined);
	}

	/** Token auto-heal (ADR The Surviving Shell, amendment 2026-11-04): the
	 *  session's write token is a baton with ONE holder. A 403
	 *  FOREIGN_SESSION means another writer (the operator's own reload, a
	 *  desk row, an API driver) re-minted it — heal by reattaching once,
	 *  swapping the fresh token in, and retrying the SAME keystroke. The
	 *  display stream is token-free (open-watch, D7), so only the baton
	 *  moves; whoever typed last owns it and the other side heals on its
	 *  next keystroke. A second consecutive refusal gives up quietly — the
	 *  next keystroke starts a fresh heal. */
	let healCount = $state(0);
	async function writeWithHeal(data: string): Promise<void> {
		const url = '/api/terminal/' + (sessionId ?? '') + '/send';
		let res = await post(url, { token, action: 'write', data });
		if (res.status === 403 && sessionId) {
			const re = await post('/api/terminal/' + sessionId + '/reattach', {});
			if (re.ok) {
				const body = (await re.json()) as { token: string };
				token = body.token;
				healCount += 1;
				onAssigned?.(sessionId, token);
				res = await post(url, { token, action: 'write', data });
			}
		}
	}

	async function post(url: string, body: unknown): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	function applyFrame(raw: string): void {
		const lines = raw.split('\n');
		const ev = lines.find((l) => l.startsWith('event: '))?.slice(7);
		const dataLine = lines.find((l) => l.startsWith('data: '))?.slice(6);
		if (!ev || !dataLine) return;
		const data = JSON.parse(dataLine) as Record<string, unknown>;
		if (ev === 'output') {
			// The reconnect ladder resumes from HERE (attachStream reads
			// lastOffset): the offset the view has actually painted.
			const off = Number(data.nextOffset);
			if (Number.isFinite(off)) lastOffset = off;
			reconnectDelayMs = STREAM_RECONNECT_MIN_MS;
			// THE view path: streamed bytes go to the visible terminal. The
			// fallbackText mirror exists only for the no-xterm fallback.
			if (xterm) xterm.write(String(data.text ?? ''));
			else fallbackText += String(data.text ?? '');
		}
		if (ev === 'settled') {
			panelState = reduceTerminalFrame(panelState, { event: 'settled', reason: data.reason as never });
			// Shell exit → auto-close the panel after a readable pause
			// (once; other settle reasons never fire it).
			if (data.reason === 'session_exit' && !shellExitFired) {
				shellExitFired = true;
				shellExitTimer = setTimeout(() => onShellExit?.(), 1500);
			}
		}
		if (ev === 'closed') {
			panelState = reduceTerminalFrame(panelState, { event: 'closed', quiescent: Boolean(data.quiescent) });
		}
		if (ev === 'error') panelState = reduceTerminalFrame(panelState, { event: 'error', error: String(data.error) });
	}

	function attachXterm(): void {
		if (!termEl || !sessionId || xterm) return;
		void (async () => {
			try {
				const [{ Terminal }, { FitAddon }] = await Promise.all([
					import('@xterm/xterm'),
					import('@xterm/addon-fit')
				]);
				if (!termEl) return;
				xterm = new Terminal({
					convertEol: true,
					// Pocket zoom's initial value (the $effect above only re-fires
					// on PROP changes once the effect has run with a live xterm;
					// plain-let xterm is invisible to it at creation time).
					fontSize: Math.round(baseFont * pocketZoom * 100) / 100,
					theme: pickTerminalTheme(theming, themePrefs.resolved) ?? undefined
				});
				fitAddon = new FitAddon();
				xterm.loadAddon(fitAddon);
				xterm.open(termEl);
				fitAddon.fit();
				// Refit whenever the panel resizes (the floor drags widths).
				resizeObserver = new ResizeObserver(() => fitAddon?.fit());
				resizeObserver.observe(hostEl ?? termEl);
				xterm.write(fallbackText);
				xterm.onResize((e) => syncPtyDims(e.cols, e.rows));
				syncPtyDims(xterm.cols, xterm.rows);
				xterm.onData((data) => {
					if (sessionId && token) queueWrite(data);
				});
				xterm.focus();
			} catch {
				xtermFailed = true;
			}
		})();
	}

	/** Push the fitted dims to the PTY (Terminal Desk ADR amendment
	 *  2026-11-03): the shell's winsize — and its right prompt — must match
	 *  the rendered viewport or the last columns spill past the edge.
	 *  Fires only when the dims actually change; a refused write is silent
	 *  (the desk's own ladder handles session death). */
	let lastSentCols = 0;
	let lastSentRows = 0;
	function syncPtyDims(cols: number, rows: number): void {
		if (!sessionId || !token) return;
		if (cols === lastSentCols && rows === lastSentRows) return;
		lastSentCols = cols;
		lastSentRows = rows;
		void fetch('/api/terminal/' + sessionId + '/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, action: 'resize', cols, rows })
		}).catch(() => undefined);
	}

	$effect(() => {
		if (!termEl || !sessionId || xterm) return;
		attachXterm();
	});

	let pageGoingAway = false;

	onMount(() => {
		// The dying page holds a LEASE, not the life (ADR The Surviving Shell
		// D4): a reload or tab close must not close the session — only a
		// deliberate panel close (page alive) does.
		const markGoingAway = (): void => {
			pageGoingAway = true;
		};
		window.addEventListener('pagehide', markGoingAway);
		// The HMR LEASE (2026-11-04 amendment, dev-only): a vite hot swap
		// disposes WITHOUT a pagehide — the page never unloads — so the
		// plain-unmount clause below would kill the session on every hot
		// swap (observed live: t-7/t-8 corpses, t-9 minted). An
		// import.meta.hot dispose marks the teardown HMR-sourced; the close
		// POST is skipped and the desk's rebuild ladder (probe → reattach →
		// byte-0 replay) re-attaches to the survivor on the re-mount.
		// Production builds never see import.meta.hot — byte-identical
		// ladder; a deliberate panel × is NOT an HMR dispose and still
		// closes provably (fact 11 untouched).
		const hot = panelHot();
		hot?.dispose(() => {
			pageGoingAway = true;
		});
		hot?.on('vite:beforeUpdate', () => {
			pageGoingAway = true;
		});
		hot?.on('vite:afterUpdate', () => {
			pageGoingAway = false;
		});
		return () => {
			window.removeEventListener('pagehide', markGoingAway);
			if (shellExitTimer !== null) clearTimeout(shellExitTimer);
			if (reconnectTimer !== null) clearTimeout(reconnectTimer); // the ladder dies with the panel
			streamEnded = true;
			resizeObserver?.disconnect();
			xterm?.dispose();
			xterm = null;
			// Panel close IS terminal close: the PTY lives server-side, so an
			// unmount without a close POST would leak the session until the
			// orphan scrub. keepalive lets the POST outlive the unmount —
			// UNLESS the page itself is going away (pagehide): losing the
			// lease is not closing (D4).
			if (sessionId && token && !pageGoingAway) {
				void fetch('/api/terminal/' + sessionId + '/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ token, action: 'close' }),
					keepalive: true
				}).catch(() => undefined);
			}
		};
	});

	onMount(() => {
		void (async () => {
			if (assigned) {
				// ROW MODE: the desk already holds the lease — no probe, no
				// reattach decision. Replay from 0 like the amended Surviving-
				// Shell D3 (a fresh surface needs the ring replay).
				sessionId = assigned.sessionId;
				token = assigned.token;
				attachStream(0);
				onAssigned?.(sessionId, token);
				return;
			}
			const probe = await fetch('/api/terminal');
			const probeBody = (await probe.json()) as { enabled: boolean; theming?: boolean; sessions?: Array<{ id: string; exited: boolean }> };
			if (!probeBody.enabled) {
				disabled = true;
				return;
			}
			theming = probeBody.theming === true;
			// Mount ladder (The Surviving Shell D3): a live session from before
			// the reload is RE-ATTACHED — same PTY, stream resumed at the byte
			// tail — never duplicated. Only a fresh floor opens a new session.
			const live = (probeBody.sessions ?? []).find((s) => !s.exited);
			let open: Response;
			let resumeByte = 0;
			if (live) {
				open = await post('/api/terminal/' + live.id + '/reattach', {});
				if (!open.ok) {
					disabled = true;
					return;
				}
				const re = (await open.json()) as { token: string; fromByte: number };
				sessionId = live.id;
				token = re.token;
				// Replay the retained ring from 0 (NOT the tail): the fresh
				// xterm surface has no memory, so the old scrollback — the
				// operator's `ls -a`, the running build's log — must stream
				// back in or survival would be a blank panel.
				resumeByte = 0;
			} else {
				opening = true;
				open = await post('/api/terminal', {});
				if (!open.ok) {
					disabled = true;
					opening = false;
					return;
				}
				const opened = (await open.json()) as { sessionId: string; token: string; totalBytes: number };
				sessionId = opened.sessionId;
				token = opened.token;
				opening = false;
				resumeByte = opened.totalBytes;
			}

			attachStream(resumeByte);
			onAssigned?.(sessionId, token);
		})();
	});

	/** The SSE subscription, shared by both modes (solo ladder tail and
	 *  desk row mode): named events forwarded into applyFrame; `closed`
	 *  ends the source. Stream reconnect ladder (ADR amendment 2026-11-04):
	 *  a dead EventSource must not freeze the view forever — EventSource's
	 *  own auto-retry replays the SAME fromByte (duplicate scrollback) or
	 *  dies silently on a non-SSE answer (a 404 JSON from a restarted dev
	 *  server), so we close it and re-attach MANUALLY from the last offset
	 *  the view actually painted, with capped backoff. A `closed` frame
	 *  (the session really ended) stops the ladder. */
	const STREAM_RECONNECT_MIN_MS = 1000;
	const STREAM_RECONNECT_MAX_MS = 8000;
	let lastOffset = 0;
	let reconnectDelayMs = STREAM_RECONNECT_MIN_MS;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let streamEnded = false;
	function attachStream(resumeByte: number): void {
		const es = new EventSource('/api/terminal/' + sessionId + '/stream?fromByte=' + resumeByte);
		es.onmessage = (e) => applyFrame('data: ' + e.data);
		for (const kind of ['output', 'settled', 'exit', 'closed', 'error']) {
			es.addEventListener(kind, (e) => {
				const data = 'data' in e ? (e as MessageEvent).data : '';
				applyFrame('event: ' + kind + '\n' + 'data: ' + data);
				if (kind === 'closed' || kind === 'exit') streamEnded = true;
				if (kind === 'closed') es.close();
			});
		}
		es.onerror = () => {
			es.close();
			if (streamEnded || reconnectTimer !== null) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				attachStream(lastOffset);
			}, reconnectDelayMs);
			reconnectDelayMs = Math.min(reconnectDelayMs * 2, STREAM_RECONNECT_MAX_MS);
		};
	}

	async function sendLine(): Promise<void> {
		const line = typedLine;
		typedLine = '';
		if (!sessionId || !token || !line) return;
		await writeWithHeal(line + '\n');
	}

	function settleText(reason: string | null): string {
		if (reason === 'stdin_read') return t(m.terminalSettleStdinRead);
		if (reason === 'inferred_idle') return t(m.terminalSettleInferredIdle);
		if (reason === 'timeout') return t(m.terminalSettleTimeout);
		if (reason === 'session_exit') return t(m.terminalSettleSessionExit);
		return '';
	}
</script>

<!--
TerminalPanel — the operator's live terminal on the floor (spec Wave 4,
ADR 2026-09-23). xterm.js (WITH its stylesheet and the FitAddon — both are
required for correct cell measurement) over the /api/terminal SSE stream;
keystrokes POST write; the settle badge reads the stream's settled frame;
close runs the server's quiescence ladder. The plain-text surface (pre +
input line) appears ONLY when xterm cannot attach.
-->

<div class="terminal-panel flex h-full min-h-80 flex-col rounded-lg p-1 {theming ? 'bg-surface-elevated text-text-primary' : 'bg-slate-900'}" data-testid="terminal-panel">
	<div class="mb-1 flex items-center gap-2 px-1 text-[10px] text-slate-400">
		{#if panelState.lastSettle}
			<span data-testid="terminal-settle-badge" class="rounded bg-slate-700 px-1.5 py-0.5">{settleText(panelState.lastSettle)}</span>
		{/if}
		{#if healCount > 0}
			<span data-testid="terminal-heal-badge" class="rounded bg-slate-700 px-1.5 py-0.5">{t(m.terminalTokenRefreshed)}</span>
		{/if}
		<div class="grow"></div>
		<!-- Terminal base font (ADR-0041 Am.4): right-aligned in the
		     settle-badge row; presentational — the desk/route own the
		     meaning, this panel only re-fires the pocket refit. -->
		<TermFontSlider
			font={baseFont}
			onchange={(px) => onFontChange?.(px)}
			label={t(m.terminalFontSlider)}
			testid="terminal-font-slider"
		/>
	</div>
	{#if disabled}
		<div class="p-3 text-xs text-slate-500" data-testid="terminal-disabled">{t(m.terminalDisabled)}</div>
	{:else if opening}
		<div class="p-3 text-xs text-slate-500" data-testid="terminal-opening">{t(m.terminalOpening)}</div>
	{:else}
		<div
			class="relative min-h-72 grow overflow-hidden"
			data-testid="terminal-host"
			onclick={() => (xterm ? xterm.focus() : termEl?.querySelector('textarea')?.focus())}
			role="presentation"
		>
			<!-- The pocket (ADR-0041 Am.3): layout pre-multiplied by zoom and
			     counter-scaled by 1/zoom — net scale 1 against the row AND the
			     pocket's layout box equals the host's VISUAL box, so xterm
			     measures and maps exactly the pixels the eye sees. At zoom 1
			     no styles are applied (byte-equivalent markup). -->
			<div
				class="absolute inset-0 origin-top-left"
				style={pocketZoom === 1
					? undefined
					: `right: auto; bottom: auto; width: ${pocketZoom * 100}%; height: ${pocketZoom * 100}%; transform: scale(${1 / pocketZoom});`}
			>
				<div bind:this={termEl} class="absolute inset-0"></div>
			</div>
		</div>
		{#if xtermFailed}
			<pre class="max-h-40 overflow-auto whitespace-pre-wrap bg-slate-950 p-1 font-mono text-[11px] text-slate-300" data-testid="terminal-fallback">{fallbackText}</pre>
		{/if}
		{#if xtermFailed}
			<input
				class="w-full px-2 py-1 font-mono text-[11px] outline-none {theming ? 'bg-surface-alt text-text-primary' : 'bg-slate-800 text-slate-100'}"
				data-testid="terminal-input"
				placeholder={t(m.terminalSettleStdinRead)}
				bind:value={typedLine}
				onkeydown={(e) => {
					if (e.key === 'Enter') void sendLine();
				}}
			/>
		{/if}
	{/if}
	{#if panelState.closed}
		<div class="px-2 pb-1 text-[10px] text-slate-500" data-testid="terminal-closed">
			{t(m.terminalClosed)}{panelState.quiescent === false ? ' (lingering)' : ''}
		</div>
	{/if}
</div>
