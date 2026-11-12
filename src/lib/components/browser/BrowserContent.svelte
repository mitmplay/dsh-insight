<!--
	BrowserContent — the canvas of BrowserPanel (The Glass Browser spec
	Wave 2, task 2.1; ADR-0029). The failed-reason strip, the glass
	viewport (letterbox-aware, D6), and the launch/wait placeholder.
	A dumb surface: input events report upward to the panel, which owns
	the CDP mirroring and posting; canvas/wrap elements bind upward so
	draw() and the coord mapper stay in the panel's script.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		/** Panel session state — picks failed strip vs glass, placeholder text. */
		status,
		/** Failure message for the failed strip (null = not failed). */
		failReason = null,
		/** Glass wrapper — bound upward for the letterbox coord mapper (D6). */
		wrap = $bindable(null),
		/** The mirrored canvas — bound upward for the panel's draw(). */
		canvas = $bindable(null),
		/** Input relays — the panel turns these into CDP input posts. */
		ondown,
		onup,
		onmove,
		onwheel,
		onkey,
		onpaste,
		oncontextmenu,
		ctxMenu = null,
		onctxaction,
		onctxclose
	}: {
		status: 'opening' | 'connecting' | 'live' | 'failed' | 'closed';
		failReason?: string | null;
		wrap?: HTMLDivElement | null;
		canvas?: HTMLCanvasElement | null;
		ondown?: (e: MouseEvent) => void;
		onup?: (e: MouseEvent) => void;
		onmove?: (e: MouseEvent) => void;
		onwheel?: (e: WheelEvent) => void;
		onkey?: (e: KeyboardEvent) => void;
		/** ADR-0061 D2: the wire-clipboard paste event on the glass wrap. */
		onpaste?: (e: ClipboardEvent) => void;
		oncontextmenu?: (e: MouseEvent) => void;
		ctxMenu?: { px: number; py: number; href: string | null; src: string | null; selection?: string | null } | null;
		onctxaction?: (action: string) => void;
		onctxclose?: () => void;
	} = $props();
</script>

{#if status === 'failed'}
	<div class="p-3 text-xs text-red-500" data-testid="browser-failed">{m.browserSessionFailed({ reason: failReason ?? '' })}</div>
{:else}
	<div
		class="relative min-h-0 flex-1 overflow-hidden"
		bind:this={wrap}
		data-testid="browser-glass"
	>
		<canvas
			bind:this={canvas}
			class="h-full w-full object-contain"
			tabindex="0"
			onmousedown={ondown}
			onmouseup={onup}
			onmousemove={onmove}
			onwheel={onwheel}
			onkeydown={onkey}
			onkeyup={onkey}
			onpaste={onpaste}
			oncontextmenu={oncontextmenu}
		></canvas>
		{#if ctxMenu}
			<div
				class="absolute z-50 min-w-44 rounded-md border border-zinc-700 bg-white py-1 text-xs shadow-xl"
				style="left:{ctxMenu.px}px; top:{ctxMenu.py}px"
				data-testid="browser-ctxmenu"
			>
				{#if ctxMenu.selection}
					<!-- ADR-0061 D4: the page's SELECTION, not the point's element —
					     the operator selects, then right-clicks anywhere. Honest
					     absence when the selection is empty, never a disabled lie. -->
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('copy-text')} data-testid="browser-ctxmenu-item">{m.browserCtxCopyText()}</button>
				{/if}
				{#if ctxMenu.src}
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('open-image')} data-testid="browser-ctxmenu-item">{m.browserCtxOpenImage()}</button>
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('copy-image')} data-testid="browser-ctxmenu-item">{m.browserCtxCopyImage()}</button>
				{/if}
				{#if ctxMenu.href}
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('open-link')} data-testid="browser-ctxmenu-item">{m.browserCtxOpenLink()}</button>
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('copy-link')} data-testid="browser-ctxmenu-item">{m.browserCtxCopyLink()}</button>
				{/if}
				<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('reload')} data-testid="browser-ctxmenu-item">{m.browserReload()}</button>
				<div class="my-1 border-t border-zinc-300"></div>
				<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('send-right-click')} data-testid="browser-ctxmenu-item">{m.browserCtxSendRightClick()}</button>
			</div>
		{/if}
		{#if status === 'closed'}
			<!-- Ghost Glass Fix 1 (RCA 2026-10-31): the dead glass tells the truth
			     instead of painting its last frame as 'waiting for frames'. -->
			<div class="absolute inset-0 grid place-items-center text-xs opacity-80" data-testid="browser-closed">
				{m.browserSessionDead()}
			</div>
		{:else if status !== 'live'}
			<div class="absolute inset-0 grid place-items-center text-xs opacity-60" data-testid="browser-placeholder">
				{status === 'opening' ? m.browserLaunching() : m.browserWaitingFrames()}
			</div>
		{/if}
	</div>
{/if}
