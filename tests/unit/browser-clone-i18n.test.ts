import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'messages');
const LOCALES = ['en', 'zh', 'id', 'es'] as const;

describe('clone i18n parity (task 2.3-T, ADR-0046)', () => {
	it('every locale defines browserCloneHint and browserCloneFallback non-empty', () => {
		for (const loc of LOCALES) {
			const catalog = JSON.parse(readFileSync(join(ROOT, loc + '.json'), 'utf8')) as Record<string, string>;
			expect(typeof catalog.browserCloneHint, loc + '.browserCloneHint type').toBe('string');
			expect(catalog.browserCloneHint.length, loc + '.browserCloneHint non-empty').toBeGreaterThan(0);
			expect(typeof catalog.browserCloneFallback, loc + '.browserCloneFallback type').toBe('string');
			expect(catalog.browserCloneFallback.length, loc + '.browserCloneFallback non-empty').toBeGreaterThan(0);
		}
	});
});
