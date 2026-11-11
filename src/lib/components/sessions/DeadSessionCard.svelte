<script lang="ts">
	/**
	 * Dead-session card (ADR-0027f honest 404) + the Born-Late Panel retry
	 * (ADR-0059 D2): the panel-error surface extracted from the workspace
	 * route's panelBody ladder (Born-Late Panel T3, 2026-11-11) so the card
	 * is one owned component — the route's dead branch renders this with
	 * the recorded message and the wire-bound retry verb. The retry is
	 * honest: retryDead clears the entry and re-runs the cold load; a
	 * still-dead result simply re-records this card.
	 */
	import * as m from '$lib/paraglide/messages';

	let {
		message,
		onretry,
		onclose
	}: {
		message: string;
		onretry: () => void;
		onclose: () => void;
	} = $props();
</script>

<div class="panel-error" data-testid="panel-error" role="alert">
	<p>{message}</p>
	<!-- Born-Late Panel (ADR-0059 D2): an honest retry on every dead card. -->
	<button type="button" data-testid="panel-error-retry" onclick={onretry}>
		{m.tryAgain()}
	</button>
	<button type="button" data-testid="panel-error-close" onclick={onclose}>
		Close
	</button>
</div>

<style>
	.panel-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		height: 100%;
		padding: 1rem;
		text-align: center;
		color: var(--si-run);
		background: var(--color-danger-wash);
		font-size: 0.8125rem;
	}

	.panel-error button {
		border: 1px solid var(--color-danger-wash-border);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated);
		color: var(--si-run);
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
</style>
