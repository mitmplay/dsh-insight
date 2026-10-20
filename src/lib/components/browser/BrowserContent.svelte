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
		onkey
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
		></canvas>
		{#if status !== 'live'}
			<div class="absolute inset-0 grid place-items-center text-xs opacity-60" data-testid="browser-placeholder">
				{status === 'opening' ? m.browserLaunching() : m.browserWaitingFrames()}
			</div>
		{/if}
	</div>
{/if}
