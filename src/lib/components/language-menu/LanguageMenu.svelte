<script lang="ts">
	/**
	 * Language menu — Three Tongues W2 task 2.2 (ADR 2026-09-12), migrated
	 * onto the base component (ADR-0063 D3). DSI contributes its identity:
	 * paraglide labels (via the shared locale-state t seat), the locale
	 * fleet, and the native names. Structure, persistence (dual-write
	 * cookie + storage through the base store behind locale-state), and
	 * click grammar live in container-base/src/i18n/LanguageMenu.svelte —
	 * testids are unchanged so every floor mount keeps passing.
	 */
	import { Languages } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { localePrefs, t } from '$lib/services/locale/locale-state.svelte';
	import { UI_LOCALES } from '$lib/config';
	import { LanguageMenu as BaseLanguageMenu } from '@deepseek-insight/container-base';

	let {
		/** Open the list upward (sidebar-footer mount — it sits at the
		 *  bottom of the rail; a downward list leaves the screen). */
		dropUp = false
	}: { dropUp?: boolean } = $props();

	// Native names are NOT translated copy — every locale shows every
	// name in its own language (the point of a language menu).
	const NATIVE_NAMES: Record<string, string> = {
		en: 'English',
		zh: '中文',
		id: 'Bahasa Indonesia',
		es: 'Español'
	};
</script>

<BaseLanguageMenu
	prefs={localePrefs}
	locales={UI_LOCALES}
	labels={NATIVE_NAMES}
	triggerLabel={t(m.languageMenu_label)}
	icon={Languages}
	{dropUp}
/>
