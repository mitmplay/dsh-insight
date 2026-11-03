// The --zai bootstrap: add the GLM (Z.AI) provider and the default model to
// the ACTIVE dsh profile's Cordis patch file (~/.dsh/profiles/<profile>/
// cordis.patch.yml) — the file the host actually composes entry config from.
// The legacy flat ~/.dsh/settings.yaml was imported once and tombstoned as
// settings.yaml.imported by dsh-settings (ADR: The Packaged Insight 2026-09-11,
// amendment 2026-11-03, D7-D10), so writing it again only bought a re-import
// round-trip per boot. Idempotent — existing entries always win: only MISSING
// keys are added, the operator's other patch entries are never touched.
// Throws ZaiPatchError on an unparsable/non-array patch file; the bin wiring
// turns that into exit 65 (same fail-loud contract as before).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export class ZaiPatchError extends Error {}

export const ZAI_PROVIDER = {
	providers: {
		zai: {
			apiKeyEnv: 'ZAI_API_KEY',
			api: 'openai-completions',
			baseURL: 'https://api.z.ai/api/coding/paas/v4',
			compat: { thinkingFormat: 'zai' },
			models: [
				{ id: 'glm-4.7' },
				{ id: 'glm-5-turbo' },
				{ id: 'glm-5.1' },
				{ id: 'glm-5.2' },
				{
					id: 'glm-5.3',
					name: 'GLM-5.3',
					contextWindow: 1000000,
					maxTokens: 131072,
					input: ['text'],
				},
				{
					id: 'glm-5.3-flash',
					name: 'GLM-5.3-Flash',
					contextWindow: 1000000,
					maxTokens: 131072,
					input: ['text', 'image'],
				},
			],
		},
	},
};

export const ZAI_DEFAULT_MODEL = { provider: 'zai', model: 'glm-5.3-flash' };

const LLM_ENTRY_NAME = '@deepseek-ai/dsh-llm-pi-ai';
const MODEL_ENTRY_NAME = '@deepseek-ai/dsh-agent-default-model';

/** Resolve the patch file the bootstrap writes: DSH_PATCH_PATH override,
 *  else the active profile's cordis.patch.yml (DSH_PROFILE, default web). */
export function zaiPatchPath() {
	if (process.env.DSH_PATCH_PATH !== undefined) return process.env.DSH_PATCH_PATH;
	const profile = process.env.DSH_PROFILE ?? 'web';
	return path.join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml');
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Add the ZAI provider and default model as patch entries when absent.
 *  Returns { added, path } — added lists the dotted keys newly written.
 *  @param {string | undefined} target explicit patch path (tests); default zaiPatchPath() */
export function addZaiProvider(target = zaiPatchPath()) {
	let entries = [];
	if (existsSync(target)) {
		let parsed;
		try {
			parsed = parse(readFileSync(target, 'utf-8'));
		} catch (error) {
			throw new ZaiPatchError(`cannot parse ${target}: ${error?.message ?? error}`);
		}
		if (!Array.isArray(parsed) || parsed.some((row) => !isRecord(row))) {
			throw new ZaiPatchError(`${target} is not a Cordis patch array of entries`);
		}
		entries = parsed;
	}

	const added = [];

	// llm-pi-ai — create the entry when absent, merge zai when its provider map lacks it.
	let llm = entries.find((row) => row.id === 'llm-pi-ai');
	if (!isRecord(llm)) {
		llm = { id: 'llm-pi-ai', name: LLM_ENTRY_NAME, config: {} };
		entries.push(llm);
	}
	if (!isRecord(llm.config)) llm.config = {};
	if (!isRecord(llm.config.providers)) llm.config.providers = {};
	if (!isRecord(llm.config.providers.zai)) {
		llm.config.providers.zai = ZAI_PROVIDER.providers.zai;
		added.push('llm-pi-ai.providers.zai');
	}

	// agent-default-model — the entry IS the setting; absent means unset.
	if (!entries.some((row) => row.id === 'agent-default-model')) {
		entries.push({ id: 'agent-default-model', name: MODEL_ENTRY_NAME, config: ZAI_DEFAULT_MODEL });
		added.push('agent-default-model');
	}

	if (added.length === 0) {
		return { added, path: target };
	}

	mkdirSync(path.dirname(target), { recursive: true });
	const temp = `${target}.${process.pid}.tmp`;
	writeFileSync(temp, stringify(entries), 'utf-8');
	renameSync(temp, target);
	return { added, path: target };
}
