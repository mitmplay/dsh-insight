/**
 * code-programs unit tests — the run_code parser (ADR-0008): args →
 * {code, description, plan}, the tool-plan scan against the patterns
 * observed in session 1fe381df (P1 shim / P2 batch / P3 heredoc),
 * junk honesty (undefined, never throws, never a wrong plan).
 */

import { describe, expect, it } from 'vitest';
import { codeArgTargets, codeProgramPreview, displayCode, expandDisplayValues, isRunCodeTool, parseCodeProgram, planStepTitle, previewArg, splicePrettified } from '$lib/utils/code-programs';

/** Wire-shaped args builder (tool/call.data.arguments). */
function rcArgs(code: string, description?: string): string {
	return JSON.stringify({ ...(description !== undefined ? { description } : {}), code });
}

describe('isRunCodeTool', () => {
	it('matches exactly the wire name', () => {
		expect(isRunCodeTool('run_code')).toBe(true);
		expect(isRunCodeTool('bash')).toBe(false);
		expect(isRunCodeTool('run_codes')).toBe(false);
	});
});

describe('parseCodeProgram — P1 thin shim (67% of session 1fe381df)', () => {
	it('parses the real first-wire example: description + one read step with basename', () => {
		const code = 'const f = await tools.read({ file_path: "/a/b/InlineToolCalls.svelte" });\nconsole.log(f.lines.length);';
		expect(parseCodeProgram(rcArgs(code, 'Read InlineToolCalls component source'))).toEqual({
			code,
			description: 'Read InlineToolCalls component source',
			plan: [{ tool: 'read', arg: 'InlineToolCalls.svelte' }]
		});
	});

	it('a code-only program (no description member) parses with plan only', () => {
		const code = 'const r = await tools.bash({ command: "ls", description: "x" });';
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.description).toBeUndefined();
		expect(p?.plan).toEqual([{ tool: 'bash', arg: 'ls' }]);
	});
});

describe('parseCodeProgram — P2 sequenced batch', () => {
	it('scans tool calls in source order with salient args', () => {
		const code = [
			'const a = await tools.read({ file_path: "/tmp/one.ts" });',
			'const g = await tools.grep({ pattern: "ToolCallDetail", path: "/src" });',
			'const r = await tools.bash({ command: "pnpm vitest run\nexit 0", description: "run" });'
		].join('\n');
		const p = parseCodeProgram(rcArgs(code, 'Three steps'));
		expect(p?.plan).toEqual([
			{ tool: 'read', arg: 'one.ts' },
			{ tool: 'grep', arg: 'ToolCallDetail' },
			{ tool: 'bash', arg: 'pnpm vitest run' } // first line only
		]);
	});

	it('braces inside strings do not end the args object early', () => {
		const code = 'await tools.grep({ pattern: "{code, description}?" });';
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.plan).toEqual([{ tool: 'grep', arg: '{code, description}?' }]);
	});

	it('salient args keep their first line, uncapped — capping is a surface concern', () => {
		const long = 'x'.repeat(80);
		const code = `await tools.bash({ command: "${long}\\nsecond line" });`;
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.plan[0]?.arg).toBe(long); // first line, full width
	});
});

describe('parseCodeProgram — honesty', () => {
	it('junk, non-object, and missing-code args parse to undefined', () => {
		expect(parseCodeProgram(undefined)).toBeUndefined();
		expect(parseCodeProgram('{not json')).toBeUndefined();
		expect(parseCodeProgram('"text"')).toBeUndefined();
		expect(parseCodeProgram('[]')).toBeUndefined();
		expect(parseCodeProgram('{"description":"no code"}')).toBeUndefined();
		expect(parseCodeProgram('{"code":""}')).toBeUndefined();
	});

	it('pure-logic programs scan to an empty plan; unclosed calls are skipped', () => {
		expect(parseCodeProgram(rcArgs('console.log(1); return 2;'))?.plan).toEqual([]);
		expect(parseCodeProgram(rcArgs('const x = tools.run('))?.plan).toEqual([]);
	});

	it('plan is bounded (MAX_PLAN_STEPS)', () => {
		const code = Array.from({ length: 12 }, (_, i) => `await tools.read({ file_path: "/f${i}" });`).join('\n');
		expect(parseCodeProgram(rcArgs(code))?.plan).toHaveLength(8);
	});
});

describe('planStepTitle — chip vocabulary, raw name for unknowns', () => {
	it('known tools use the variant title; unknown keep the wire name', () => {
		expect(planStepTitle('bash')).toBe('Bash');
		expect(planStepTitle('read')).toBe('Read');
		expect(planStepTitle('todo_write')).toBe('todo_write');
	});
});

describe('codeProgramPreview — the peek one-liner ladder (session 1fe381df evidence)', () => {
	it('description wins when present', () => {
		const code = 'await tools.read({ file_path: "/a.ts" });';
		expect(codeProgramPreview(rcArgs(code, 'Read the file'))).toBe('Read the file');
	});

	it('the schema-error retries (no description) show the first plan step, not the code head', () => {
		// seq 541 wire shape: complete single-line bash shim, no description
		// member (the omission IS the error), red result on the chip.
		const code = 'const r = await tools.bash({ command: "pwd; echo ---; ls -la ~/agentic-ai 2>/dev/null | head -30; echo ---; ls ~/openclaw-insight" });';
		const command = 'pwd; echo ---; ls -la ~/agentic-ai 2>/dev/null | head -30; echo ---; ls ~/openclaw-insight';
		expect(codeProgramPreview(rcArgs(code))).toBe('Bash ' + command); // full — under the peek cap, no early ellipsis
	});

	it('a plan step without a salient arg shows the title alone', () => {
		expect(codeProgramPreview(rcArgs('await tools.todo_write({ todos: [] });'))).toBe('todo_write');
	});

	it('no description, no plan → first code line, capped at 120', () => {
		expect(codeProgramPreview(rcArgs('console.log(1); return 2;'))).toBe('console.log(1); return 2;');
		const line = 'console.log("' + 'x'.repeat(200) + '");';
		expect(codeProgramPreview(rcArgs(line))).toBe(line.slice(0, 120) + '…'); // truncate keeps max, ellipsis rides after
	});

	it('every rung caps at 120 — a pathologically long description too', () => {
		expect(codeProgramPreview(rcArgs('return 1;', 'd'.repeat(150)))).toBe('d'.repeat(120) + '…');
	});

	it('junk and missing args parse to empty (caller falls to the raw preview)', () => {
		expect(codeProgramPreview(undefined)).toBe('');
		expect(codeProgramPreview('{not json')).toBe('');
	});
});

/* ─── ADR-0077 — the Readable Command: displayCode + boundary-cut peek ─── */

/** The ADR-0077 exemplar: a one-line escaped grep/git-log command. */
const EXEMPLAR_CMD = 'grep -rn \\"displayCode\\" src | head -20; git log --oneline -5 -- src/lib/utils/code-programs.ts';
const EXEMPLAR_CODE = 'const r = await tools.bash({ command: "' + EXEMPLAR_CMD + '", description: "Check displayCode usage" });';

/** Wire-shaped program code builder — displayCode consumes program.code (the decoded code), never argsRaw. */
function cmdCode(command: string): string {
	return 'await tools.bash({ command: "' + command + '" });';
}

describe('displayCode — reformat (ADR-0077 D1)', () => {
	it('the ADR-0077 exemplar renders as a backtick multi-line template literal', () => {
		const out = displayCode(EXEMPLAR_CODE);
		const stmts = out.split('\n');
		expect(stmts).toHaveLength(4); // opening backtick + 2 statements + closing backtick
		expect(stmts[0]).toContain('command: \u0060');
		expect(stmts[1]!.trim()).toBe('grep -rn "displayCode" src | head -20;');
		expect(stmts[1]).toContain('grep'); // first line is the grep
		expect(stmts[2]!.trim()).toBe('git log --oneline -5 -- src/lib/utils/code-programs.ts;');
		expect(stmts[3].startsWith('\u0060')).toBe(true); // closing backtick; object-line remainder rides after
		expect(out).not.toContain('\\"'); // no escaped quotes in the display copy
	});

	it('the wire string still parses identically through parseCodeProgram (display-only)', () => {
		expect(parseCodeProgram(rcArgs(EXEMPLAR_CODE))).toEqual(parseCodeProgram(rcArgs(EXEMPLAR_CODE)));
		expect(parseCodeProgram(rcArgs(EXEMPLAR_CODE))?.plan[0]?.tool).toBe('bash'); // wire still parses; salientArg's escaped-quote boundary is the ADR-0008 contract, untouched
	});

	it('statements are indented one level under the opening backtick', () => {
		const out = displayCode(cmdCode('pwd; echo hi'));
		expect(out.split('\n').slice(1, 3).every((l) => l.startsWith('\t'))).toBe(true);
	});
});

describe('displayCode — the verbatim gate (ADR-0077 D2)', () => {
	it('a value containing an escaped newline is returned verbatim', () => {
		const code = 'await tools.bash({ command: "echo one\\necho two" });';
		expect(displayCode(code)).toBe(code);
	});

	it('a value containing a backtick is returned verbatim', () => {
		const code = 'await tools.bash({ command: "echo \\u0060pwd\\u0060" });';
		expect(displayCode(code)).toBe(code);
	});

	it('a value containing ${ is returned verbatim', () => {
		const code = 'await tools.bash({ command: "echo ${HOME}" });';
		expect(displayCode(code)).toBe(code);
	});

	it('no command literal in code: input returned unchanged', () => {
		const code = 'const x = 1;\nconsole.log(x);';
		expect(displayCode(code)).toBe(code);
	});

	it('non-JSON garbage and malformed escapes: unchanged, no throw', () => {
		expect(displayCode('\\u0000not even code\\u0000')).toBe('\\u0000not even code\\u0000');
		expect(displayCode('await tools.bash({ command: "bad \\z escape" });')).toBe('await tools.bash({ command: "bad \\z escape" });');
	});

	it('semicolons inside quotes and $( ) are NOT split', () => {
		const single = displayCode(cmdCode("echo 'a;b'; echo c"));
		expect(single.split('\n')).toHaveLength(4); // 2 statements + backticks; ' });' rides the closing line
		const dbl = displayCode(cmdCode('echo \\"x;y\\"; echo z')); // escaped quotes, the wire-real form
		expect(dbl.split('\n')).toHaveLength(4);
		const sub = displayCode(cmdCode('echo $(echo a;b); echo c'));
		expect(sub.split('\n')).toHaveLength(4);
	});

	it('unbalanced quote: verbatim give-up (ADR-0077 §7)', () => {
		const code = 'await tools.bash({ command: "echo \'unfinished" });';
		expect(displayCode(code)).toBe(code);
	});
});

describe('previewArg — the boundary-cut peek (ADR-0077 D3)', () => {
	it('exemplar preview cut at the last top-level ; strictly before the cap, one line, ellipsis', () => {
		const out = previewArg('bash', EXEMPLAR_CMD, 40);
		expect(out.endsWith(';…')).toBe(true); // ends at the head -20; boundary, not mid-token
		expect(out.length).toBeLessThanOrEqual(41);
		expect(out.includes('\n')).toBe(false);
	});

	it('exemplar under the peek cap stays whole', () => {
		expect(previewArg('bash', EXEMPLAR_CMD, 120)).toBe(EXEMPLAR_CMD);
	});

	it('a command shorter than the cap is unchanged', () => {
		expect(previewArg('bash', 'pwd; ls', 120)).toBe('pwd; ls');
	});

	it('a boundary-less command over the cap falls back to the plain cap', () => {
		const long = 'echo ' + 'x'.repeat(130);
		expect(previewArg('bash', long, 120)).toBe(long.slice(0, 120) + '…');
	});

	it('non-shell args keep the plain cap', () => {
		const path = '/a/' + 'b'.repeat(130);
		expect(previewArg('read', path, 60)).toBe(path.slice(0, 60) + '…');
	});

	it('codeProgramPreview first-step path uses the boundary cut; description-only unchanged', () => {
		const long = 'echo one; echo two; ' + 'x'.repeat(115);
		const preview = codeProgramPreview(rcArgs(cmdCode(long)));
		expect(preview.startsWith('Bash echo one;')).toBe(true);
		expect(preview.endsWith('echo two;…')).toBe(true); // cut at the last top-level ; before the 120 cap
		expect(preview.includes('\n')).toBe(false);
		const short = codeProgramPreview(rcArgs(cmdCode(EXEMPLAR_CMD))); // ~93 chars, under the cap: whole line
		expect(short.startsWith('Bash grep')).toBe(true);
		expect(short.endsWith('…')).toBe(false);
		expect(codeProgramPreview(rcArgs('await tools.bash({ command: "pwd; ls" });', 'List dir'))).toBe('List dir');
	});
});

/* ─── Wave 4 — D5 (ADR-0077 Amendment 1): code args speak their language ─── */

/** The OPERATOR'S SCREENSHOT CASE (2026-11-22): one-line code-literal program. */
const SCREENSHOT_CODE_VALUE = 'const r = await page.evaluate(() => { const m = [...document.querySelectorAll("main")]; return m.length; }); return r;';
const SCREENSHOT_PROGRAM = 'return await tools.mcp__browse__execute({ code: `' + SCREENSHOT_CODE_VALUE + '` });';

const PRETTY_FAKE = 'const r = await page.evaluate(() => {\n\tconst m = [...document.querySelectorAll("main")];\n\treturn m.length;\n});\n\nreturn r;';

describe('codeArgTargets — the D5 language map targets', () => {
	it('finds the single-line code-literal value in the screenshot program', () => {
		expect(codeArgTargets(SCREENSHOT_PROGRAM)).toEqual([SCREENSHOT_CODE_VALUE]);
	});

	it('double-quoted code literals decode; multi-line decoded values stay verbatim', () => {
		expect(codeArgTargets('await tools.mcp__x({ code: "a();\\nb()" });')).toEqual([]); // decoded is multi-line → D2 verbatim
		expect(codeArgTargets('await tools.mcp__x({ code: "a(); b()" });')).toEqual(['a(); b()']);
	});

	it('multi-line, empty, and code-less programs have no targets', () => {
		expect(codeArgTargets(SCREENSHOT_CODE_VALUE)).toEqual([]); // not a code: literal at all
		expect(codeArgTargets('await tools.mcp__x({ code: `\n  already();\n  multiline();\n` });')).toEqual([]);
		expect(codeArgTargets('await tools.mcp__x({ code: `` });')).toEqual([]);
		expect(codeArgTargets(cmdCode('pwd; ls'))).toEqual([]); // bash commands are D1 territory
	});
});

describe('splicePrettified — the D5 display splice', () => {
	it('the screenshot program renders the formatted block; the WIRE string is untouched', () => {
		const out = splicePrettified(SCREENSHOT_PROGRAM, new Map([[SCREENSHOT_CODE_VALUE, PRETTY_FAKE]]));
		expect(out.split('\n').length).toBeGreaterThan(3); // multi-line now
		expect(out).toContain('const r = await page.evaluate(() => {');
		expect(SCREENSHOT_PROGRAM.includes('\n')).toBe(false); // wire line still one line
	});

	it('empty map and unmapped literals return the program unchanged', () => {
		expect(splicePrettified(SCREENSHOT_PROGRAM, new Map())).toBe(SCREENSHOT_PROGRAM);
		expect(splicePrettified(SCREENSHOT_PROGRAM, new Map([['other value', PRETTY_FAKE]]))).toBe(SCREENSHOT_PROGRAM);
	});

	it('bash command handling is byte-identical to Wave 1 (no regression)', () => {
		const bashDisplay = displayCode(cmdCode('pwd; echo hi'));
		expect(bashDisplay.split('\n').length).toBe(4); // bash splitter untouched by D5
		expect(splicePrettified(bashDisplay, new Map([[SCREENSHOT_CODE_VALUE, PRETTY_FAKE]]))).toBe(bashDisplay);
	});
});

/* ─── Wave 5 — D6 (ADR-0077 Amendment 2): prettier layout + value expansion ─── */

describe('expandDisplayValues — bash command split (D6)', () => {
	it('a single-line BACKTICK command splits at top-level ; (kept)', () => {
		const code = 'await tools.bash({ command: `cd /x; grep version package.json | head -1` });';
		const out = expandDisplayValues(code);
		expect(out.includes('\n')).toBe(true);
		const lines = out.split('\n');
		expect(lines.some((l) => l.includes('cd /x;'))).toBe(true);
		expect(lines.some((l) => l.includes('grep version package.json | head -1'))).toBe(true);
		expect(code.includes('\n')).toBe(false); // wire untouched
	});

	it('top-level && splits with EVERY continued line ending `&& \\`', () => {
		const code = 'await tools.bash({ command: `a && b && c` });';
		const out = expandDisplayValues(code);
		const lines = out.split('\n').map((l) => l.trim());
		expect(lines[1]).toBe('a && \\');
		expect(lines[2]).toBe('b && \\');
		expect(lines[3]).toBe('c;'); // statement terminator (Wave 1 normalization) — still bare, copy-paste-runnable
	});

	it('mixed ; and && statements split, copy-paste-runnable', () => {
		const code = 'await tools.bash({ command: `a && b; c` });';
		const out = expandDisplayValues(code);
		const lines = out.split('\n').map((l) => l.trim());
		expect(lines[1]).toBe('a && \\');
		expect(lines[2]).toBe('b;');
		expect(lines[3]).toBe('c;');
	});

	it('double-quoted commands take the same split path (Wave 1 semantics)', () => {
		const out = expandDisplayValues(cmdCode('pwd; ls'));
		expect(out.split('\n').length).toBeGreaterThan(2);
		expect(out).toContain('pwd;');
		expect(out).toContain('ls;');
	});

	it('already-multi-line, gated, and no-gain commands stay verbatim', () => {
		const multi = 'await tools.bash({ command: `a;\nb;` });';
		expect(expandDisplayValues(multi)).toBe(multi);
		expect(expandDisplayValues(cmdCode('pwd'))).toBe(cmdCode('pwd')); // single line, nothing to split
		const gated = 'await tools.bash({ command: `echo ${HOME}` });';
		expect(expandDisplayValues(gated)).toBe(gated);
	});

	it('dangling && and unbalanced quotes: verbatim give-up', () => {
		const dangling = 'await tools.bash({ command: `a && ` });';
		expect(expandDisplayValues(dangling)).toBe(dangling);
		const unbalanced = "await tools.bash({ command: \"echo 'unfinished\" });";
		expect(expandDisplayValues(unbalanced)).toBe(unbalanced);
	});
});

describe('expandDisplayValues — new_string/content expansion (D6)', () => {
	it('edit new_string escaped newlines expand to real newlines', () => {
		const code = 'await tools.edit({ file_path: "/f", old_string: "x", new_string: "line1\\nline2\\nline3" });';
		const out = expandDisplayValues(code);
		expect(out).toContain('new_string: `line1\nline2\nline3`');
		expect(code.includes('\n')).toBe(false); // wire untouched
	});

	it('write content escapes expand; ${ values stay verbatim', () => {
		const content = 'await tools.write({ file_path: "/f", content: "a\\nb" });';
		expect(expandDisplayValues(content)).toContain('content: `a\nb`');
		const dollar = 'await tools.write({ file_path: "/f", content: "a\\n${x}\\nb" });';
		expect(expandDisplayValues(dollar)).toBe(dollar); // template could mangle — verbatim
	});

	it('single-line values stay verbatim; content expansion is keyed, not tool-scoped', () => {
		expect(expandDisplayValues('await tools.edit({ file_path: "/f", new_string: "flat" });')).toBe('await tools.edit({ file_path: "/f", new_string: "flat" });');
		// contract: any `new_string`/`content` key expands (only edit/write carry them on the wire)
	});

	it('legacy double-escaped values (literal backslash-n text) expand to real newlines', () => {
		// the harness-era encoding: the code literal carries \n as literal TEXT
		const literalBackslashN = 'line1' + String.fromCharCode(92) + 'nline2' + String.fromCharCode(92) + 'nline3';
		const program = 'await tools.edit({ file_path: "/f", new_string: ' + JSON.stringify(literalBackslashN) + ' });';
		const out = expandDisplayValues(program);
		expect(out).toContain('new_string: `line1\nline2\nline3`');
		expect(program.includes('\n')).toBe(false); // wire untouched
	});
});
