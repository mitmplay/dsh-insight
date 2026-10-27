/**
 * GET /api/config
 *
 * Returns DSI's operator-tunable browser config, read from
 * ~/.dsi/settings.yaml (OCI /api/config pattern, ported 2026-08-25).
 * The browser store (app-config.svelte.ts) applies this on load; every
 * section falls back to defaults on missing/invalid values. The server-only
 * section (server.ringCapacity) is intentionally absent — dsh-connection
 * reads it directly server-side.
 */

import { json } from '@sveltejs/kit';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	readA2aConfig,
	readChatConfig,
	readConversationConfig,
	readHomeConfig,
	readJobsConfig,
	readBrowserConfig,
	readPanelConfig,
	readPromptsConfig,
	readSidebarConfig,
	readSettingsHomes
} from '$lib/server/insight-config';
import { resolvePromptsDbPath } from '$lib/server/prompts/db.js';

import type { RequestHandler } from './$types';

/** Security tilde-collapse: the wire carries `~/…`, never the absolute
 *  homedir — the browser labels the library, it doesn't map the host. */
function collapseHome(p: string): string {
	const home = homedir();
	if (p === home) return '~';
	if (p.startsWith(home + '/')) return '~' + p.slice(home.length);
	return p;
}

export const GET: RequestHandler = async () => {
	return json({
		ok: true,
		chat: readChatConfig(),
		conversation: readConversationConfig(),
		home: readHomeConfig(),
		a2a: readA2aConfig(),
		panel: readPanelConfig(),
		sidebar: readSidebarConfig(),
		// The glass panel's width bounds (operator request 2026-10-26):
		// browser.defaultWidth / browser.maxWidth from settings.yaml.
		browserWidths: (() => { const b = readBrowserConfig(); return { defaultWidth: b.defaultWidth, maxWidth: b.maxWidth }; })(),
		// The browser-relevant half of the prompts section. dbPath crosses
		// since 2026-09-19: the manager toolbar LABELS the library with its
		// full file path — resolvePromptsDbPath, the exact path db.ts reads
		// (a directory-valued config gets /prompts.sqlite composed in; ~
		// and the env override honored). SECURITY: the homedir prefix is
		// collapsed BACK to `~` before the wire — the browser never learns
		// the server's absolute home path. Read-only fact, never tuned.
		prompts: {
			tags: readPromptsConfig().tags,
			dbPath: collapseHome(resolvePromptsDbPath())
		},
		// The Settings Tree (ADR 2026-09-18 D2): the verbatim settings home
		// roots, so /dsi-settings · /dsh-settings mint explorers with the
		// server's own homedir truth. Read-only facts, never tuned.
		jobs: readJobsConfig(),
		settingsHomes: readSettingsHomes()
	});
};
