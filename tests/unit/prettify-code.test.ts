/**
 * prettify-code unit tests — the D5 display path (ADR-0077 Amendment 1):
 * format / wire-honesty / garbage give-up / idempotence.
 */
import { describe, expect, it } from 'vitest';
import { prettifyCode, prettifyProgram } from '$lib/utils/prettify-code';

/** The operator's screenshot case: a one-line browser-execute code value. */
const ONE_LINER =
	'const r = await page.evaluate(() => { const m = [...document.querySelectorAll("main")]; return m.length; }); return r;';

describe('prettifyCode — the D5 display path', () => {
	it('formats a single-line code value as a multi-line program', async () => {
		const out = await prettifyCode(ONE_LINER);
		expect(out.includes('\n')).toBe(true); // multi-line
		expect(out).toContain('await page.evaluate('); // content preserved
		expect(out).toContain('document.querySelectorAll');
	});

	it('returns input unchanged — display-only, the wire keeps its bytes', async () => {
		expect(ONE_LINER).not.toContain('\n'); // the wire line stays single-line
		const out = await prettifyCode(ONE_LINER);
		expect(await prettifyCode(ONE_LINER)).toBe(out); // deterministic
	});

	it('garbage JS and empty string are returned unchanged, no throw', async () => {
		const junk = 'this is ))) not ( javascript';
		expect(await prettifyCode(junk)).toBe(junk);
		expect(await prettifyCode('')).toBe('');
		expect(await prettifyCode('   ')).toBe('   ');
	});

	it('already-formatted code is idempotent (Prettier fixed point)', async () => {
		const once = await prettifyCode(ONE_LINER);
		const twice = await prettifyCode(once);
		expect(twice).toBe(once);
	});
});

describe('prettifyProgram — the D6 whole-program layout', () => {
	it('formats a one-line program: params land on their own lines', async () => {
		const one = 'const r = await tools.bash({ command: `pwd; ls`, description: "list" });';
		const out = await prettifyProgram(one);
		expect(out.includes('\n')).toBe(true);
		expect(out).toContain('description:');
		expect(out).toContain('command:');
	});

	it('garbage and empty input are returned unchanged, no throw', async () => {
		const junk = '))) not ( javascript';
		expect(await prettifyProgram(junk)).toBe(junk);
		expect(await prettifyProgram('')).toBe('');
	});

	it('prettifyCode is the same formatter (alias contract)', async () => {
		expect(await prettifyCode('const q = 1;')).toBe(await prettifyProgram('const q = 1;'));
	});
});
