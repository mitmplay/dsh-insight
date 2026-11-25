<script lang="ts">
	// Test double for TerminalPanel exposing the FONT surface (ADR-0083):
	// the pane's current base font renders as data-font, and dragFont(px)
	// fires the same onFontChange the real slider emits. Instances register
	// themselves on (globalThis).__stubPanelInstances for the test to drive.
	import { onMount } from 'svelte';
	let {
		assigned = null,
		termFontSize = 12,
		onFontChange,
		onAssigned,
		onShellExit
	}: {
		assigned?: { sessionId: string; token: string } | null;
		termFontSize?: number;
		onFontChange?: (px: number) => void;
		onAssigned?: (sessionId: string, token: string) => void;
		onShellExit?: () => void;
	} = $props();
	const events = ((globalThis as { __stubPanelEvents?: unknown[] }).__stubPanelEvents ??= []);
	onMount(() => {
		events.push('mount:' + (assigned ? assigned.sessionId : 'self'));
		if (!assigned) onAssigned?.('stub-' + events.length, 'stub-tok');
		((globalThis as { __stubPanelInstances?: unknown[] }).__stubPanelInstances ??= []).push(
			{ sessionId: assigned?.sessionId ?? null, dragFont: (px: number) => onFontChange?.(px) }
		);
	});
	export function focusTerminal(): void {
		events.push('focus');
	}
	export function exitShell(): void {
		onShellExit?.();
	}
</script>

<div data-testid="terminal-panel" data-assigned={assigned ? assigned.sessionId : ''} data-font={termFontSize}>stub</div>
