/**
 * WorkspaceFile — view-switch branch mop: every arm of the body
 * ladder the toolbar suite doesn't reach — the save-failed note (with
 * and without an error detail), the phase ladder (loading / failed /
 * ready), the image, HTML-frame (preview vs edit-tab fall-through),
 * diff view (noHead note present/absent), markdown preview (preview
 * vs edit-tab fall-through), the plain editor default (with and
 * without the truncation note), and both bindable hosts landing.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFile from '$lib/components/workspace-file/WorkspaceFile.svelte';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function baseProps(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		tab: 'preview',
		dirty: false,
		fullPath: 'notes/a.md',
		saveState: 'idle',
		fileStale: false,
		staleNote: 'stale',
		hasTabs: true,
		activeView: 'edit',
		showToggle: false,
		editing: false,
		onToggleEdit: vi.fn(),
		readonly: false,
		onViewChange: vi.fn(),
		onSave: vi.fn(),
		onReload: vi.fn(),
		onToggleExplorer: vi.fn(),
		explorerHidden: false,
		saveError: null,
		saveFailedNote: 'save failed',
		loadingNote: 'loading…',
		loadFailedNote: 'load failed',
		truncatedNote: 'truncated',
		newFileNote: 'new file',
		phase: 'ready',
		errorCode: null,
		title: 'a.md',
		isImage: false,
		bytesSrc: '',
		isHtml: false,
		text: '# hello',
		isMarkdown: false,
		noHead: false,
		eof: true,
		...over
	};
}

function mountFile(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFile, { target: target!, props: props as never });
	flushSync();
}

function q(testid: string): HTMLElement | null {
	return target!.querySelector('[data-testid="' + testid + '"]');
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('WorkspaceFile — save + phase notes', () => {
	it('save failed with a detail: note carries the " — " error suffix arm', () => {
		mountFile(baseProps({ saveState: 'failed', saveError: 'EACCES' }));
		const note = q('file-save-failed')!;
		expect(note.textContent).toContain('save failed');
		expect(note.textContent).toContain(' — EACCES');
	});

	it('save failed without a detail: the null saveError arm renders bare copy', () => {
		mountFile(baseProps({ saveState: 'failed', saveError: null }));
		expect(q('file-save-failed')!.textContent?.includes('—')).toBe(false);
	});

	it('phase loading: the loading note replaces every body view', () => {
		mountFile(baseProps({ phase: 'loading' }));
		expect(q('file-image')).toBeNull();
		expect(q('file-diff-view')).toBeNull();
		expect(target!.querySelector('.file-editor-host')).toBeNull();
		expect(target!.querySelector('.note')!.textContent).toContain('loading');
	});

	it('phase failed: the failed note carries the wire code beside it', () => {
		mountFile(baseProps({ phase: 'failed', errorCode: 'ENOENT' }));
		expect(q('file-failed')!.textContent).toContain('load failed');
		expect(q('file-failed')!.textContent).toContain('ENOENT');
	});
});

describe('WorkspaceFile — content views', () => {
	it('image file: the preview renders the img with bytesSrc + alt title', () => {
		mountFile(baseProps({ isImage: true, bytesSrc: 'data:image/png;base64,AA', title: 'pic.png' }));
		const img = q('file-image') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('data:image/png;base64,AA');
		expect(img.getAttribute('alt')).toBe('pic.png');
	});

	it('html file on the preview tab: sandboxed iframe with the text as srcdoc', () => {
		mountFile(baseProps({ isHtml: true, text: '<b>hi</b>', title: 'a.html' }));
		const frame = q('file-html-frame') as HTMLIFrameElement;
		expect(frame.getAttribute('sandbox')).toBe('');
		expect(frame.getAttribute('srcdoc')).toBe('<b>hi</b>');
	});

	it('html file on the edit tab: falls through to the editor host', () => {
		mountFile(baseProps({ isHtml: true, tab: 'edit' }));
		expect(q('file-html-frame')).toBeNull();
		expect(target!.querySelector('.file-editor-host')).toBeTruthy();
	});

	it('diff view: the host renders; the noHead arm adds the new-file caption', () => {
		mountFile(baseProps({ activeView: 'diff', noHead: true }));
		expect(q('file-diff-view')).toBeTruthy();
		expect(q('file-diff-new-file')!.textContent).toContain('new file');

		if (instance) unmount(instance as never);
		target!.remove();
		mountFile(baseProps({ activeView: 'diff', noHead: false }));
		expect(q('file-diff-view')).toBeTruthy();
		expect(q('file-diff-new-file')).toBeNull();
	});

	it('markdown preview: MarkdownPanel path on the preview tab; edit tab falls through', () => {
		mountFile(baseProps({ isMarkdown: true, text: '# hello' }));
		expect(target!.querySelector('.file-scroll')).toBeTruthy();
		expect(target!.querySelector('.prose, [class*="markdown"]')).toBeTruthy();

		if (instance) unmount(instance as never);
		target!.remove();
		mountFile(baseProps({ isMarkdown: true, tab: 'edit' }));
		expect(q('file-html-frame')).toBeNull();
		expect(target!.querySelector('.file-editor-host')).toBeTruthy();
	});

	it('editor default: eof hides the truncation note, !eof shows it', () => {
		mountFile(baseProps({ eof: true }));
		expect(target!.querySelector('.file-editor-host')).toBeTruthy();
		expect(target!.textContent).not.toContain('truncated');

		if (instance) unmount(instance as never);
		target!.remove();
		mountFile(baseProps({ eof: false }));
		expect(target!.textContent).toContain('truncated');
	});

	it('the bindable hosts land: editorHost and diffHost bind to the rendered divs', () => {
		const bound: { editor: unknown; diff: unknown } = { editor: null, diff: null };
		if (instance) unmount(instance as never);
		target?.remove();
		target = document.createElement('div');
		document.body.appendChild(target);
		const props = baseProps({ activeView: 'diff' }) as Record<string, unknown>;
		props.getEditorHost = () => bound.editor;
		props.setEditorHost = (v: unknown) => (bound.editor = v);
		props.getDiffHost = () => bound.diff;
		props.setDiffHost = (v: unknown) => (bound.diff = v);
		// bindable via getter/setter pairs on the props object
		delete props.editorHost;
		delete props.diffHost;
		Object.defineProperties(props, {
			editorHost: { get: props.getEditorHost as () => unknown, set: props.setEditorHost as (v: unknown) => void, enumerable: true },
			diffHost: { get: props.getDiffHost as () => unknown, set: props.setDiffHost as (v: unknown) => void, enumerable: true }
		});
		instance = mount(WorkspaceFile, { target: target!, props: props as never });
		flushSync();
		expect(bound.diff).toBe(q('file-diff-view'));
	});
});
