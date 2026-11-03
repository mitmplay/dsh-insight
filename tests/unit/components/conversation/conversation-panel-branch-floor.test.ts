/**
 * ConversationPanel BRANCH FLOOR — the template arms the main suite leaves
 * closed (branch-coverage mop):
 *   - the sub-agent floating-stick block: the toggle mount AND the
 *     {#if store.isStreaming} StreamingIndicator arm (running cold seed)
 *   - onStickToggle BOTH arms: OFF releases (condition-false arm), ON
 *     re-engages AND scrolls the viewport to the live end (scrollTo arm)
 *   - the Prompt Macro sheet block: {#if macroOurs} true arm (the panel
 *     showing the run's target session renders MacroBar) and false arm
 *     (a bystander panel never renders it), plus macroLanded's clamp arms
 *   - the deliverables cold seed ({#if deliverables !== undefined} TRUE arm
 *     — the wholesale seedDeliverables call)
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationPanel from '$lib/components/conversation/panel/ConversationPanel.svelte';
import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';

function coldProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sessionId: 's-floor',
		agent: null,
		entries: [],
		lastSeq: -1,
		running: false,
		...overrides
	};
}

function userEntry(id: string, seq: number, text: string) {
	return { kind: 'user-message', id, seq, time: 1000 + seq, text };
}

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

async function mountPanel(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationPanel, { target, props: props as never });
	await settle();
	return { target, instance };
}

function installDefaultFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		})
	);
}

beforeEach(() => {
	installDefaultFetch();
});

afterEach(async () => {
	// the runner is module-scope: never leak a live run into the next test
	try { await macroRunner.abort(); } catch { /* no live run */ }
	macroRunner.dismiss();
	vi.restoreAllMocks();
	installDefaultFetch();
});

describe('ConversationPanel — the sub-agent floating-stick block', () => {
	it('a sub-agent panel mounts the floating toggle INSTEAD of the composer area', async () => {
		const { target, instance } = await mountPanel(coldProps({ subagent: true }));
		expect(target.querySelector('[data-testid="floating-stick-toggle"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="composer-stick-toggle"]')).toBeNull();
		expect(target.querySelector('[data-testid="prompt-input"], [data-testid="prompt-input-textarea"]')).toBeNull();
		// streaming false → the indicator arm stays closed
		expect(target.querySelector('[data-testid=streaming-indicator]')).toBeNull();
		unmount(instance);
	});

	it('a streaming sub-agent panel lights the StreamingIndicator arm too', async () => {
		// the poll must CONFIRM the running seed or it flips the status back
		vi.stubGlobal('fetch', vi.fn(async () =>
			new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: true }), { status: 200, headers: { 'content-type': 'application/json' } })
		));
		const { target, instance } = await mountPanel(coldProps({ subagent: true, running: true }));
		expect(target.querySelector('[data-testid="floating-stick-toggle"]')).not.toBeNull();
		expect(target.querySelector('[data-testid=streaming-indicator]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationPanel — onStickToggle both arms', () => {
	it('OFF releases (no scroll); ON re-engages and scrolls the viewport to the live end', async () => {
		const scrolls: number[] = [];
		const proto = HTMLElement.prototype as unknown as { scrollTo?: (o: unknown) => void };
		const real = proto.scrollTo;
		proto.scrollTo = (o: unknown) => { scrolls.push((o as { top: number }).top); };
		try {
			const { target, instance } = await mountPanel(
				coldProps({ agent: 'app-dev', sessionId: 's-stick-floor', entries: [userEntry('u:1', 1, 'hello')] })
			);
			const tog = target.querySelector('[data-testid="stick-toggle"]') as HTMLButtonElement;
			expect(tog.getAttribute('data-active')).toBe('true');
			tog.click(); // ON -> OFF: the condition-false arm (no scroll side effect)
			await settle();
			expect(tog.getAttribute('data-active')).toBe('false');
			expect(scrolls).toHaveLength(0);
			tog.click(); // OFF -> ON: the scrollTo arm
			await settle();
			expect(tog.getAttribute('data-active')).toBe('true');
			expect(scrolls.length).toBeGreaterThan(0); // the viewport jumped to the end
			unmount(instance);
		} finally {
			if (real) proto.scrollTo = real;
		}
	});
});

describe('ConversationPanel — the macro sheet block ({#if macroOurs})', () => {
	it('the panel showing the run TARGET session renders the MacroBar sheet', async () => {
		const run = macroRunner.start(
			{ text: '!echo one', id: 1 },
			{ sessionId: 's-macro-floor', workspace: null, agent: 'app-dev', panelId: null, entries: [] },
			{ held: true, baselineTurns: 0 }
		);
		expect(run.phase).not.toBe('failed');
		expect(macroRunState().targetSessionId).toBe('s-macro-floor');
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-macro-floor', agent: 'app-dev', entries: [userEntry('u:1', 1, 'seed')] })
		);
		expect(target.querySelector('[data-testid="macro-run"]')).not.toBeNull();
		// landed clamp: baseline 0 against 0 landed turns -> 0, never negative
		unmount(instance);
	});

	it('a bystander panel (different session) never renders the sheet', async () => {
		const run = macroRunner.start(
			{ text: '!echo two', id: 2 },
			{ sessionId: 's-macro-floor-2', workspace: null, agent: 'app-dev', panelId: null, entries: [] },
			{ held: true, baselineTurns: 0 }
		);
		expect(run.phase).not.toBe('failed');
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-bystander', agent: 'app-dev' })
		);
		expect(target.querySelector('[data-testid="macro-run"]')).toBeNull();
		unmount(instance);
	});

	it('an idle runner renders no sheet on any panel (the phase guard)', async () => {
		const { target, instance } = await mountPanel(coldProps({ agent: 'app-dev' }));
		expect(macroRunState().phase).toBe('idle');
		expect(target.querySelector('[data-testid="macro-run"]')).toBeNull();
		unmount(instance);
	});
});

describe('ConversationPanel — cold seeds', () => {
	it('a DEFINED (even empty) deliverables inventory rides the seed arm', async () => {
		const { target, instance } = await mountPanel(coldProps({ deliverables: [] }));
		expect(target.querySelector('[data-testid="floating-stick-toggle"]')).toBeNull(); // not a subagent mount
		unmount(instance);
	});
});
