/**
 * MarkdownContent branch-arm tests — arms the sibling suites do not mount:
 *
 *   - theme flip repaint: the mermaid pass re-initializes for the other
 *     appearance and repaints every placeholder with the other palette
 *   - a diagram whose render REJECTS lands the styled error div
 *   - a flowchart with no parseable node ids passes through colorizeMermaid
 *     untouched (the ids.size === 0 arm)
 *   - dark mode: colorizeMermaid injects the DARK palette classDefs
 *   - same-origin anchors get NO favicon icon (host === location.host)
 *   - a hostile http URL that throws in the URL constructor hits the catch
 *   - an img whose data-ws-src normalizes EMPTY stays inert (rel === '' arm)
 *   - a file-link anchor whose path has no basename gets no icon
 *     (name === '' arm)
 *
 * $app/environment is mocked to browser:true (the real stub is false) and
 * the mermaid runtime is mocked, as in the sibling suites.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
import { themePrefs } from '$lib/utils/theme-prefs.svelte';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

const mermaidRender = vi.fn(async (_id: string, source: string) => ({
	svg: `<svg data-mmd="${source}"></svg>`
}));
const mermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
	default: {
		initialize: (...args: unknown[]) => mermaidInitialize(...args),
		render: (...args: unknown[]) => mermaidRender(...(args as [string, string]))
	}
}));

function render(props: {
	content: string;
	hideToggle?: boolean;
	allowHtml?: boolean;
	onFileLink?: (path: string) => void;
	workspaceRoot?: string;
}): { target: HTMLElement; unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, unmount: () => unmount(comp) };
}

async function settle(rounds = 10): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

async function renderedSource(target: HTMLElement): Promise<string> {
	const svg = target.querySelector('.mermaid-diagram svg');
	return svg?.getAttribute('data-mmd') ?? '';
}

beforeEach(() => {
	mermaidRender.mockClear();
	mermaidInitialize.mockClear();
	mermaidRender.mockImplementation(async (_id: string, source: string) => ({
		svg: `<svg data-mmd="${source}"></svg>`
	}));
	document.documentElement.dataset.theme = 'light';
});

afterAll(() => {
	themePrefs.set('light');
	delete document.documentElement.dataset.theme;
});

describe('MarkdownContent — mermaid palette theme flip', () => {
	it('a theme flip re-initializes the runtime and repaints with the other palette', async () => {
		themePrefs.set('light');
		const { target, unmount: done } = render({
			content: '```mermaid\nflowchart TD\n  A[Host] --> B[Web]\n```'
		});
		await settle();
		expect(target.querySelector('.mermaid-diagram')?.getAttribute('data-processed')).toBe('true');
		expect(mermaidInitialize).toHaveBeenCalledTimes(1);
		const lightSource = await renderedSource(target);
		expect(lightSource).toContain('fill:#DBEAFE'); // light palette injected

		themePrefs.set('dark');
		await settle();
		// the appearance flip re-initialized the runtime for the other theme…
		expect(mermaidInitialize).toHaveBeenCalledTimes(2);
		expect(mermaidInitialize.mock.calls[1][0].themeVariables.primaryColor).toBe('#1d2026');
		// …and repainted the placeholder with the DARK palette
		expect(target.querySelector('.mermaid-diagram')?.getAttribute('data-processed')).toBe('true');
		expect(await renderedSource(target)).toContain('fill:#1e3a5f');
		done();
	});
});

describe('MarkdownContent — mermaid render failure', () => {
	it('a rejecting render lands the styled error div and marks the placeholder processed', async () => {
		mermaidRender.mockImplementation(async () => {
			throw new Error('boom\nsecond line');
		});
		const { target, unmount: done } = render({
			content: '```mermaid\ngraph TD\n  A-->B\n```'
		});
		await settle();
		const diagram = target.querySelector('.mermaid-diagram');
		expect(diagram?.getAttribute('data-processed')).toBe('true');
		const err = diagram?.querySelector('.text-status-fail');
		expect(err?.textContent).toContain('Mermaid render error: Error: boom'); // first line only
		done();
	});
});

describe('MarkdownContent — colorizeMermaid id-less passthrough', () => {
	it('a flowchart with no parseable node ids passes through untouched', async () => {
		const source = 'flowchart TD\n  subgraph one\n  end';
		const { target, unmount: done } = render({
			content: '```mermaid\n' + source + '\n```'
		});
		await settle();
		expect(await renderedSource(target)).toBe(source); // no injected classDef zc
		done();
	});
});

describe('MarkdownContent — dark palette injection', () => {
	it('a dark-mode flowchart injects the DARK palette classDefs', async () => {
		themePrefs.set('dark');
		try {
			const { target, unmount: done } = render({
				content: '```mermaid\nflowchart TD\n  A[Host] --> B[Web]\n```'
			});
			await settle();
			const received = await renderedSource(target);
			expect(received).toContain('classDef zc0 fill:#1e3a5f,stroke:#60a5fa,color:#E2E8F0;');
			done();
		} finally {
			themePrefs.set('light');
			await settle(2);
		}
	});
});

describe('MarkdownContent — external-link icon pass arms', () => {
	it('a same-origin anchor gets NO favicon icon', () => {
		const { target, unmount: done } = render({ content: '[api](/api/dsh/x)' });
		expect(target.querySelector('a[href="/api/dsh/x"]')).not.toBeNull();
		expect(target.querySelector('.elink-icon')).toBeNull();
		done();
	});

	it('a hostile http URL that throws in the URL constructor hits the catch arm', () => {
		const { target, unmount: done } = render({ content: '[x](http://[bad)' });
		expect(target.querySelector('a[href="http://[bad"]')).not.toBeNull();
		expect(target.querySelector('.elink-icon')).toBeNull(); // no crash, plain link survives
		done();
	});
});

describe('MarkdownContent — workspace image + file-link icon edge arms', () => {
	it('an img whose data-ws-src normalizes EMPTY stays inert (rel === \'\' arm)', () => {
		const { target, unmount: done } = render({
			content: '![alt](<>)',
			hideToggle: true,
			workspaceRoot: '/Users/op/ws'
		});
		const img = target.querySelector('img[data-ws-src]');
		expect(img).not.toBeNull();
		expect(img?.getAttribute('data-ws-src')).toBe('');
		expect(img?.getAttribute('src')).toBeNull(); // empty rel never resolves a src
		done();
	});

	it('a file-link anchor whose path has no basename gets NO icon (name === \'\' arm)', () => {
		const onFileLink = vi.fn();
		const { target, unmount: done } = render({
			content: '[dir](folder/)',
			onFileLink
		});
		expect(target.querySelector('a[href="folder/"]')).not.toBeNull();
		expect(target.querySelector('.flink-icon')).toBeNull(); // basename-less path skips
		// the click path still forwards the raw href
		(target.querySelector('a[href="folder/"]') as HTMLElement).click();
		flushSync();
		expect(onFileLink).toHaveBeenCalledWith('folder/');
		done();
	});
});