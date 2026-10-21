<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import { themePrefs } from '$lib/utils/theme-prefs.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pickTerminalTheme } from './terminal-theme';
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
		onAssigned
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
	} = $props();

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
	 *  the chain is the ordering guarantee for the PTY byte stream. */
	function queueWrite(data: string): void {
		writeChain = writeChain.then(() =>
			post('/api/terminal/' + (sessionId ?? '') + '/send', { token, action: 'write', data })
		).then(() => undefined, () => undefined);
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
					fontSize: 12,
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
				xterm.onData((data) => {
					if (sessionId && token) queueWrite(data);
				});
				xterm.focus();
			} catch {
				xtermFailed = true;
			}
		})();
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
		return () => {
			window.removeEventListener('pagehide', markGoingAway);
			if (shellExitTimer !== null) clearTimeout(shellExitTimer);
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
	 *  ends the source. */
	function attachStream(resumeByte: number): void {
		const es = new EventSource('/api/terminal/' + sessionId + '/stream?fromByte=' + resumeByte);
		es.onmessage = (e) => applyFrame('data: ' + e.data);
		for (const kind of ['output', 'settled', 'exit', 'closed', 'error']) {
			es.addEventListener(kind, (e) => {
				const data = 'data' in e ? (e as MessageEvent).data : '';
				applyFrame('event: ' + kind + '\n' + 'data: ' + data);
				if (kind === 'closed') es.close();
			});
		}
	}

	async function sendLine(): Promise<void> {
		const line = typedLine;
		typedLine = '';
		if (!sessionId || !token || !line) return;
		await post('/api/terminal/' + sessionId + '/send', { token, action: 'write', data: line + '\n' });
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
		<div class="grow"></div>
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
			<div bind:this={termEl} class="absolute inset-0"></div>
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
