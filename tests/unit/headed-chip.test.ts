import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Task 2.2-T — the chip pins for The Headed Downgrade: plain click false,
// Shift true, NO dialog possible; i18n parity ×4 with the borrow keys gone.

const chip = readFileSync('src/lib/components/conversation/header/BrowserButton.svelte', 'utf8');

describe('headed chip (task 2.2-T)', () => {
	it('Shift passes straight through as the intent — no confirm dialog', () => {
		expect(chip).toContain('onOpenBrowser(event.shiftKey)');
	});

	it('no dialog is possible — no window.confirm, no DSI-in-Chrome detection, no borrow keys', () => {
		expect(chip).not.toContain('window.confirm');
		expect(chip).not.toContain('confirm(');
		expect(chip).not.toContain('dsiRunsInChrome');
		expect(chip).not.toContain('browserBorrow');
		expect(chip).toContain('browserHeadedHint()');
	});

	it('i18n parity ×4: every locale has browserHeadedHint and no browserBorrow* keys', () => {
		const locales = readdirSync('messages').filter((f) => f.endsWith('.json'));
		expect(locales.length).toBe(4);
		for (const f of locales) {
			const d = JSON.parse(readFileSync('messages/' + f, 'utf8')) as Record<string, string>;
			expect(typeof d.browserHeadedHint, f).toBe('string');
			expect(d.browserHeadedHint, f).toContain('HEADED');
			expect(Object.keys(d).filter((k) => k.startsWith('browserBorrow')), f).toEqual([]);
		}
	});

	it('borrow.ts is deleted and zero-referenced in code', async () => {
		expect(readdirSync('src/lib/server/browser')).toEqual(['registry.ts', 'relay.ts']);
		for (const dir of ['src/lib', 'src/routes']) {
			const { execSync } = await import('node:child_process');
			const hits = execSync(
				'grep -rniE "borrow|last-used|host-root" --include=*.ts --include=*.svelte -l ' + dir + ' || true',
				{ encoding: 'utf8' }
			).trim();
			for (const file of hits ? hits.split('\n') : []) {
				const src = readFileSync(file, 'utf8');
				// the zero-CODE gate: comment-only audit-trail mentions are kept —
				// strip block comments (any line, not just *-prefixed) and // lines
				const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
				expect(code, file).not.toMatch(/borrow|last-used|host-root/i);
			}
		}
	});
});
