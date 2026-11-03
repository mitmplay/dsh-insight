import { describe, expect, it } from 'vitest';

// ADR-0045 amendment 3 D7 — the pure session-resolution core of both glass
// drivers. The incident: sessions[0] made X2 drive X1's glass.
import { pickSession } from '../../.agents/skills/glass-url/scripts/_connect.mjs';

const S = (id: string, ownerSessionId: string | null, createdAt = '2026-10-30T00:00:00Z') => ({ id, ownerSessionId, createdAt });

describe('pickSession (D7: the glass answers by name)', () => {
	const mine = 'session-x2';

	it('exact owner match wins — never index 0', () => {
		const r = pickSession([S('x1', 'session-x1'), S('x2', mine)], mine);
		expect(r.session?.id).toBe('x2');
		expect(r.degraded).toBe(false);
	});

	it('multiple own glasses: newest wins with a note', () => {
		const r = pickSession([S('a', mine, '2026-10-30T01:00:00Z'), S('b', mine, '2026-10-30T02:00:00Z')], mine);
		expect(r.session?.id).toBe('b');
		expect(String(r.note)).toContain('newest');
	});

	it('own glass dead + others live: loud refusal, not a silent steal', () => {
		const r = pickSession([S('x1', 'session-x1')], mine);
		expect(r.session).toBeNull();
		expect(String(r.error)).toContain('no glass owned by');
	});

	it('single legacy session (null owner): degraded back-compat', () => {
		const r = pickSession([S('legacy', null)], mine);
		expect(r.session?.id).toBe('legacy');
		expect(r.degraded).toBe(true);
	});

	it('legacy + foreign live: refusal (would be a cross-session steal)', () => {
		const r = pickSession([S('legacy', null), S('x1', 'session-x1')], mine);
		expect(r.session).toBeNull();
	});

	it('no env id + one session: degraded back-compat', () => {
		const r = pickSession([S('only', null)], undefined);
		expect(r.session?.id).toBe('only');
		expect(r.degraded).toBe(true);
	});

	it('no env id + multiple sessions: refuse to guess', () => {
		const r = pickSession([S('a', 'session-x1'), S('b', 'session-x2')], undefined);
		expect(r.session).toBeNull();
		expect(String(r.error)).toContain('refusing to guess');
	});
});

describe('identityFrom (explicit beats inherited)', () => {
  it('prefers the --owner-session flag over env', async () => {
    const { identityFrom } = await import('../../.agents/skills/glass-url/scripts/_connect.mjs');
    process.env.GLASS_OWNER_SESSION = 'session-glass';
    process.env.DSH_SESSION_ID = 'session-dsh';
    expect(identityFrom(['yt', '--owner-session', 'session-flag'])).toBe('session-flag');
  });
  it('falls back to GLASS_OWNER_SESSION, then DSH_SESSION_ID', async () => {
    const { identityFrom } = await import('../../.agents/skills/glass-url/scripts/_connect.mjs');
    delete process.env.GLASS_OWNER_SESSION;
    process.env.DSH_SESSION_ID = 'session-dsh';
    expect(identityFrom([])).toBe('session-dsh');
    process.env.GLASS_OWNER_SESSION = 'session-glass';
    expect(identityFrom([])).toBe('session-glass');
  });
  it('returns undefined when nothing is set', async () => {
    const { identityFrom } = await import('../../.agents/skills/glass-url/scripts/_connect.mjs');
    delete process.env.GLASS_OWNER_SESSION;
    delete process.env.DSH_SESSION_ID;
    expect(identityFrom([])).toBeUndefined();
  });
});
