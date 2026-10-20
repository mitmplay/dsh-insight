/**
 * Locale resolution — Three Tongues W1 task 1.3 (ADR 2026-09-12 D3).
 *
 * THE one resolver: both the SSR request path (hooks middleware, task 1.4)
 * and the settings row route through this order. Nothing outside
 * src/lib/server/ reads settings.yaml; components never read the cookie.
 *
 * Resolution order (the ADR state-homes table, authority top-down):
 *   1. cookie dsi.locale            — this device's explicit choice
 *   2. ui.locale in settings.yaml   — the operator's default
 *   3. Accept-Language primary tag  — the browser's hint
 *   4. en                           — baseLocale fallback (always wins last)
 *
 * The yaml / header inputs are injected; this module stays pure and
 * testable against one case per state-homes row.
 */

import { resolveUiLocale, type UiLocale } from '$lib/config';
import { readSettingsDocument } from './settings-document';
import { parse } from 'yaml';

export interface LocaleInputs {
	/** Raw dsi.locale cookie value, if the request carried one. */
	cookieLocale?: string | undefined;
	/** Raw ui.locale value parsed from settings.yaml, if any. */
	yamlLocale?: unknown;
	/** Raw Accept-Language header, if the request carried one. */
	acceptLanguage?: string | undefined;
}

/** First Accept-Language tag whose primary subtag is a fleet locale.
 *  "id-ID,id;q=0.9" matches "id"; "en-GB" matches "en"; "fr" matches nothing. */
export function localeFromAcceptLanguage(header: string | undefined): UiLocale | null {
	if (!header) return null;
	for (const part of header.split(',')) {
		const tag = part.trim().split(';')[0].trim().toLowerCase();
		const primary = tag.split('-')[0];
		if (primary === 'en' || primary === 'zh' || primary === 'id' || primary === 'es') return primary;
	}
	return null;
}

/** The D3 resolution order. Pure — every input is injected.
 *
 *  An INVALID value at a layer is treated as "this layer did not speak":
 *  a stale cookie (locale removed from the fleet) or a foreign yaml value
 *  falls through to the next home rather than pinning en forever. Only
 *  when no layer speaks a fleet locale does the baseLocale fallback win. */
export function resolveLocale(inputs: LocaleInputs): UiLocale {
	const fromCookie = resolveUiLocale(inputs.cookieLocale);
	if (inputs.cookieLocale !== undefined && fromCookie === inputs.cookieLocale) return fromCookie;
	const fromYaml = resolveUiLocale(inputs.yamlLocale);
	if (inputs.yamlLocale !== undefined && fromYaml === inputs.yamlLocale) return fromYaml;
	return localeFromAcceptLanguage(inputs.acceptLanguage) ?? resolveUiLocale(undefined);
}

/**
 * The operator's `ui.locale` default from ~/.dsi/settings.yaml — the raw
 * value (NOT gated): an absent section/missing file returns undefined so
 * the resolver treats yaml as silent and falls through. configPath is the
 * test seam (same shape as readSettingsDocument's own).
 */
export function readOperatorYamlLocale(configPath?: string): unknown {
	try {
		const { text, missing } = readSettingsDocument('dsi', configPath);
		if (missing) return undefined;
		const doc = parse(text);
		if (doc && typeof doc === 'object' && 'ui' in doc) {
			const ui = (doc as { ui?: { locale?: unknown } }).ui;
			return ui?.locale;
		}
		return undefined;
	} catch {
		// A broken yaml document must never 500 the page — yaml is silent.
		return undefined;
	}
}
