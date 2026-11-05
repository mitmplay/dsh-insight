import { describe, expect, it } from 'vitest';
import { launchIdentityFor } from '../../src/lib/server/browser/profile-clone.js';

describe('launchIdentityFor (task 1.3-T)', () => {
	it('plain launch keeps the spoof trio', () => {
		const id = launchIdentityFor(false);
		expect(id.userAgent).toContain('Windows NT 10.0');
		expect(id.timezoneId).toBe('America/New_York');
		expect(id.locale).toBe('en-US');
	});

	it('cloned launch drops the spoof trio — the real identity is honest (ADR-0046 D3)', () => {
		const id = launchIdentityFor(true);
		expect(id.userAgent).toBeUndefined();
		expect(id.timezoneId).toBeUndefined();
		expect(id.locale).toBeUndefined();
	});
});
