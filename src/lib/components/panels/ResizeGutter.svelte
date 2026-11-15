<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ResizeGutter — the DSI RENDERER over the package's generic seam
	 * (ADR-0062 W4, D6/D8): the generic face (index + injected
	 * onGutterDown + label props) lives in @deepseek-insight/container-base;
	 * THIS file keeps only DSI's vocabulary — the paraglide labels and the
	 * panel-registry invoke (the leaf→root channel, commitment 2).
	 *
	 * Contract unchanged for every existing call site: props { index,
	 * onDragStart? }; absent onDragStart, the mousedown reports
	 * (event, index) through the panel registry and the workspace route
	 * (the single drag owner) runs the resize math. The Explorer Layout
	 * (ADR 2026-09-17 D4): when onDragStart is given, the calling
	 * component is the drag owner and the registry hop is skipped.
	 */
	import { ResizeGutter as ResizeGutterBase } from '@deepseek-insight/container-base';

	let {
		index,
		onDragStart
	}: {
		index: number;
		/** Local drag owner hook — fires INSTEAD of the registry when given. */
		onDragStart?: (event: MouseEvent) => void;
	} = $props();

	function handleGutterDown(event: MouseEvent): void {
		if (onDragStart) {
			onDragStart(event);
			return;
		}
		void import('$lib/services/panels/panel-registry').then((reg) =>
			reg.startPanelResize(event, index)
		);
	}
</script>

<ResizeGutterBase {index} ariaLabel={t(m.resizePanel)} title={t(m.dragResize)} onGutterDown={handleGutterDown} />
