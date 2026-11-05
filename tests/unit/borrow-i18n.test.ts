import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'messages');
const LOCALES = ['en', 'zh', 'id', 'es'] as const;

describe('borrow i18n (task 2.2-T, ADR-0047)', () => {
	it('every locale defines browserBorrowHint and browserBorrowQuitFirst non-empty', () => {
		for (const loc of LOCALES) {
			const catalog = JSON.parse(readFileSync(join(ROOT, loc + '.json'), 'utf8')) as Record<string, string>;
			expect(typeof catalog.browserBorrowHint, loc + ' hint type').toBe('string');
			expect(catalog.browserBorrowHint.length, loc + ' hint non-empty').toBeGreaterThan(0);
			expect(typeof catalog.browserBorrowQuitFirst, loc + ' quitFirst type').toBe('string');
			expect(catalog.browserBorrowQuitFirst.length, loc + ' quitFirst non-empty').toBeGreaterThan(0);
		}
	});

	it('the cancelled clone keys are GONE from every locale (D0 removal)', () => {
		for (const loc of LOCALES) {
			const catalog = JSON.parse(readFileSync(join(ROOT, loc + '.json'), 'utf8')) as Record<string, string>;
			expect(catalog.browserCloneHint, loc + ' clone hint gone').toBeUndefined();
			expect(catalog.browserCloneFallback, loc + ' clone fallback gone').toBeUndefined();
		}
	});
});
