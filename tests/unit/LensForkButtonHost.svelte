<script lang="ts">
	/**
	 * LensForkButtonHost — test fixture: the PanelLoupe provider shape
	 * around a header fork button (The Panel Loupe ADR D8, 2026-09-04) —
	 * sets the lens flag at init, then renders ForkButton so it
	 * initializes inside a lens tree.
	 */
	import { setLensMode } from '$lib/services/conversation/lens-context.svelte';
	import ForkButton from '$lib/components/conversation/header/ForkButton.svelte';

	let {
		lens = true,
		sessionId,
		title = null,
		agentPreset = null,
		subagent = false
	}: {
		/** Lens flag — true mirrors PanelLoupe; false is the control arm. */
		lens?: boolean;
		sessionId: string;
		title?: string | null;
		agentPreset?: string | null;
		subagent?: boolean;
	} = $props();

	// Intentional initial capture: context exists only during component
	// initialisation — the fixture mirrors PanelLoupe, which sets the
	// flag once at init before rendering children.
	// svelte-ignore state_referenced_locally
	setLensMode(lens);
</script>

<ForkButton {sessionId} {title} {agentPreset} {subagent} />
