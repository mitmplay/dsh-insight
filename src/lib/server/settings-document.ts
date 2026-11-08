/**
 * Settings document — raw-document access to DSI's and DSH's settings
 * files for the settings editor panel (ADR The Settings Panel, 2026-09-07,
 * D1/D2/D5). The YAML file is the authority: this module reads raw text,
 * gates saves on a YAML parse, and writes atomically. It owns the one-time
 * migration from DSI's legacy `~/.dsi/config.json` (D1): convert
 * once, never touch the legacy file again, never run twice (a second
 * resolve sees settings.yaml present and no-ops).
 *
 * Section readers (insight-config.ts) keep their own clamps and no-cache
 * contract; they trigger the migration through this module and parse the
 * same YAML home. The browser never learns a filesystem path — the API
 * route (wave 2) is the only consumer of these functions.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isConfigRecord } from '$lib/config';
import { parse, parseDocument, stringify } from 'yaml';

/** Which settings document an editor or save addresses. */
export type SettingsTarget = 'dsi' | 'dsh';

/** `~/.dsi/settings.yaml` — DSI's settings home (post-migration). */
export const DSI_SETTINGS_PATH = join(homedir(), '.dsi', 'settings.yaml');

/** `~/.dsh/settings.yaml` — the harness's settings home (DSH-owned). */
export const DSH_SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml');

/** Resolve the DSI settings path: explicit arg → env override → default. */
export function dsiSettingsPath(configPath?: string): string {
	return configPath ?? process.env.DSI_CONFIG_PATH ?? DSI_SETTINGS_PATH;
}

/** Resolve the DSH settings path: explicit arg → env override → default. */
export function dshSettingsPath(configPath?: string): string {
	return configPath ?? process.env.DSH_SETTINGS_PATH ?? DSH_SETTINGS_PATH;
}

/** Resolve a target to its settings path (unknown targets are a bug at the
 *  caller — the route validates before this point; this switch is total). */
export function resolveSettingsPath(target: SettingsTarget, configPath?: string): string {
	switch (target) {
		case 'dsi':
			return dsiSettingsPath(configPath);
		case 'dsh':
			return dshSettingsPath(configPath);
	}
}

/** Parse failure carrying the YAML parser's own position (line 1-based,
 *  column 0-based — surfaced verbatim to the editor banner). */
export class SettingsParseError extends Error {
	constructor(
		message: string,
		public readonly line: number | null,
		public readonly column: number | null
	) {
		super(message);
		this.name = 'SettingsParseError';
	}
}

/**
 * One-time DSI migration (ADR D1): when settings.yaml is absent and the
 * legacy config.json exists, parse the JSON and write it as YAML —
 * atomically, so a crash mid-migration never leaves a torn file. The
 * legacy file is READ ONLY here, never written, never read again once
 * settings.yaml exists (a second resolve no-ops — the migration cannot
 * run twice by construction).
 * @param settingsPath - the resolved settings.yaml path.
 * @param legacyPath - the legacy config.json path (same directory).
 */
export function migrateLegacyDsiConfig(settingsPath: string, legacyPath?: string): void {
	if (existsSync(settingsPath)) return;
	const legacy = legacyPath ?? join(dirname(settingsPath), 'config.json');
	if (!existsSync(legacy)) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(legacy, 'utf-8'));
	} catch {
		// An unreadable legacy document is not ours to repair — leave both
		// files alone; the readers' missing→defaults contract applies.
		return;
	}
	writeAtomic(settingsPath, stringify(parsed));
}

/** Resolve the template home: explicit arg → `DSI_TEMPLATE_PATH` env (set
 *  by bin/dsi.mjs from the package root) → `template/.dsi` under the cwd
 *  (dev runs). */
export function templateHomePath(templatePath?: string): string {
	return templatePath ?? process.env.DSI_TEMPLATE_PATH ?? join(process.cwd(), 'template', '.dsi');
}

/** Outcome of a first-start bootstrap attempt. */
export type EnsureHomeResult = 'exists' | 'cloned' | 'merged' | 'no-template';

/**
 * First-start home bootstrap (template/.dsi): when the DSI home directory is
 * absent, clone the shipped template (settings.yaml, prompts.sqlite seed,
 * a2a.sqlite ledger) into place. When the home exists but is a partial
 * seed — the CLI (`dsi dsh --sync`, bin/dsi.mjs) writes settings.yaml (and
 * so the home directory) BEFORE the server child runs — top the template's
 * remaining files in WITHOUT clobbering anything already present. A bare
 * "exists → skip" guard permanently skipped the DB clone on every fresh
 * install (2026-11-08 RCA: ~/.dsi/prompts.sqlite empty, 0 of 49 prompts);
 * the seed signature (settings.yaml present) keeps arbitrary pre-created
 * directories untouched. A missing template is a silent no-op so builds
 * without one degrade to the defaults contract.
 * @param homePath - test seam overriding the operator home directory.
 * @param templatePath - test seam overriding the template directory.
 * @returns `exists` (home present and nothing added), `cloned` (full template
 *   copied into a missing home), `merged` (partial seed topped up), or
 *   `no-template` (nothing to copy from).
 */
export function ensureDsiHome(homePath?: string, templatePath?: string): EnsureHomeResult {
	const home = homePath ?? dirname(DSI_SETTINGS_PATH);
	const template = templateHomePath(templatePath);
	if (!existsSync(template)) return 'no-template';
	if (!existsSync(home)) {
		cpSync(template, home, { recursive: true });
		return 'cloned';
	}
	// Seed signature: only a DSI home (settings.yaml written by the CLI seed
	// or the token watcher) gets topped up — arbitrary pre-created dirs stay
	// untouched.
	if (!existsSync(join(home, 'settings.yaml'))) return 'exists';
	cpSync(template, home, { recursive: true, force: false, errorOnExist: false });
	return 'merged';
}

/** Atomic write: temp file in the target directory, then rename. */
function writeAtomic(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = join(dirname(path), `.${basenameOf(path)}.${process.pid}.tmp`);
	writeFileSync(temp, text, 'utf-8');
	renameSync(temp, path);
}

function basenameOf(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** Raw read result: `missing` is the honest marker when the file is absent
 *  (the editor shows the default document, never a lie about the file). */
export interface RawSettings {
	text: string;
	missing: boolean;
}

/**
 * Read a settings document as raw text, running the DSI migration first
 * (dsi target only — DSH owns its own file lifecycle).
 * @param target - which document to read.
 * @param configPath - test seam overriding the resolved path.
 */
export function readSettingsDocument(target: SettingsTarget, configPath?: string): RawSettings {
	const path = resolveSettingsPath(target, configPath);
	if (target === 'dsi') {
		ensureDsiHome(dirname(path));
		migrateLegacyDsiConfig(path);
	}
	if (!existsSync(path)) return { text: '', missing: true };
	return { text: readFileSync(path, 'utf-8'), missing: false };
}

/**
 * Validate and atomically save a settings document. A parse failure throws
 * {@link SettingsParseError} and writes NOTHING (ADR D5).
 * @param target - which document to save.
 * @param text - the whole edited document text.
 * @param configPath - test seam overriding the resolved path.
 */
export function saveSettingsDocument(
	target: SettingsTarget,
	text: string,
	configPath?: string
): void {
	const path = resolveSettingsPath(target, configPath);
	const doc = parseDocument(text, { strict: false });
	const error = doc.errors[0];
	if (error !== undefined) {
		const pos = error.linePos?.[0];
		throw new SettingsParseError(error.message, pos?.line ?? null, pos?.col ?? null);
	}
	writeAtomic(path, text);
}

/** Parse YAML into a record for section readers (JSON is a YAML subset, so
 *  the same parse serves both shapes). Null on missing/invalid. */
export function parseYamlSettings(text: string): Record<string, unknown> | null {
	if (text.trim() === '') return null;
	try {
		const parsed: unknown = parse(text);
		return isConfigRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
