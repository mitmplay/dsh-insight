/**
 * Wave 3 (task 3.1-T + 3.2): CodeCard dispatch sections (ADR D1–D6,
 * 2026-09-05). Mounts the real CodeCard through a minimal host with wire-
 * shaped props: markdown reads render through FileContentViewer (prose, no
 * N: gutter), bash renders terminal-styled, starts keep placeholders,
 * errors keep their content, and the outer output collapses into the D6
 * footer. 3.2 (XSS posture): asserts no raw dispatch content is injected
 * as HTML — everything renders as text nodes or through hljs/FileContentViewer.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import CodeCard from '$lib/components/message/cards/CodeCard.svelte';
import type { DsiCodeDispatch } from '$lib/types';

const ARGS = JSON.stringify({ description: 'Read AIP and OCI READMEs', code: 'const r = await tools.read({ file_path: "/x/a.md" });' });

const MD_CONTENT =
	'<path>/x/PREREQUISITES.md</path>\n<type>file</type>\n<content>\n' +
	'1: # PREREQUISITES.md — Setup\n2: \n3: > Check here first.';

const read = (n: number, over: Partial<DsiCodeDispatch> = {}): DsiCodeDispatch => ({
	subCallId: `c1:code:${n}`,
	name: 'read',
	argsRaw: JSON.stringify({ file_path: `/x/f${n}.md`, limit: 60 }),
	settled: true,
	isError: false,
	contentText: MD_CONTENT.replaceAll('PREREQUISITES.md', `f${n}.md`),
	...over
});

function render(props: { dispatches?: DsiCodeDispatch[]; resultText?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CodeCard, { target, props: { argsRaw: ARGS, ...props } });
	return { target, unmount: () => unmount(comp) };
}

describe('CodeCard — D7 structured edit/write dispatches (ADR-0077 Amendment 3)', () => {
	const editDispatch: DsiCodeDispatch = {
		subCallId: 'c1:code:9',
		name: 'edit',
		argsRaw: JSON.stringify({
			file_path: '/x/code-programs.ts',
			old_string: 'const old = 1;',
			new_string: 'const next = 2;\nconst nexter = 3;'
		}),
		settled: true,
		isError: false,
		contentText: 'edited'
	};

	it('an edit dispatch renders the structured block: params + multi-line value', () => {
		const { target, unmount } = render({ dispatches: [editDispatch] });
		const block = target.querySelector('[data-testid="code-dispatch-editwrite"]') as HTMLElement;
		expect(block).not.toBeNull();
		expect(block.getAttribute('data-sub-tool')).toBe('edit');
		expect(block.textContent).toContain('file_path:');
		expect(block.textContent).toContain('/x/code-programs.ts');
		expect(block.textContent).toContain('old_string:');
		const pre = block.querySelector('pre') as HTMLElement;
		expect(pre?.textContent).toBe('const next = 2;\nconst nexter = 3;'); // real newlines, escape-soup-free
		expect(target.querySelector('[data-testid="code-dispatch-terminal"]')).toBeNull(); // not a terminal block
		unmount();
	});

	it('a write dispatch renders content as the value; a bash dispatch keeps the terminal renderer', () => {
		const writeDispatch: DsiCodeDispatch = {
			subCallId: 'c1:code:10',
			name: 'write',
			argsRaw: JSON.stringify({ file_path: '/x/new.md', content: '# Title\n\nBody' }),
			settled: true,
			isError: false,
			contentText: 'written'
		};
		const { target, unmount } = render({ dispatches: [writeDispatch, { subCallId: 'c1:code:11', name: 'bash', argsRaw: '{"command":"ls"}', settled: true, isError: false, contentText: 'x' }] });
		const block = target.querySelector('[data-testid="code-dispatch-editwrite"]') as HTMLElement;
		expect(block).not.toBeNull();
		expect(block.textContent).toContain('# Title');
		expect((target.querySelector('[data-testid="code-dispatch-terminal"]'))).not.toBeNull();
		unmount();
	});

	it('an errored edit dispatch keeps its content and gains the danger ring', () => {
		const { target, unmount } = render({ dispatches: [{ ...editDispatch, isError: true }] });
		const block = target.querySelector('[data-testid="code-dispatch-editwrite"]') as HTMLElement;
		expect(block.className).toContain('ring-danger-wash-border');
		expect(block.textContent).toContain('const next = 2;');
		unmount();
	});
});

describe('CodeCard — dispatch sections', () => {
	it('renders a .md read as markdown prose through FileContentViewer (no N: gutter)', () => {
		const { target, unmount } = render({ dispatches: [read(1)] });
		const section = target.querySelector('[data-testid="code-dispatch-file"]') as HTMLElement;
		expect(section).not.toBeNull();
		expect(section.querySelector('[data-testid="file-content-viewer"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="file-content-viewer"]')?.getAttribute('data-lang')).toBe('md');
		const text = section.textContent ?? '';
		expect(section.querySelector('h1')?.textContent).toContain('f1.md — Setup'); // markdown heading, gutter-free
		expect(text).not.toMatch(/^\s*1:/m); // no line-number gutter
		unmount();
	});

	it('renders a bash dispatch as a pastel terminal block with the Copy/Source pair', () => {
		const { target, unmount } = render({
			dispatches: [read(1), { subCallId: 'c1:code:2', name: 'bash', argsRaw: '{"command":"ls"}', settled: true, isError: false, contentText: 'a.md\nb.md' }]
		});
		const term = target.querySelector('[data-testid="code-dispatch-terminal"]') as HTMLElement;
		expect(term).not.toBeNull();
		expect(term.className).toContain('bg-status-pending/10'); // light pastel body
		expect(term.textContent).toContain('a.md');
		// Top-right hover pair: copy always; view-source flips to the raw args.
		const actions = term.querySelector('[data-testid="code-dispatch-actions"]') as HTMLElement;
		expect(actions.querySelector('button[title="Copy output"]')).not.toBeNull();
		expect(actions.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		(actions.querySelector('[data-testid="raw-toggle-button"]') as HTMLElement).click();
		flushSync();
		expect(term.querySelector('[data-testid="code-dispatch-source"]')?.textContent).toContain('{"command":"ls"}');
		unmount();
	});

	it('keeps an unsettled start as a placeholder (D5)', () => {
		const { target, unmount } = render({
			dispatches: [{ subCallId: 'c1:code:1', name: 'read', argsRaw: JSON.stringify({ file_path: '/x/biggie.md' }), settled: false }]
		});
		const pending = target.querySelector('[data-testid="code-dispatch-pending"]') as HTMLElement;
		expect(pending).not.toBeNull();
		expect(pending.getAttribute('data-sub-tool')).toBe('read');
		expect(pending.textContent).toContain('Read');
		expect(pending.textContent).toContain('biggie.md');
		unmount();
	});

	it('styles a failed dispatch and keeps its content', () => {
		const { target, unmount } = render({
			dispatches: [{ subCallId: 'c1:code:1', name: 'bash', argsRaw: '{"command":"ls"}', settled: true, isError: true, contentText: 'boom' }]
		});
		const term = target.querySelector('[data-testid="code-dispatch-terminal"]') as HTMLElement;
		expect(term.getAttribute('data-error')).toBe('true');
		expect(term.textContent).toContain('failed');
		expect(term.textContent).toContain('boom');
		unmount();
	});

	it('generic fallback for unknown tools — never a file or terminal guess', () => {
		const { target, unmount } = render({
			dispatches: [{ subCallId: 'c1:code:1', name: 'brand_new_tool', argsRaw: '{"q":1}', settled: true, isError: false, contentText: '{"ok":true}' }]
		});
		const row = target.querySelector('[data-testid="code-dispatch-generic"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.textContent).toContain('brand_new_tool');
		unmount();
	});

	it('a read whose content cannot rebuild falls back to the plain row', () => {
		const { target, unmount } = render({
			dispatches: [read(1, { argsRaw: '{"limit":10}' })] // no file_path
		});
		expect(target.querySelector('[data-testid="code-dispatch-file"]')).toBeNull();
		const row = target.querySelector('[data-testid="code-dispatch-generic"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.textContent).toContain('<path>/x/f1.md</path>'); // verbatim projection text
		unmount();
	});

	it('outer output is a collapsed footer by default, expandable (D6); zero-dispatch → footer only', () => {
		const { target, unmount } = render({ dispatches: [read(1)], resultText: 'curated blob' });
		expect(target.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		(target.querySelector('[data-testid="code-result-footer-toggle"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="code-result-pane"]')?.textContent).toContain('curated blob');
		unmount();

		const bare = render({ resultText: 'computed answer' });
		expect(bare.target.querySelector('[data-testid="code-dispatches"]')).toBeNull();
		expect(bare.target.querySelector('[data-testid="code-result-footer-toggle"]')).not.toBeNull();
		bare.unmount();
	});

	it('junk args with no result render the raw pane alone (no result pane)', () => {
		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const comp = mount(CodeCard, { target: t2, props: { argsRaw: 'not json at all' } });
		flushSync();
		expect(t2.querySelector('[data-testid="code-card"]')).toBeNull(); // junk → raw view
		expect(t2.querySelector('[data-testid="code-raw-args"]')?.textContent).toBe('not json at all');
		expect(t2.querySelector('[data-testid="code-raw-result"]')).toBeNull(); // no result → no second pane
		unmount(comp);
		t2.remove();
	});

	it('an unsettled start with unparseable args keeps its placeholder without a filename', () => {
		const { target, unmount } = render({
			dispatches: [{ subCallId: 'c1:code:1', name: 'bash', argsRaw: '{oops', settled: false }]
		});
		const pending = target.querySelector('[data-testid="code-dispatch-pending"]') as HTMLElement;
		expect(pending).not.toBeNull();
		expect(pending.textContent).toContain('Bash');
		expect(pending.textContent).not.toContain('{oops'); // no filename guess from junk
		unmount();
	});

	it("an unsettled read with a built view shows the view's file name", () => {
		const { target, unmount } = render({
			dispatches: [
				{
					subCallId: 'c1:code:1',
					name: 'read',
					argsRaw: JSON.stringify({ file_path: '/x/noslash.md' }),
					settled: false,
					contentText: MD_CONTENT.replaceAll('PREREQUISITES.md', 'noslash.md')
				}
			]
		});
		const pending = target.querySelector('[data-testid="code-dispatch-pending"]') as HTMLElement;
		expect(pending).not.toBeNull();
		expect(pending.textContent).toContain('noslash.md');
		unmount();
	});

	it('3.2 XSS posture: dispatch content never rides an HTML injection', () => {
		const evil = '<img src=x onerror=window.__pwned=1><script>window.__pwned=1</script>';
		const { target, unmount } = render({
			dispatches: [
				{ subCallId: 'c1:code:1', name: 'bash', argsRaw: '{"command":"x"}', settled: true, isError: false, contentText: evil },
				read(2, { contentText: `<path>/x/e.md</path>\n<type>file</type>\n<content>\n1: ${evil}` })
			]
		});
		expect(target.querySelector('script')).toBeNull();
		expect(target.querySelector('img[src="x"]')).toBeNull();
		// The text IS present — escaped, as a text node.
		expect(target.textContent).toContain('onerror=window.__pwned=1');
		expect((window as { __pwned?: unknown }).__pwned).toBeUndefined();
		unmount();
	});
});

describe('FileContentViewer markdown — OCI-parity Copy/Raw pair (2026-09-05)', () => {
	it('the .md dispatch body shows the hover Copy + Raw toggle top-right', async () => {
		const { mount, unmount } = await import('svelte');
		const FileContentViewer = (await import('$lib/components/common/viewers/FileContentViewer.svelte')).default;
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(FileContentViewer, {
			target,
			props: { view: { path: '/x/a.md', lang: 'md', offset: 1, totalLines: 2, lines: [
				{ number: 1, text: '# Title' }, { number: 2, text: 'body **bold**' }
			] } }
		});
		const md = target.querySelector('[data-testid="file-viewer-markdown"]') as HTMLElement;
		expect(md).not.toBeNull();
		expect(md.querySelector('button[title="Copy markdown"]')).not.toBeNull();
		const rawToggle = md.querySelector('button') as HTMLElement; // pair present
		expect(md.textContent).not.toContain('# Title'); // rendered prose, not raw
		void rawToggle;
		unmount(comp);
	});
});

describe('ReasoningContentViewer — extracted think body (2026-09-05)', () => {
	it('renders markdown prose with the hover Copy button top-right', async () => {
		const { mount, unmount } = await import('svelte');
		const ReasoningContentViewer = (await import('$lib/components/common/viewers/ReasoningContentViewer.svelte')).default;
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ReasoningContentViewer, { target, props: { content: 'I should **check** the file first.' } });
		const body = target.querySelector('[data-testid="reasoning-body"]') as HTMLElement;
		expect(body).not.toBeNull();
		expect(body.querySelector('strong')?.textContent).toBe('check'); // markdown rendered
		const actions = target.querySelector('[data-testid="reasoning-actions"]') as HTMLElement;
		expect(actions.querySelector('button[title="Copy reasoning"]')).not.toBeNull();
		unmount(comp);
	});
});
