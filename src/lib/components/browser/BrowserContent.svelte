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
		oncontextmenu?: (e: MouseEvent) => void;
		ctxMenu?: { px: number; py: number; href: string | null; src: string | null } | null;
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
			oncontextmenu={oncontextmenu}
		></canvas>
		{#if ctxMenu}
			<div
				class="absolute z-50 min-w-44 rounded-md border border-zinc-700 bg-white py-1 text-xs shadow-xl"
				style="left:{ctxMenu.px}px; top:{ctxMenu.py}px"
				data-testid="browser-ctxmenu"
			>
				{#if ctxMenu.src}
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('open-image')} data-testid="browser-ctxmenu-item">Open image in new tab</button>
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('copy-image')} data-testid="browser-ctxmenu-item">Copy image address</button>
				{/if}
				{#if ctxMenu.href}
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('open-link')} data-testid="browser-ctxmenu-item">Open link in new tab</button>
					<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('copy-link')} data-testid="browser-ctxmenu-item">Copy link address</button>
				{/if}
				<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('reload')} data-testid="browser-ctxmenu-item">Reload</button>
				<div class="my-1 border-t border-zinc-300"></div>
				<button type="button" class="block w-full px-3 py-1.5 text-left text-zinc-900 hover:bg-zinc-200" onclick={() => onctxaction?.('send-right-click')} data-testid="browser-ctxmenu-item">Send right-click to the page</button>
			</div>
		{/if}
		{#if status !== 'live'}
			<div class="absolute inset-0 grid place-items-center text-xs opacity-60" data-testid="browser-placeholder">
				{status === 'opening' ? m.browserLaunching() : m.browserWaitingFrames()}
			</div>
		{/if}
	</div>
{/if}
