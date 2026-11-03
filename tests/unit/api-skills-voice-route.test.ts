// @vitest-environment node
/**
 * GET /api/skills/voice — the Shelf Voice route seam: buildVoiceMap is the
 * injected stub (the real builder's fs sidecar scan is pinned by
 * insight-config/voice unit coverage elsewhere); this pins the route's own
 * behavior — skillsDir resolution (SHELF_SKILLS_DIR override vs ~/.agents/skills
 * default), the ok/voice wire shape, and engine-failure 503.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const voiceState = vi.hoisted(() => ({
	dir: '',
	throwIt: false,
	map: {} as Record<string, Record<string, { name: string; description: string; whenToUse: string }>>
}));

vi.mock('$lib/server/skills/voice', () => ({
	buildVoiceMap: (dir: string) => {
		voiceState.dir = dir;
		if (voiceState.throwIt) throw new Error('shelf scan exploded');
		return voiceState.map;
	}
}));

import { GET } from '../../src/routes/api/skills/voice/+server';

const getBody = async () => {
	const res = await GET({} as never);
	return { res, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
	delete process.env.SHELF_SKILLS_DIR;
	voiceState.throwIt = false;
	voiceState.map = {
		deployer: { en: { name: 'deployer', description: 'ships things', whenToUse: 'when shipping' } }
	};
});

afterEach(() => {
	delete process.env.SHELF_SKILLS_DIR;
});

describe('GET /api/skills/voice', () => {
	it('defaults the skills dir to ~/.agents/skills and returns the voice map', async () => {
		const { res, body } = await getBody();
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(voiceState.dir).toBe(join(homedir(), '.agents/skills'));
		expect(body.voice).toEqual(voiceState.map);
	});

	it('honors the SHELF_SKILLS_DIR override', async () => {
		process.env.SHELF_SKILLS_DIR = '/tmp/shelf-skills';
		const { res } = await getBody();
		expect(res.status).toBe(200);
		expect(voiceState.dir).toBe('/tmp/shelf-skills');
	});

	it('an empty SHELF_SKILLS_DIR falls back to the ~/.agents/skills default (|| arm)', async () => {
		process.env.SHELF_SKILLS_DIR = '';
		const { res, body } = await getBody();
		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(voiceState.dir).toBe(join(homedir(), '.agents/skills'));
	});

	it('a thrown non-Error still maps to 503 (String(message) arm)', async () => {
		// throw a raw string: (err as Error).message is undefined -> String() => "undefined"
		vi.doMock('$lib/server/skills/voice', () => ({
			buildVoiceMap: () => {
				throw 'raw string failure';
			}
		}));
		vi.resetModules();
		const { GET: freshGet } = (await import('../../src/routes/api/skills/voice/+server')) as typeof import('../../src/routes/api/skills/voice/+server');
		const res = await freshGet({} as never);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, error: 'undefined' });
	});

	it('a failing voice scan maps to 503 with the error message', async () => {
		voiceState.throwIt = true;
		const { res, body } = await getBody();
		expect(res.status).toBe(503);
		expect(body.ok).toBe(false);
		expect(body.error).toBe('shelf scan exploded');
	});
});
