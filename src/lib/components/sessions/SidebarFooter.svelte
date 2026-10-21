<script lang="ts">
	/**
	 * SidebarFooter — the sidebar's bottom strip under the session spine
	 * (extracted from SessionsList, 2026-09-04): the broadcast box
	 * (SidebarPromptSync, ADR "The Prompt Sync" — owns its own visibility,
	 * renders nothing unchecked) above the "+ New chat" button, armed with
	 * the filter pills' selection so a create rides the armed dimensions.
	 * The create row opens with the version chip (v{APP_VERSION},
	 * 2026-09-07) — the running edition reads where new chats start —
	 * (The circled-A About trigger moved to AppSidebarHeader's prefix,
	 * 2026-09 — its dialog still portals to document.body, BC-7.)
	 * Purely presentational: create logic, the creating lock, the
	 * Add/Replace verb toggle, and the alerts stay in NewChatButton; this
	 * shell carries the resolved selection and reports writes upward
	 * (oncreated / onreplace). Styles are self-contained — the parent's
	 * scoped rules cannot reach this component's DOM, so the border-top
	 * frame travels with it.
	 */
	import { X } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import NewChatButton from '$lib/components/composer/NewChatButton.svelte';
	import LanguageMenu from '$lib/components/language-menu/LanguageMenu.svelte';
	import ThemeToggle from '$lib/components/common/buttons/ThemeToggle.svelte';
	import { APP_VERSION, DSH_VERSION } from '$lib/version';
	import SidebarPromptSync from './SidebarPromptSync.svelte';

	/** The NewChatButton's missing-selection alert, HOSTED here: rendered
		 *  as footer-create's FIRST child so it spans the full row (version +
		 *  button + language menu wrap beneath) instead of squeezing into the
		 *  button's slot between the version chip and the language menu. */
	let createAlert = $state(false);

	let {
		preset,
		workspace,
		oncreated,
		onreplace
	}: {
		/** Selected agent preset (the filter pill) — arms the create. */
		preset: string | null;
		/** Selected workspace cwd (the filter pill) — optional; a null
		 *  create lands on the host's default directory. */
		workspace: string | null;
		/** Fresh session created via + New chat — the owner adds it to
		 *  the floor (the preset rides along for the panel chip). */
		oncreated: (sessionId: string, agentPreset: string | null) => void;
		/** Replace chat — the owner swaps the focused floor panel onto
		 *  the fresh session; absent = no Replace toggle renders. */
		onreplace?: (sessionId: string, agentPreset: string | null) => void;
	} = $props();

</script>

<div class="footer">
	<SidebarPromptSync />
	<div class="footer-create">
		{#if createAlert}
			<!-- ROW 1 — hosted alert: message left, × dismiss right. -->
			<p data-testid="new-chat-selection-alert" class="footer-create-alert" role="alert">
				<span>{t(m.needAgent)}</span>
				<button
					type="button"
					class="footer-create-alert-close"
					data-testid="new-chat-selection-alert-close"
					aria-label={t(m.dismissAlert)}
					title={t(m.dismiss)}
					onclick={() => (createAlert = false)}
				>
					<X size={11} aria-hidden="true" />
				</button>
			</p>
		{/if}
		<!-- ROW 2 — the strip: version + New chat + language menu. -->
		<div class="footer-create-strip">
			<!-- Version stack: DSI's own edition ABOVE the pinned DSH web
			     release it speaks — one chip, two lines. -->
			<span class="footer-version" data-testid="sidebar-footer-version">
				<span>v{APP_VERSION}</span>
				<span>v{DSH_VERSION}</span>
			</span>
			<NewChatButton compact agent={preset} {workspace} {oncreated} {onreplace} bind:alert={createAlert} alertInline={false} />
			<!-- Theme toggle (The Three-State Lamp W3, ADR-0023): BEFORE the
			     language menu — the operator's placement decision, 2026-10-10. -->
			<ThemeToggle dropUp />
			<!-- Language menu (Three Tongues W2, ADR 2026-09-12): header-mount
			     of the locale switcher; state lives in the shared service.
			     dropUp: the footer sits at the rail's bottom — a downward list
			     leaves the screen (bug-fix 2026-09-12). -->
			<LanguageMenu dropUp />
		</div>
	</div>
</div>


<style>
	.footer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px solid var(--color-surface-border, #dee2e6);
		padding: 0.5rem;
	}

	.footer-create {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	/* ROW 2 — the version + New chat + language strip (the old
	   footer-create flex row, untouched). */
	.footer-create-strip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* ROW 1 — hosted selection alert: message left, × right. */
	.footer-create-alert {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-accent-amber-ink);
	}

	.footer-create-alert-close {
		flex-shrink: 0;
		border-radius: 0.125rem;
		line-height: 1;
		color: var(--color-accent-amber-ink-deep);
		cursor: pointer;
	}

	.footer-create-alert-close:hover {
		background: var(--color-status-pending);
		color: var(--color-accent-amber-ink-deep);
	}

	/* Version chip — before the create button (2026-09-07): the running
	   edition reads where new chats start. Muted small-cap grammar from
	   the rail title, one step smaller. */
	.footer-version {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		line-height: 1.2;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary, #6c757d);
		white-space: nowrap;
	}

</style>
