/**
 * InjectedDocPanel host tests (Loadinjected W4 4.2-T) — the kind's SINGLE
 * floor content (ADR D1/D2): payload resolved purely over the entries prop
 * (latest epoch for the synthetic member, latest envelope for instructions),
 * routed by extension — .md through MarkdownPanel, everything else through
 * the Monaco glue with readOnly. Monaco glue MOCKED — the component never
 * loads the real chunk under happy-dom.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import InjectedDocPanel from '$lib/components/panels/InjectedDocPanel.svelte';
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import type { DsiEntry } from '$lib/types';

const glueCalls: Array<{ initial: string; options: { readOnly?: boolean } | undefined }> = [];
const glueDisposed: boolean[] = [];

vi.mock('$lib/components/common/settings-monaco', () => ({
	createYamlEditor: (
		_container: HTMLElement,
		initial: string,
		_onChange: () => void,
		options?: { readOnly?: boolean }
	) => {
		glueCalls.push({ initial, options });
		return {
			getValue: () => initial,
			setValue: () => {},
			dispose: () => {
				glueDisposed[glueCalls.length - 1] = true;
			}
		};
	}
}));

function spEntry(seq: number, text: string): DsiEntry {
	return { kind: 'system-prompt', id: `sp:${seq}`, seq, time: seq, text };
}
function instrEntry(seq: number, path: string, text: string): DsiEntry {
	// Harness-real envelope: the file's section marker precedes its content
	// (agent-instructions render.ts sectionText) — the panel slices it.
	return {
		kind: 'user-message',
		id: `u:${seq}`,
		seq,
		time: seq,
		text: `Instructions from: ${path}\n\n${text}`,
		meta: 'instructions',
		metaSource: { changes: [{ action: 'set', scope: path, path, digest: 'd' }] }
	};
}

let sidCounter = 0;

function mountPanel(displayPath: string, entries: DsiEntry[], sourceSessionId?: string) {
	const onclose = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(InjectedDocPanel, {
		target,
		props: {
			sourceSessionId: sourceSessionId ?? `s-doc-${++sidCounter}`,
			displayPath,
			entries,
			onclose
		}
	});
	flushSync();
	return {
		target,
		onclose,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

describe('InjectedDocPanel (Loadinjected W4 4.2-T)', () => {
	it('a .md member renders the logged payload as markdown', () => {
		const entries = [instrEntry(2, 'AGENTS.md', '# Workspace Rules\nbe kind')];
		const h = mountPanel('AGENTS.md', entries);
		const panel = h.target.querySelector('[data-testid="injected-doc-panel"]');
		expect(panel).not.toBeNull();
		expect(panel!.innerHTML).toContain('markdown-panel');
		expect(panel!.innerHTML).toContain('Workspace Rules');
		h.cleanup();
	});

	it('the synthetic system-prompt member resolves the LATEST epoch', () => {
		const entries = [spEntry(1, 'epoch one'), spEntry(2, 'epoch two — latest')];
		const h = mountPanel('system-prompt.md', entries);
		expect(h.target.querySelector('[data-testid="markdown-panel"]')!.innerHTML).toContain(
			'epoch two — latest'
		);
		h.cleanup();
	});

	it('an instructions member resolves the LATEST envelope naming the path', () => {
		const entries = [
			instrEntry(1, 'AGENTS.md', 'old injection'),
			instrEntry(2, 'AGENTS.md', 'newest injection'),
			instrEntry(3, 'OTHER.md', 'unrelated')
		];
		const h = mountPanel('AGENTS.md', entries);
		expect(h.target.querySelector('[data-testid="markdown-panel"]')!.innerHTML).toContain(
			'newest injection'
		);
		h.cleanup();
	});

	it('a non-md member opens the Monaco glue with readOnly: true (D1)', async () => {
		glueCalls.length = 0;
		const entries = [instrEntry(2, 'config.yaml', 'key: value')];
		const h = mountPanel('config.yaml', entries);
		await settle();
		expect(glueCalls).toHaveLength(1);
		expect(glueCalls[0].initial).toBe('key: value');
		expect(glueCalls[0].options).toEqual({ readOnly: true });
		expect(h.target.querySelector('.doc-editor-host')).not.toBeNull();
		h.cleanup();
	});

	it('an absent payload renders the honest missing-record note — no fetch, no guess', () => {
		const h = mountPanel('AGENTS.md', []);
		expect(h.target.querySelector('[data-testid="injected-doc-missing"]')).not.toBeNull();
		h.cleanup();
	});

	it('the toolbar carries the D7 title and the read-only state; close fires onclose', () => {
		const h = mountPanel('system-prompt.md', [spEntry(1, 'the prompt')]);
		expect(h.target.querySelector('.doc-title')!.textContent).toBe('system prompt — latest epoch');
		expect(h.target.querySelector('.doc-state')!.textContent).toContain('read-only');
		(h.target.querySelector('[data-testid="injected-doc-close"]') as HTMLElement).click();
		flushSync();
		expect(h.onclose).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('LIVE-FIRST — the panel reads the source’s polled store and follows new epochs', () => {
		// The staleness bug (2026-09-07): the shelf offered system-prompt.md
		// from the source panel's live store, but the doc panel read the
		// floor's stale cold snapshot — "payload not in the loaded
		// transcript". The registered live store is the fix; the empty
		// entries prop here proves the live path is what feeds the panel.
		const live = createConversationStore('s-live-loadinjected');
		live.replaceAll([spEntry(99, 'header epoch one')]);
		const h = mountPanel('system-prompt.md', [], 's-live-loadinjected');
		expect(h.target.querySelector('[data-testid="injected-doc-missing"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="injected-doc-state"]')!.textContent).toContain(
			'seq 99'
		);
		expect(h.target.innerHTML).toContain('header epoch one');
		// A newer epoch lands via the poll — the panel follows it live.
		live.replaceAll([spEntry(99, 'epoch one'), spEntry(105, 'epoch two — newest')]);
		flushSync();
		expect(h.target.innerHTML).toContain('epoch two — newest');
		expect(h.target.querySelector('[data-testid="injected-doc-state"]')!.textContent).toContain(
			'seq 105'
		);
		h.cleanup();
	});


	it('root-scoped Escape closes; other keys never do (D8)', () => {
		const h = mountPanel('config.yaml', [instrEntry(2, 'config.yaml', 'key: value')]);
		const root = h.target.querySelector('[data-testid="injected-doc-panel"]') as HTMLElement;
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(h.onclose).not.toHaveBeenCalled();
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(h.onclose).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('the system-prompt doc labels the header epoch; an injected doc labels its seq', () => {
		const a = mountPanel('system-prompt.md', [spEntry(3, 'p')]);
		expect(a.target.querySelector('[data-testid="injected-doc-state"]')!.textContent).toContain(
			'header epoch, seq 3'
		);
		a.cleanup();
		const b = mountPanel('config.yaml', [instrEntry(4, 'config.yaml', 'k: v')]);
		expect(b.target.querySelector('[data-testid="injected-doc-state"]')!.textContent).toContain(
			'injected seq 4'
		);
		b.cleanup();
	});

	it('unmounting a yaml panel disposes its editor (the effect cleanup)', async () => {
		glueCalls.length = 0;
		glueDisposed.length = 0;
		const h = mountPanel('config.yaml', [instrEntry(2, 'config.yaml', 'key: value')]);
		await settle();
		expect(glueDisposed).toEqual([]); // alive until unmount
		h.cleanup();
		expect(glueDisposed).toEqual([true]);
	});

	it('a yaml panel mounted before its snapshot arrives opens the editor when the record lands', async () => {
		glueCalls.length = 0;
		const live = createConversationStore('s-late-yaml');
		live.replaceAll([]);
		const h = mountPanel('config.yaml', [], 's-late-yaml');
		expect(h.target.querySelector('[data-testid="injected-doc-missing"]')).not.toBeNull();
		await settle();
		expect(glueCalls).toHaveLength(0); // nothing to show yet — no editor init
		live.replaceAll([instrEntry(1, 'config.yaml', 'late: true')]);
		flushSync();
		await settle();
		expect(glueCalls).toHaveLength(1);
		expect(glueCalls[0].initial).toBe('late: true');
		h.cleanup();
	});
});