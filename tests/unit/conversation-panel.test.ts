/**
 * conversation-panel unit tests (paired with Panel Floor W2 task 2.1).
 *
 * ConversationPanel is the conversation body extracted from the page —
 * self-contained store/orchestrator/chip state/load-older/footer. This
 * suite pins the extraction's NEW component contract (Tasks.md 2.1-T):
 *
 *  - panel mounts with cold props and renders the transcript
 *  - load-older fetch fires on the sentinel's load button (beforeSeq =
 *    cold firstSeq) and prepends the page
 *  - chip toggle state is ISOLATED per panel instance (two panels,
 *    independent openChipId — the W3 N-panel premise)
 *  - onNeedCold fires ONCE at mount when the panel has no cold entries
 *    (runtime-added-panel seam, W3 3.1), and never on the cold path
 *  - onClose is optional and never invoked by the panel itself (W3
 *    PanelHeader closes; today the panel only accepts the prop)
 *
 * Pattern: component-direct mount (chat-components.test.ts), not the
 * page harness — the panel is the mounted subject.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the panel must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
import { registerAddPanel, registerReplacePanel,
	type PanelAddRequest
} from '../../src/lib/services/panels/panel-registry';
import { localPermission } from '../../src/lib/services/conversation/permission-state';
import TitleHost from '../fixtures/TitleHost.svelte';

/** Cold-load props helper — the minimum the panel requires, spread-overridable. */
function coldProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sessionId: 's-panel',
		agent: null,
		entries: [],
		lastSeq: -1,
		running: false,
		...overrides
	};
}

/** Context-injection entry — a user-message carrying `meta` (the chip
 * attribution producer; kind from src/lib/types.ts, grouping from
 * turn-grouping.ts: meta'd user messages render as ContextInjection chips). */
function ctxEntry(id: string, seq: number, text: string) {
	return { kind: 'user-message', id, seq, time: 1000 + seq, text, meta: 'runtime-context' };
}

/** User message entry. */
function userEntry(id: string, seq: number, text: string) {
	return { kind: 'user-message', id, seq, time: 1000 + seq, text };
}

async function mountPanel(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// Untyped bridge: the props object is built by test helpers below — the
	// component itself enforces its contract at runtime (missing cold props
	// would fail the assertions, not the type-checker).
	const instance = mount(ConversationPanel, { target, props: props as never });
	await settle();
	return { target, instance };
}

/** Default fetch double for mounts that need no specific bodies. Every
 *  panel mount starts the poll loop + model probe, and an unstubbed fetch
 *  rides happy-dom's `http://localhost:3000` base into a real ECONNREFUSED
 *  connect. Tests that assert fetch bodies re-stub inside the test or the
 *  describe; afterEach restores. */
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
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

beforeEach(() => {
	installDefaultFetch();
});

afterEach(() => {
	vi.restoreAllMocks();
	installDefaultFetch();
});

describe('ConversationPanel — cold mount + render (task 2.1-T)', () => {
	it('renders the transcript from cold props: header id, empty state, footer input', async () => {
		const { target } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 2, 'panel body works')] })
		);
		const bubbles = target.querySelectorAll('[data-testid="message-bubble"]');
		expect(bubbles).toHaveLength(1);
		expect(bubbles[0].getAttribute('data-role')).toBe('user');
		expect(bubbles[0].textContent).toContain('panel body works');
		// Header identity: the id rides the identity cluster's container
		// attribute (copy-id moved to the floor's PanelHeader, 2026-08-25).
		const cluster = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(cluster.getAttribute('data-session-id')).toBe('s-panel');
		// Empty state hidden when entries exist; footer input present.
		expect(target.querySelector('[data-testid="transcript-empty"]')).toBeNull();
		expect(target.querySelector('[data-testid="prompt-input"], [data-testid="prompt-input-textarea"]')).not.toBeNull();
	});

	it('cold load with running=true shows running status from the first paint', async () => {
		// The poll must CONFIRM the running seed (a host with a live turn
		// reports running:true) — a poll is never allowed to flip the
		// status this test asserts.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		const { target } = await mountPanel(coldProps({ running: true }));
		expect(target.querySelector('[data-testid="running-status"]')?.getAttribute('aria-label')).toBe('running');
	});
});

describe('ConversationPanel — load-older (task 2.1-T)', () => {
	it('load button fetches beforeSeq=firstSeq and prepends the older page', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				if (url.includes('/history?beforeSeq=2')) {
					return new Response(
						JSON.stringify({ ok: true, entries: [userEntry('u:0', 1, 'older page')], hasMore: false }),
						{ status: 200 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), {
					status: 200
				});
			})
		);
		const { target } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 2, 'tail page')], hasMore: true })
		);
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
		(target.querySelector('[data-testid="load-older-button"]') as HTMLButtonElement).click();
		await settle();
		await settle();
		expect(calls.find((u) => u.includes('/history?beforeSeq='))).toBe(
			'/api/dsh/session/s-panel/history?beforeSeq=2'
		);
		expect(target.textContent).toContain('older page');
		// hasMore=false from the page → sentinel gone
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
	});

	it('hasMore=false hides the sentinel (no fetch wiring)', async () => {
		const { target } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 2, 'only')], hasMore: false })
		);
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
	});
});

describe('ConversationPanel — chip state isolation (task 2.1-T: the W3 premise)', () => {
	it('two panels, one open chip popup each — openChipId never crosses panels', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		const cold = [ctxEntry('c:1', 1, 'panel payload A'), ctxEntry('c:2', 2, 'panel payload B')];
		const a = await mountPanel(coldProps({ sessionId: 's-a', entries: cold }));
		const b = await mountPanel(coldProps({ sessionId: 's-b', entries: cold }));

		// Open the FIRST chip in panel A only.
		(a.target.querySelectorAll('[data-testid="context-injection-toggle"]')[0] as HTMLElement).click();
		await settle();
		const aBodies = a.target.querySelectorAll('[data-testid="context-injection-body"]');
		const bBodies = b.target.querySelectorAll('[data-testid="context-injection-body"]');
		expect(aBodies).toHaveLength(1);
		expect(aBodies[0].textContent).toContain('panel payload A');
		expect(bBodies).toHaveLength(0); // panel B untouched — per-panel state

		// Open the SECOND chip in panel B: A keeps its first chip open (two
		// independent popup owners), B's own exclusivity holds inside B.
		(b.target.querySelectorAll('[data-testid="context-injection-toggle"]')[1] as HTMLElement).click();
		await settle();
		expect(a.target.querySelectorAll('[data-testid="context-injection-body"]')).toHaveLength(1);
		expect(a.target.querySelector('[data-testid="context-injection-body"]')?.textContent).toContain(
			'panel payload A'
		);
		expect(b.target.querySelectorAll('[data-testid="context-injection-body"]')).toHaveLength(1);
		expect(b.target.querySelector('[data-testid="context-injection-body"]')?.textContent).toContain(
			'panel payload B'
		);

		unmount(a.instance);
		unmount(b.instance);
	});
});

describe('ConversationPanel — runtime-cold seam (onNeedCold, W3 3.1)', () => {
	it('no cold entries → onNeedCold fires ONCE at mount with the session id', async () => {
		const needCold = vi.fn();
		const { target, instance } = await mountPanel({
			sessionId: 's-needcold',
			agent: null,
			lastSeq: -1,
			running: false,
			onNeedCold: needCold
		});
		expect(needCold).toHaveBeenCalledTimes(1);
		expect(needCold).toHaveBeenCalledWith('s-needcold');
		// Honest pre-cold render: empty transcript, no crash.
		expect(target.querySelector('[data-testid="transcript-empty"]')).not.toBeNull();
		unmount(instance);
	});

	it('cold entries present → onNeedCold NEVER fires (SSR seed path)', async () => {
		const needCold = vi.fn();
		const { instance } = await mountPanel(coldProps({ onNeedCold: needCold }));
		expect(needCold).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('ConversationPanel — optional onClose (W3 seam, inert today)', () => {
	it('mounts and renders without onClose; the panel never invokes it', async () => {
		const onClose = vi.fn();
		const { target, instance } = await mountPanel(coldProps({ onClose }));
		await settle();
		expect(onClose).not.toHaveBeenCalled();
		expect(target.querySelector('[data-testid="transcript-empty"]')).not.toBeNull();
		unmount(instance);
	});
});

// ── Live title healing (2026-08-24 header bug) ──────────────────────

describe('ConversationPanel — live title healing (spine-fed title prop)', () => {
	/** Mount through TitleHost so the title prop updates reactively (the
	 *  page feeds it from the spine merge; runes props are parent→child). */
	async function mountHosted(props: Record<string, unknown>) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		// Untyped bridge (mountPanel pattern): the host declares the panel's
		// prop contract; the seed record is test-built.
		const instance = mount(TitleHost, {
			target,
			props: {
				sessionId: props.sessionId,
				title: props.title ?? null,
				entries: props.entries,
				lastSeq: props.lastSeq,
				running: props.running
			} as never
		});
		await settle();
		return { target, instance };
	}

	it('header adopts the healed title when the prop updates after mount', async () => {
		// The bug: a session the host names AFTER the panel opened cold-loaded
		// title:null and showed the id prefix forever while the sidebar healed.
		const { target, instance } = await mountHosted(coldProps({ title: null }));
		const btn = () => target.querySelector('[data-testid="session-title"]') as HTMLElement;
		expect(btn().textContent).toContain('s-panel'); // id-prefix fallback
		instance.setExternalTitle('Spine healed name');
		await settle();
		expect(btn().textContent).toContain('Spine healed name');
		unmount(instance);
	});

	it('an in-panel rename wins on screen until the external title echoes it', async () => {
		// Rename POST → host-normalized title; the spine still carries the
		// OLD title for up to one tick — the guard keeps the local rename,
		// then the echo reopens external truth.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => ({
				ok: true,
				json: async () =>
					String(input).includes('/rename') ? { ok: true, title: 'Renamed here' } : { ok: false }
			}))
		);
		const { target, instance } = await mountHosted(coldProps({ title: 'Cold title' }));
		const btn = () => target.querySelector('[data-testid="session-title"]') as HTMLElement;

		// Open the rename form, type, save → optimistic local title.
		btn().click();
		await settle();
		const input = target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		input.value = 'Renamed here';
		input.dispatchEvent(new Event('input'));
		flushSync();
		const save = target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement;
		expect(save.disabled).toBe(false); // draft took — enabled
		save.click();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="rename-input"]')).toBeNull(); // form closed
		});
		await settle();
		expect(btn().textContent).toContain('Renamed here');

		// Stale spine title arrives → guard holds the local rename (no flicker).
		instance.setExternalTitle('Cold title');
		await settle();
		expect(btn().textContent).toContain('Renamed here');

		// The host echo (same value) clears the guard; later changes adopt again.
		instance.setExternalTitle('Renamed here');
		await settle();
		instance.setExternalTitle('Newer truth');
		await settle();
		expect(btn().textContent).toContain('Newer truth');
		unmount(instance);
	});
});

/** Flush effects + microtasks after mount (runes reactivity is sync-batched). */
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Type into the composer and submit with Enter (the real path). */
async function submitComposer(target: HTMLElement, text: string): Promise<void> {
	const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	ta.value = text;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await settle();
	await settle();
}

// ── Auto load-older (2026-08-24) — the sentinel observes, no click ──

/** Controllable IntersectionObserver stand-in: tests fire the callback. */
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	constructor(
		private readonly cb: (entries: { isIntersecting: boolean }[]) => void
	) {
		FakeIntersectionObserver.instances.push(this);
	}
	observe(): void {}
	disconnect(): void {}
	unobserve(): void {}
	/** Test handle — the browser reporting an intersection change. */
	report(isIntersecting: boolean): void {
		this.cb([{ isIntersecting }]);
	}
}

describe('ConversationPanel — sentinel auto-load (IntersectionObserver)', () => {
	beforeEach(() => {
		FakeIntersectionObserver.instances = [];
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
	});

	afterEach(() => {
		installDefaultFetch();
	});

	it('fires the history fetch itself when the observer reports the sentinel visible', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				if (url.includes('/history')) {
					return new Response(
						JSON.stringify({
							ok: true,
							entries: [{ kind: 'user-message', id: 'u:0', seq: 3, time: 1003, text: 'older page' }],
							hasMore: false
						}),
						{ status: 200 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target, instance } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 10, 'tail')], hasMore: true })
		);
		expect(calls.filter((u) => u.includes('/history'))).toHaveLength(0); // idle at mount
		FakeIntersectionObserver.instances[0]!.report(true);
		await settle();
		await settle();
		expect(calls.some((u) => u.includes('/history?beforeSeq=10'))).toBe(true);
		expect(target.textContent).toContain('older page');
		unmount(instance);
	});

	it('no button in armed idle state — the manual path is the dead-observer fallback', async () => {
		const { target, instance } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 10, 'tail')], hasMore: true })
		);
		FakeIntersectionObserver.instances[0]!.report(false); // armed, out of view
		await settle();
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="load-older-button"]')).toBeNull();
		unmount(instance);
	});

	it('a failed page parks auto-load at a manual Retry; visibility alone never refires', async () => {
		let historyCalls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				if (String(input).includes('/history')) {
					historyCalls += 1;
					return new Response(
						JSON.stringify({ ok: false, error: { code: 'X', message: 'ledger unreachable' } }),
						{ status: 500 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target, instance } = await mountPanel(
			coldProps({ entries: [userEntry('u:1', 10, 'tail')], hasMore: true })
		);
		FakeIntersectionObserver.instances[0]!.report(true);
		await settle();
		await settle();
		expect(historyCalls).toBe(1);
		expect(target.querySelector('[data-testid="load-older-error"]')?.textContent).toContain('ledger unreachable');
		// Still visible, error standing → the Retry button, never a refire.
		const retry = target.querySelector('[data-testid="load-older-button"]') as HTMLButtonElement;
		expect(retry.textContent).toContain('Retry');
		FakeIntersectionObserver.instances[0]!.report(true); // re-report: no change
		await settle();
		await settle();
		expect(historyCalls).toBe(1);
		unmount(instance);
	});
});

// ── Conversation capture button (2026-08-25, OCI StickyHeader parity) ──

describe('ConversationPanel — whole-conversation capture button', () => {
	it('renders the canvas-copy button once the transcript viewport is bound', async () => {
		const { target, instance } = await mountPanel(coldProps({}));
		// The viewport binds at mount → the capture button appears at the
		// header's end, wired to the transcript element.
		const btn = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('title')).toContain('Copy conversation as image');
		unmount(instance);
	});
});

// ── @session mention (2026-08-26, KB "Talking to Another Agent") ──────

describe('ConversationPanel — @session mention intercept (agent-to-agent)', () => {
	const SELF_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
	const SELF_ID = `session-${SELF_UUID}`;
	const TARGET_UUID = '1d15d442-94bc-422c-afb1-e870db9906a3';
	const TARGET_ID = `session-${TARGET_UUID}`;

	/** Spine row for the target session (DsiSessionSummary shape). */
	function targetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			sessionId: TARGET_ID,
			title: 'TE-LO-LET',
			agentPreset: 'main',
			running: false,
			blank: false,
			updatedAt: 1,
			workspace: null,
			...overrides
		};
	}

	/** Route-aware fetch stub: spine + prompt + a2a register recorded. */
	function stubMentionFetch(opts: {
		sessions: unknown[];
		promptOk?: boolean;
		registerOk?: boolean;
	}): {
		promptCalls: Array<{ sessionId: string; text: string }>;
		registerCalls: Array<{ from: string; to: string; message: string; watermark: number; id: string }>;
	} {
		const promptCalls: Array<{ sessionId: string; text: string }> = [];
		const registerCalls: Array<{ from: string; to: string; message: string; watermark: number; id: string }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/dsh/sessions')) {
					return new Response(JSON.stringify({ ok: true, sessions: opts.sessions }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (url.endsWith('/api/a2a/register')) {
					registerCalls.push(JSON.parse(String(init?.body ?? '{}')));
					return new Response(JSON.stringify({ ok: opts.registerOk !== false }), {
						status: opts.registerOk === false ? 500 : 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				const m = /\/api\/dsh\/session\/([^/]+)\/prompt$/.exec(url);
				if (m) {
					promptCalls.push({
						sessionId: decodeURIComponent(m[1]),
						text: JSON.parse(String(init?.body ?? '{}')).text
					});
					return new Response(JSON.stringify({ ok: opts.promptOk !== false, accepted: true }), {
						status: opts.promptOk === false ? 502 : 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				return new Response(JSON.stringify({ ok: false }), { status: 404 });
			})
		);
		return { promptCalls, registerCalls };
	}

	afterEach(() => {
		registerAddPanel(null);
	});

	function noteText(target: HTMLElement): string {
		return (target.querySelector('[data-testid="command-note"]') as HTMLElement | null)?.textContent ?? '';
	}

	it('happy path: opens the target panel, queues the prompt, notes the title', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [targetRow()] });
		const opened: PanelAddRequest[] = [];
		registerAddPanel((request) => opened.push({ ...request }));

		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} say hi agent`);

		// Panel opened with the SPINE row's canonical id + preset.
		expect(opened).toEqual([{ sessionId: TARGET_ID, agentPreset: 'main' }]);
		// Prompt delivered to the target session. Task 3.3 lockstep: the body
		// is buildDeliveredText — the verbatim message PLUS the injected
		// protocol line (the old byte-verbatim contract changed by design).
		expect(promptCalls).toHaveLength(1);
		expect(promptCalls[0].sessionId).toBe(TARGET_ID);
		expect(promptCalls[0].text).toMatch(/^say hi agent\. Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-[a-f0-9]{16};$/);
		// Honest note with the session's title.
		expect(noteText(target)).toContain('sent to TE-LO-LET');
		// The mention never becomes a bubble HERE — it belongs to the target.
		expect(target.querySelectorAll('[data-testid="message-bubble"]')).toHaveLength(0);
		unmount(instance);
	});

	it('busy target: queues and says so (steer stays an explicit choice)', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [targetRow({ running: true })] });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} ping`);
		expect(promptCalls).toHaveLength(1);
		expect(noteText(target)).toContain('queued behind TE-LO-LET');
		unmount(instance);
	});

	it('unknown id: nothing is sent — honest note, no panel, no prompt', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [] });
		const opened: unknown[] = [];
		registerAddPanel((request) => opened.push(request));
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(opened).toHaveLength(0);
		expect(promptCalls).toHaveLength(0);
		expect(noteText(target)).toContain('no such session');
		unmount(instance);
	});

	it('self-mention is a no-op (just talk — no prompt)', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [targetRow()] });
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${SELF_UUID} hello me`);
		expect(promptCalls).toHaveLength(0);
		expect(noteText(target)).toContain('that is this session');
		unmount(instance);
	});

	it('empty message: usage error before any wire traffic', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [targetRow()] });
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID}`);
		expect(promptCalls).toHaveLength(0);
		expect(noteText(target)).toContain('usage:');
		unmount(instance);
	});

	it('no floor mounted: the mention refuses to whisper (mention ⇒ panel)', async () => {
		const { promptCalls } = stubMentionFetch({ sessions: [targetRow()] });
		// No registerAddPanel — the floor is not mounted, invoke returns false.
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(promptCalls).toHaveLength(0);
		expect(noteText(target)).toContain('panel floor');
		unmount(instance);
	});

	it('prompt rejected: the host error surfaces verbatim', async () => {
		const { promptCalls, registerCalls } = stubMentionFetch({ sessions: [targetRow()], promptOk: false });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(noteText(target)).toContain('mention failed');
		// Order: prompt first — a failed prompt NEVER registers a watch.
		expect(promptCalls).toHaveLength(1);
		expect(registerCalls).toHaveLength(0);
		unmount(instance);
	});

	// ── a2a registration (2026-08-25, Task 3.3-T) ─────────────────────

	it('registers the watch after receipt — watermark from spine turns, prompt body carries the protocol line', async () => {
		const { promptCalls, registerCalls } = stubMentionFetch({
			sessions: [targetRow({ turns: 7 })]
		});
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} run tests and report`);
		// The delivered text ends with the injected _a2a_: protocol line.
		expect(promptCalls).toHaveLength(1);
		const delivered = promptCalls[0].text as string;
		expect(delivered).toContain('run tests and report');
		expect(delivered).toMatch(/Protocol: end your reply with exactly this signature as the final characters: _a2a_:a2a-[a-f0-9]+;$/);
		// The register call carries the correct watermark + same id.
		expect(registerCalls).toHaveLength(1);
		const reg = registerCalls[0];
		expect(reg.from).toBe(SELF_ID);
		expect(reg.to).toBe(TARGET_ID);
		expect(reg.message).toBe('run tests and report');
		expect(reg.watermark).toBe(7);
		expect(reg.id).toMatch(/^a2a-[0-9a-f]{16}$/);
		// Same signature id delivered and registered.
		expect(delivered.endsWith(`_a2a_:${reg.id};`)).toBe(true);
		unmount(instance);
	});


	it('signature-prefixed mention: the captured id is honored (no re-mint)', async () => {
		const { promptCalls, registerCalls } = stubMentionFetch({ sessions: [targetRow({ turns: 2 })] });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} _a2a_:a2a-feed00000000000; check the build`);
		expect(promptCalls[0].text).not.toContain('_a2a_:a2a-feed00000000000; check');
		expect(promptCalls[0].text.endsWith('_a2a_:a2a-feed00000000000;')).toBe(true);
		expect(registerCalls[0].id).toBe('a2a-feed00000000000');
		expect(registerCalls[0].message).toBe('check the build');
		expect(registerCalls[0].watermark).toBe(2);
		unmount(instance);
	});

	it('register 500 → honest "sent, but untracked" note (send already happened)', async () => {
		const { registerCalls } = stubMentionFetch({ sessions: [targetRow({ turns: 3 })], registerOk: false });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} ping`);
		// The register was attempted; the note lands when the response body
		// resolves (happy-dom Response.json is not a fixed-microtask chain).
		await vi.waitFor(() => expect(registerCalls).toHaveLength(1));
		await vi.waitFor(() => expect(noteText(target)).toContain('sent, but untracked'));
		unmount(instance);
	});

	it('turns-null spine → watermark -1 + untracked-watermark note', async () => {
		const { registerCalls } = stubMentionFetch({ sessions: [targetRow({ turns: null })] });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF_ID }));
		await submitComposer(target, `@session-${TARGET_UUID} ping`);
		expect(registerCalls).toHaveLength(1);
		expect(registerCalls[0].watermark).toBe(-1);
		expect(noteText(target)).toContain('untracked watermark');
		unmount(instance);
	});
});

// ── /new (2026-08-25) — identity vs display on the create wire ──────────

describe('ConversationPanel — /new sends the preset ID, chip shows the display name', () => {
	it('create body + swap carry the id; only the header chip renders the label', async () => {
		// Regression (2026-08-26): feeding the host display name into
		// agentPreset made session.create fail with agent-preset-not-found
		// ("PTC mode" not found). agent is the wire identity; agentDisplay
		// is presentation-only.
		const createBodies: Array<Record<string, unknown>> = [];
		const swaps: Array<{ panelId: string; request: Record<string, unknown> }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/dsh/sessions') && init?.method === 'POST') {
					createBodies.push(JSON.parse(String(init.body ?? '{}')));
					return new Response(
						JSON.stringify({ ok: true, sessionId: 's-successor', agentPreset: 'cordis' }),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
			})
		);
		registerReplacePanel((panelId, request) => swaps.push({ panelId, request: { ...request } }));
		try {
			const { target, instance } = await mountPanel(
				coldProps({ panelId: 'p1', agent: 'cordis', agentDisplay: 'Creator mode' })
			);
			// The chip reads the DISPLAY name before any command runs.
			expect(target.querySelector('[data-testid="agent-chip"]')?.textContent).toContain('Creator mode');
			await submitComposer(target, '/new');
			// The wire never sees the display name.
			expect(createBodies).toEqual([{ agentPreset: 'cordis' }]);
			expect(swaps).toEqual([
				{ panelId: 'p1', request: { sessionId: 's-successor', agentPreset: 'cordis', focus: true } }
			]);
			unmount(instance);
		} finally {
			registerReplacePanel(null);
		}
	});

	it('/new @<agent> overrides the inherited preset on the create wire AND the swap', async () => {
		const createBodies: Array<Record<string, unknown>> = [];
		const swaps: Array<{ panelId: string; request: Record<string, unknown> }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (url.endsWith('/api/dsh/sessions') && init?.method === 'POST') {
					createBodies.push(JSON.parse(String(init.body ?? '{}')));
					return new Response(
						JSON.stringify({ ok: true, sessionId: 's-cordis-next', agentPreset: 'app-dev' }),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
			})
		);
		registerReplacePanel((panelId, request) => swaps.push({ panelId, request: { ...request } }));
		try {
			// The panel runs cordis; the typed override picks app-dev.
			const { target, instance } = await mountPanel(
				coldProps({ panelId: 'p1', agent: 'cordis', agentDisplay: 'Creator mode' })
			);
			await submitComposer(target, '/new @app-dev');
			expect(createBodies).toEqual([{ agentPreset: 'app-dev' }]);
			// The successor panel chips the OVERRIDE, not the inheritance —
			// the swap is what heals agentFor/agentLabelFor on the page.
			expect(swaps).toEqual([
				{ panelId: 'p1', request: { sessionId: 's-cordis-next', agentPreset: 'app-dev', focus: true } }
			]);
			unmount(instance);
		} finally {
			registerReplacePanel(null);
			installDefaultFetch();
		}
	});
});

// ── agent-chip copy prefix (2026-08-26) — display label, id on click ────

describe('ConversationPanel — agent chip copy prefix', () => {
	it('chip shows the display name; the prefix button copies the preset ID', async () => {
		const writes: string[] = [];
		const holder = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
		const original = holder.clipboard?.writeText;
		if (holder.clipboard) holder.clipboard.writeText = (t) => { writes.push(t); return Promise.resolve(); };

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		try {
			const { target, instance } = await mountPanel(
				coldProps({ agent: 'cordis', agentDisplay: 'Creator mode' })
			);
			const chip = target.querySelector('[data-testid="agent-chip"]') as HTMLElement;
			// Label stays the display name; the tooltip carries the raw id.
			expect(chip.textContent).toContain('Creator mode');
			expect(chip.getAttribute('title')).toBe('agent preset — cordis');
			(target.querySelector('[data-testid="agent-chip-copy-id"]') as HTMLButtonElement).click();
			await new Promise((r) => setTimeout(r, 0));

			if (holder.clipboard) {
				// The wire identity is what lands on the clipboard.
				expect(writes).toEqual(['cordis']);
				if (original) holder.clipboard.writeText = original;
			}
			unmount(instance);
		} finally {
			installDefaultFetch();
		}
	});
});

// ── Attachment refusals answer at the composer (2026-08-26) ──────────────
// The host rejects image prompts whose model lacks image input
// (code 'attachment-error', reason MODEL_DOES_NOT_SUPPORT_IMAGES — api-proxy
// admission). The refusal renders as a note directly ABOVE the composer
// (where the surviving drafts sit, BC-A3), not in the transcript-top banner.
describe('ConversationPanel — attachment refusals at the composer', () => {
	function stubPromptRefusal(refusal: Record<string, unknown>): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes('/prompt') && init?.method === 'POST') {
					return new Response(JSON.stringify({ ok: false, error: refusal }), {
						status: 502,
						headers: { 'content-type': 'application/json' }
					});
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
	}

	it('model-without-images refusal renders the composer note (verbatim + hint), top banner stays empty', async () => {
		stubPromptRefusal({
			code: 'attachment-error',
			message: 'Model "glm-5.3" does not support image input.',
			details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' }
		});
		const { target } = await mountPanel(coldProps());
		await submitComposer(target, 'what is in this picture?');
		const note = target.querySelector('[data-testid="composer-error"]');
		expect(note?.getAttribute('role')).toBe('alert');
		// The host's words, verbatim — never rewritten.
		expect(note?.textContent).toContain('Model "glm-5.3" does not support image input.');
		// The actionable hint: drafts are kept; an image-capable model exists.
		expect(note?.textContent).toContain('kept in the composer');
		expect(note?.textContent).toContain('image-capable model');
		// One home per error: the transcript-top banner carries nothing.
		expect(target.querySelector('[data-testid="conversation-error"]')).toBeNull();
	});

	it('other attachment refusals show the verbatim message without the model hint', async () => {
		stubPromptRefusal({
			code: 'attachment-error',
			message: 'Image batch exceeds the per-message byte budget.',
			details: { reason: 'IMAGES_TOO_LARGE' }
		});
		const { target } = await mountPanel(coldProps());
		await submitComposer(target, 'here, look');
		const note = target.querySelector('[data-testid="composer-error"]');
		expect(note?.textContent).toContain('exceeds the per-message byte budget');
		expect(note?.textContent).not.toContain('image-capable model');
		expect(target.querySelector('[data-testid="conversation-error"]')).toBeNull();
	});

	it('non-attachment rejections keep the transcript-top banner — no composer note', async () => {
		stubPromptRefusal({ code: 'session/agent-busy', message: 'DSH RPC session/agent-busy: turn already in flight' });
		const { target } = await mountPanel(coldProps());
		await submitComposer(target, 'hello again');
		expect(target.querySelector('[data-testid="conversation-error"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="composer-error"]')).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Coverage extension (2026-08-26): the panel's remaining lanes — tool-peek
// popup + chip mutual exclusion, the composer stick toggle, load-older
// guards/failures/races, the Shift+click drain-everything jump, the cancel
// button, /permission + /new + mention failure surfaces, the access chip's
// /permission POST, and the footer's context-token derivation.
// ═══════════════════════════════════════════════════════════════════════

/** Tool-call entry (assistant side → the peek-able chip row). */
function toolCall(id: string, seq: number, callId: string): Record<string, unknown> {
	return { kind: 'tool-call', id, seq, time: 1000 + seq, callId, toolName: 'bash', summary: 'ran tests', status: 'pass' };
}

/** Finalized assistant message carrying token usage (context tokens lane). */
function assistantUsage(id: string, seq: number, usage: Record<string, number>): Record<string, unknown> {
	return { kind: 'assistant-message', id, seq, time: 1000 + seq, text: `answer ${seq}`, streaming: false, usage };
}

const jsonRes = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Route {
	test: (url: string, init?: RequestInit) => boolean;
	respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

/** Route-aware fetch stub for panel mounts; unmatched URLs get the idle poll. */
function stubPanelRoutes(routes: Route[]): { calls: Array<{ url: string; method: string; body?: string }> } {
	const calls: Array<{ url: string; method: string; body?: string }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({
				url,
				method: init?.method ?? 'GET',
				body: init?.body === undefined ? undefined : String(init.body)
			});
			for (const r of routes) if (r.test(url, init)) return await r.respond(url, init);
			return jsonRes({ ok: true, entries: [], lastSeq: -1, running: false, gap: false });
		})
	);
	return { calls };
}

function noteOf(target: HTMLElement): string {
	return (target.querySelector('[data-testid="command-note"]') as HTMLElement | null)?.textContent ?? '';
}

/** settle() plus a macrotask hop — the drain loop is one long microtask
 *  chain (fetch stub → json → prepend → next page), which fully completes
 *  only when the microtask queue is allowed to empty before the next task. */
async function settleAll(): Promise<void> {
	await settle();
	await new Promise((r) => setTimeout(r, 0));
	await settle();
}

/** Fake transcript overflow so the far-edge jump button mounts (happy-dom
 *  metrics are all zero — BackToTheEdgeButton only renders when the
 *  viewport genuinely overflows past its threshold). */
function fakeOverflow(target: HTMLElement, scrollTop = 1000): void {
	const vp = target.querySelector('[data-testid="transcript"]') as HTMLElement;
	Object.defineProperty(vp, 'scrollHeight', { value: 3000, configurable: true });
	Object.defineProperty(vp, 'clientHeight', { value: 300, configurable: true });
	vp.scrollTop = scrollTop;
	vp.dispatchEvent(new Event('scroll'));
}

/** Shift+click the far-edge jump (the drain-everything modifier). */
function shiftClickTop(target: HTMLElement): void {
	(target.querySelector('[data-testid="back-to-top"]') as HTMLButtonElement).dispatchEvent(
		new MouseEvent('click', { shiftKey: true, bubbles: true, cancelable: true })
	);
}

describe('ConversationPanel — tool-peek popup + chip exclusivity', () => {
	it('the peek list opens/closes, and peek + chip detail are mutually exclusive both ways', async () => {
		stubPanelRoutes([]);
		const entries = [
			userEntry('u:1', 1, 'run the suite'),
			ctxEntry('c:1', 2, 'injected context'),
			toolCall('t:1', 3, 'call-1') as never
		];
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-peek', entries }));
		// Open the chip detail first.
		(target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement).click();
		await settle();
		expect(target.querySelector('[data-testid="context-injection-body"]')).not.toBeNull();

		// Peek open: clears the chip detail, shows the run list.
		const peekBtn = target.querySelector('[data-testid="tool-peek-button"]') as HTMLButtonElement;
		expect(peekBtn.getAttribute('data-active')).toBe('false');
		peekBtn.click();
		await settle();
		expect(peekBtn.getAttribute('data-active')).toBe('true');
		expect(target.querySelector('[data-testid="tool-peek-list"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="context-injection-body"]')).toBeNull(); // exclusivity

		// Peek toggle off again (same run key → null).
		peekBtn.click();
		await settle();
		expect(target.querySelector('[data-testid="tool-peek-list"]')).toBeNull();

		// Reopen the peek, then a chip toggle clears IT (the other direction).
		peekBtn.click();
		await settle();
		expect(target.querySelector('[data-testid="tool-peek-list"]')).not.toBeNull();
		(target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement).click();
		await settle();
		expect(target.querySelector('[data-testid="tool-peek-list"]')).toBeNull();
		expect(target.querySelector('[data-testid="context-injection-body"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationPanel — composer stick toggle', () => {
	it('OFF releases without scrolling; ON re-engages AND jumps to the live end', async () => {
		stubPanelRoutes([]);
		const { target, instance } = await mountPanel(
			coldProps({ agent: 'app-dev', sessionId: 's-stick', entries: [userEntry('u:1', 1, 'hello')] })
		);
		const vp = target.querySelector('[data-testid="transcript"]') as HTMLElement;
		const scrollTo = vi.fn();
		Object.defineProperty(vp, 'scrollTo', { value: scrollTo, configurable: true });
		const tog = target.querySelector('[data-testid="stick-toggle"]') as HTMLButtonElement;
		expect(tog.getAttribute('data-active')).toBe('true'); // engaged at mount

		tog.click(); // release — no jump
		await settle();
		expect(tog.getAttribute('data-active')).toBe('false');
		expect(scrollTo).not.toHaveBeenCalled();

		tog.click(); // re-engage — the promise: follow means GO there
		await settle();
		expect(tog.getAttribute('data-active')).toBe('true');
		expect(scrollTo.mock.calls.length).toBeGreaterThanOrEqual(1);
		expect(scrollTo).toHaveBeenLastCalledWith({ top: vp.scrollHeight, behavior: 'smooth' });
		unmount(instance);
	});

	it('the far-edge up click releases the stick (toggle OFF, 2026-09-08)', async () => {
		// BackToTheEdgeButton's onleavebottom rides the OFF arm: reading
		// history up top must not keep the live-end follow engaged — the
		// release lands before the button's viewport move (the order is
		// pinned in floating-anchor.test.ts; this pins the integration).
		// Geometry: a JUST-overflowing transcript (400px) read at the live
		// end — scrollTop 400 is both the bottom (stick window, atBottom
		// holds) and past the button's 200px mode threshold (top mode).
		// Deeper fakes release the stick through the plain scroll-event
		// path before the click could prove anything.
		stubPanelRoutes([]);
		const { target, instance } = await mountPanel(
			coldProps({ agent: 'app-dev', sessionId: 's-stick-edge', entries: [userEntry('u:1', 1, 'hello')] })
		);
		const vp = target.querySelector('[data-testid="transcript"]') as HTMLElement;
		Object.defineProperty(vp, 'scrollHeight', { value: 2400, configurable: true });
		Object.defineProperty(vp, 'clientHeight', { value: 2000, configurable: true });
		vp.scrollTop = 400;
		vp.dispatchEvent(new Event('scroll'));
		await settle();
		const tog = target.querySelector('[data-testid="stick-toggle"]') as HTMLButtonElement;
		expect(tog.getAttribute('data-active')).toBe('true');

		(target.querySelector('[data-testid="back-to-top"]') as HTMLElement).click();
		await settle();
		expect(tog.getAttribute('data-active')).toBe('false');
		unmount(instance);
	});
});

describe('ConversationPanel — load-older guards and failures', () => {
	beforeEach(() => {
		FakeIntersectionObserver.instances = [];
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
	});

	afterEach(() => {
		installDefaultFetch();
	});

	it('an empty transcript with hasMore never fetches (firstSeq <= 0 guard)', async () => {
		const { calls } = stubPanelRoutes([]);
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-guard', hasMore: true }));
		FakeIntersectionObserver.instances[0]!.report(true);
		await settle();
		await settle();
		expect(calls.filter((c) => c.url.includes('/history'))).toHaveLength(0);
		expect(target.querySelector('[data-testid="transcript-empty"]')).not.toBeNull();
		unmount(instance);
	});

	it('a transport failure on the history fetch parks at the error + Retry', async () => {
		stubPanelRoutes([
			{
				test: (url) => url.includes('/history'),
				respond: () => Promise.reject(new Error('ledger unreachable'))
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-err', entries: [userEntry('u:1', 10, 'tail')], hasMore: true })
		);
		FakeIntersectionObserver.instances[0]!.report(true);
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="load-older-error"]')?.textContent).toContain(
			'ledger unreachable'
		);
		expect((target.querySelector('[data-testid="load-older-button"]') as HTMLElement).textContent).toContain(
			'Retry'
		);
		unmount(instance);
	});
});

describe('ConversationPanel — Shift+click drain (loadAllOlder)', () => {
	function historyCalls(calls: Array<{ url: string }>): string[] {
		return calls.filter((c) => c.url.includes('/history?')).map((c) => c.url.split('beforeSeq=')[1]);
	}

	it('drains every remaining page before the jump lands, then a second drain is a no-op', async () => {
		const { calls } = stubPanelRoutes([
			{
				test: (url) => url.endsWith('/history?beforeSeq=100'),
				respond: () => jsonRes({ ok: true, entries: [userEntry('u:60', 60, 'page one')], hasMore: true })
			},
			{
				test: (url) => url.endsWith('/history?beforeSeq=60'),
				respond: () => jsonRes({ ok: true, entries: [userEntry('u:20', 20, 'page two')], hasMore: false })
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-drain', entries: [userEntry('u:100', 100, 'tail')], hasMore: true })
		);
		fakeOverflow(target);
		await settle();
		expect(target.querySelector('[data-testid="back-to-top"]')).not.toBeNull();
		shiftClickTop(target);
		await settleAll();
		expect(historyCalls(calls)).toEqual(['100', '60']);
		expect(target.textContent).toContain('page two');
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull(); // ledger head reached
		expect(target.querySelector('[data-testid="load-older-error"]')).toBeNull();

		// Everything loaded: a second Shift+drain exits on the first check.
		fakeOverflow(target);
		await settle();
		shiftClickTop(target);
		await settleAll();
		expect(historyCalls(calls)).toEqual(['100', '60']); // nothing new
		unmount(instance);
	});

	it('a failing page stops the drain with the error standing (no infinite retry)', async () => {
		const { calls } = stubPanelRoutes([
			{
				test: (url) => url.endsWith('/history?beforeSeq=100'),
				respond: () => jsonRes({ ok: true, entries: [userEntry('u:60', 60, 'page one')], hasMore: true })
			},
			{
				test: (url) => url.includes('/history'),
				respond: () => jsonRes({ ok: false, error: { code: 'X', message: 'ledger fell over' } }, 500)
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-drain-err', entries: [userEntry('u:100', 100, 'tail')], hasMore: true })
		);
		fakeOverflow(target);
		await settle();
		shiftClickTop(target);
		await settleAll();
		expect(historyCalls(calls)).toEqual(['100', '60']); // page two fetched, THEN the drain saw the error
		expect(target.querySelector('[data-testid="load-older-error"]')?.textContent).toContain(
			'ledger fell over'
		);
		unmount(instance);
	});

	it('a duplicate page ends the drain cleanly (no error, sentinel gone)', async () => {
		const { calls } = stubPanelRoutes([
			{
				test: (url) => url.includes('/history'),
				// The "older" page repeats a seq the store already holds.
				respond: () => jsonRes({ ok: true, entries: [userEntry('u:100', 100, 'tail')], hasMore: true })
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-drain-dup', entries: [userEntry('u:100', 100, 'tail')], hasMore: true })
		);
		fakeOverflow(target);
		await settle();
		shiftClickTop(target);
		await settleAll();
		expect(historyCalls(calls)).toEqual(['100']); // one page, then the drain saw no progress
		expect(target.querySelector('[data-testid="load-older-error"]')).toBeNull();
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
		unmount(instance);
	});

	it('a lying ledger (hasMore forever) surfaces the page-cap error, never a spinner', async () => {
		const { calls } = stubPanelRoutes([
			{
				test: (url) => url.includes('/history'),
				respond: (url) => {
					const before = Number(url.split('beforeSeq=')[1]);
					return jsonRes({
						ok: true,
						entries: [userEntry(`u:${before - 1}`, before - 1, `page-${before - 1}`)],
						hasMore: true
					});
				}
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-drain-cap', entries: [userEntry('u:1000', 1000, 'tail')], hasMore: true })
		);
		fakeOverflow(target);
		await settle();
		shiftClickTop(target);
		await settleAll();
		await settleAll();
		expect(calls.filter((c) => c.url.includes('/history'))).toHaveLength(200);
		expect(target.querySelector('[data-testid="load-older-error"]')?.textContent).toContain(
			'stopped after 200 pages'
		);
		unmount(instance);
	}, 30_000);

	it('a sentinel auto-load racing the drain joins the in-flight page (shared promise)', async () => {
		// The in-flight join: the drain's page and the sentinel's auto-load
		// must observe the SAME completion — the second caller returns the
		// standing promise instead of firing a second fetch.
		FakeIntersectionObserver.instances = [];
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
		let releasePage1!: (value: Response) => void;
		const { calls } = stubPanelRoutes([
			{
				test: (url) => url.endsWith('/history?beforeSeq=100'),
				respond: () =>
					new Promise<Response>((resolve) => {
						releasePage1 = resolve;
					})
			},
			{
				test: (url) => url.endsWith('/history?beforeSeq=95'),
				respond: () => jsonRes({ ok: true, entries: [userEntry('u:90', 90, 'final page')], hasMore: false })
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({ sessionId: 's-join', entries: [userEntry('u:100', 100, 'tail')], hasMore: true })
		);
		// Start the drain (page 1 in flight)…
		fakeOverflow(target);
		await settle();
		shiftClickTop(target);
		// …then the sentinel wakes up mid-flight (visible, blocked while loading).
		FakeIntersectionObserver.instances[0]!.report(true);
		releasePage1(jsonRes({ ok: true, entries: [userEntry('u:95', 95, 'page one')], hasMore: true }));
		await settleAll();
		// Exactly two pages served — the sentinel's wake joined the drain's
		// page rather than fetching its own.
		expect(calls.filter((c) => c.url.includes('/history')).map((c) => c.url.split('beforeSeq=')[1])).toEqual(
			['100', '95']
		);
		expect(target.textContent).toContain('final page');
		unmount(instance);
	});
});

describe('ConversationPanel — cancel button', () => {
	it('a running turn shows Cancel; clicking POSTs the cancel route once', async () => {
		const { calls } = stubPanelRoutes([
			{ test: (url) => url.endsWith('/cancel'), respond: () => jsonRes({ ok: true }) },
			// Keep the turn running across polls — the default idle response
			// would flip isStreaming off and swap Cancel back to Send.
			{
				test: (url) => url.includes('/events'),
				respond: () => jsonRes({ ok: true, entries: [], lastSeq: -1, running: true, gap: false })
			}
		]);
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-cancel', running: true }));
		const cancel = target.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
		expect(cancel).not.toBeNull();
		cancel.click();
		await settle();
		await settle();
		const cancels = calls.filter((c) => c.url.endsWith('/cancel'));
		expect(cancels).toHaveLength(1);
		expect(cancels[0].method).toBe('POST');
		unmount(instance);
	});
});

describe('ConversationPanel — /permission lines (slash intercept)', () => {
	function permissionRoute(respond: () => Response | Promise<Response>): void {
		stubPanelRoutes([{ test: (url) => url.endsWith('/permission'), respond }]);
	}

	it('a preset switch runs host-side and prints the host reply text', async () => {
		const posts: string[] = [];
		stubPanelRoutes([
			{
				test: (url, init) => url.endsWith('/permission') && init?.method === 'POST',
				respond: (url, init) => {
					posts.push(String(init?.body));
					return jsonRes({ ok: true, text: 'preset: read-only (default was workspace-write)' });
				}
			}
		]);
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-line' }));
		await submitComposer(target, '/permission read-only');
		expect(posts).toEqual([JSON.stringify({ line: '/permission read-only' })]);
		expect(noteOf(target)).toContain('preset: read-only');
		unmount(instance);
	});

	it('bare /permission prints the current preset (ok without text → fixed copy)', async () => {
		const posts: string[] = [];
		stubPanelRoutes([
			{
				test: (url, init) => url.endsWith('/permission') && init?.method === 'POST',
				respond: (url, init) => {
					posts.push(String(init?.body));
					return jsonRes({ ok: true });
				}
			}
		]);
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-bare' }));
		await submitComposer(target, '/permission');
		expect(posts).toEqual([JSON.stringify({ line: '/permission' })]);
		expect(noteOf(target)).toContain('permission updated');
		unmount(instance);
	});

	it('a host rejection reports the message verbatim', async () => {
		permissionRoute(() => jsonRes({ ok: false, error: { message: 'unknown preset: nope' } }, 400));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-rej' }));
		await submitComposer(target, '/permission nope');
		expect(noteOf(target)).toContain('unknown preset: nope');
		unmount(instance);
	});

	it('an error body without a message degrades to the HTTP status line', async () => {
		permissionRoute(() => jsonRes({ ok: false }, 500));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-500' }));
		await submitComposer(target, '/permission custom-thing');
		expect(noteOf(target)).toContain('permission switch failed (HTTP 500)');
		unmount(instance);
	});

	it('a garbage JSON reply degrades to the HTTP status line (never throws)', async () => {
		permissionRoute(() => new Response('garbage', { status: 200 }));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-garbage' }));
		await submitComposer(target, '/permission read-only');
		expect(noteOf(target)).toContain('permission switch failed (HTTP 200)');
		unmount(instance);
	});

	it('a transport failure reports the error message', async () => {
		permissionRoute(() => Promise.reject(new Error('net gone')));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-net' }));
		await submitComposer(target, '/permission read-only');
		expect(noteOf(target)).toContain('permission switch failed (net gone)');
		unmount(instance);
	});

	it('a second command within the window replaces the note (timer reset)', async () => {
		let n = 0;
		permissionRoute(() => jsonRes({ ok: true, text: `switch number ${++n}` }));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-note' }));
		await submitComposer(target, '/permission read-only');
		expect(noteOf(target)).toContain('switch number 1');
		await submitComposer(target, '/permission workspace-write');
		expect(noteOf(target)).toContain('switch number 2');
		expect(noteOf(target)).not.toContain('switch number 1');
		unmount(instance);
	});

	it('the command note auto-dismisses after 5s', async () => {
		vi.useFakeTimers();
		try {
			permissionRoute(() => jsonRes({ ok: true, text: 'switched for real' }));
			const { target, instance } = await mountPanel(coldProps({ sessionId: 's-perm-dismiss' }));
			await submitComposer(target, '/permission read-only');
			expect(noteOf(target)).toContain('switched for real');
			vi.advanceTimersByTime(5_000);
			flushSync();
			expect(target.querySelector('[data-testid="command-note"]')).toBeNull();
			unmount(instance);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('ConversationPanel — access chip submits /permission (onpermission)', () => {
	function mountWithPermission(sessionId: string) {
		return mountPanel(
			coldProps({
				sessionId,
				permission: { ...localPermission(), current: 'read-only' } as never
			})
		);
	}

	it('a chip pick POSTs the typed line and resolves true on ok', async () => {
		const posts: string[] = [];
		stubPanelRoutes([
			{
				test: (url, init) => url.endsWith('/permission') && init?.method === 'POST',
				respond: (url, init) => {
					posts.push(String(init?.body));
					return jsonRes({ ok: true });
				}
			}
		]);
		const { target, instance } = await mountWithPermission('s-chip-ok');
		const chip = target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement;
		expect(chip).not.toBeNull();
		chip.click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="workspace-write"]') as HTMLElement).click();
		await settle();
		await settle();
		expect(posts).toEqual([JSON.stringify({ line: '/permission workspace-write' })]);
		unmount(instance);
	});

	it('an HTTP failure resolves false and the chip surfaces its error', async () => {
		stubPanelRoutes([
			{
				test: (url) => url.endsWith('/permission'),
				respond: () => jsonRes({ ok: false }, 500)
			}
		]);
		const { target, instance } = await mountWithPermission('s-chip-fail');
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="workspace-write"]') as HTMLElement).click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-error"]')).not.toBeNull();
		unmount(instance);
	});

	it('a transport failure resolves false (honest, never a thrown chip)', async () => {
		stubPanelRoutes([
			{
				test: (url) => url.endsWith('/permission'),
				respond: () => Promise.reject(new Error('dead wire'))
			}
		]);
		const { target, instance } = await mountWithPermission('s-chip-dead');
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="workspace-write"]') as HTMLElement).click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-error"]')).not.toBeNull();
		unmount(instance);
	});

	it('a garbage /permission reply resolves false without throwing', async () => {
		stubPanelRoutes([
			{
				test: (url) => url.endsWith('/permission'),
				respond: () => new Response('garbage', { status: 200 })
			}
		]);
		const { target, instance } = await mountWithPermission('s-chip-garbage');
		(target.querySelector('[data-testid="access-mode-chip"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="access-mode-option"][data-value="workspace-write"]') as HTMLElement).click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="access-mode-error"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationPanel — /new failure lanes', () => {
	afterEach(() => {
		registerReplacePanel(null);
	});

	function createRoute(respond: () => Response | Promise<Response>): { posts: string[] } {
		const posts: string[] = [];
		stubPanelRoutes([
			{
				test: (url, init) => url.endsWith('/api/dsh/sessions') && init?.method === 'POST',
				respond: (url, init) => {
					posts.push(String(init?.body));
					return respond();
				}
			}
		]);
		return { posts };
	}

	it('leftover args are a usage error before any wire traffic', async () => {
		const { posts } = createRoute(() => jsonRes({ ok: true, sessionId: 's-x' }));
		const { target, instance } = await mountPanel(coldProps({ panelId: 'p1', sessionId: 's-new-usage' }));
		await submitComposer(target, '/new leftover junk');
		expect(posts).toHaveLength(0);
		expect(noteOf(target)).toContain('usage: /new [@agent]');
		unmount(instance);
	});

	it('without a panel floor the command refuses with an honest note', async () => {
		const { posts } = createRoute(() => jsonRes({ ok: true, sessionId: 's-x' }));
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-new-nofloor' })); // panelId null
		await submitComposer(target, '/new');
		expect(posts).toHaveLength(0);
		expect(noteOf(target)).toContain('/new needs a panel floor');
		unmount(instance);
	});

	it('a rejected create reports the host message verbatim', async () => {
		createRoute(() => jsonRes({ ok: false, error: { message: 'agent-preset-not-found: nope' } }, 400));
		const { target, instance } = await mountPanel(coldProps({ panelId: 'p1', sessionId: 's-new-reject' }));
		await submitComposer(target, '/new @nope');
		expect(noteOf(target)).toContain('agent-preset-not-found: nope');
		unmount(instance);
	});

	it('a garbage create reply degrades to the HTTP status line', async () => {
		createRoute(() => new Response('garbage', { status: 502 }));
		const { target, instance } = await mountPanel(coldProps({ panelId: 'p1', sessionId: 's-new-garbage' }));
		await submitComposer(target, '/new');
		expect(noteOf(target)).toContain('/new failed (HTTP 502)');
		unmount(instance);
	});

	it('a successful create with no floor swap handler reports the dead floor', async () => {
		createRoute(() => jsonRes({ ok: true, sessionId: 's-successor' }));
		registerReplacePanel(null); // no floor mounted — the swap cannot land
		const { target, instance } = await mountPanel(coldProps({ panelId: 'p1', sessionId: 's-new-swap' }));
		await submitComposer(target, '/new');
		expect(noteOf(target)).toContain('the floor is not mounted');
		unmount(instance);
	});

	it('a transport failure on create reports the message', async () => {
		createRoute(() => Promise.reject(new Error('create exploded')));
		const { target, instance } = await mountPanel(coldProps({ panelId: 'p1', sessionId: 's-new-net' }));
		await submitComposer(target, '/new');
		expect(noteOf(target)).toContain('/new failed (create exploded)');
		unmount(instance);
	});
});

describe('ConversationPanel — mention failure lanes', () => {
	const SELF = 'session-bbbbbbbb-0000-4000-8000-000000000001';
	const TARGET_UUID = '2c26d442-94bc-422c-afb1-e870db9906a3';
	const TARGET = `session-${TARGET_UUID}`;

	function targetRow(): Record<string, unknown> {
		return { sessionId: TARGET, title: 'Target', agentPreset: 'main', running: false, blank: false, updatedAt: 1, workspace: null, turns: 3 };
	}

	type Lane = 'spine' | 'prompt' | 'register';

	/** Stub the mention wire: each lane overridable (Response, raw text, or throw). */
	function stubMention(overrides: Partial<Record<Lane, { json?: unknown; status?: number; raw?: string; throw?: Error }>>): {
		prompts: number;
		registers: number;
	} {
		const counts = { prompts: 0, registers: 0 };
		stubPanelRoutes([
			{
				test: (url) => url.endsWith('/api/dsh/sessions') && !url.includes('/session/'),
				respond: () => {
					const o = overrides.spine;
					if (o?.throw) return Promise.reject(o.throw);
					if (o?.raw !== undefined) return new Response(o.raw, { status: o.status ?? 200 });
					return jsonRes({ ok: true, sessions: [targetRow()] });
				}
			},
			{
				test: (url) => /\/api\/dsh\/session\/[^/]+\/prompt$/.test(url),
				respond: () => {
					counts.prompts += 1;
					const o = overrides.prompt;
					if (o?.throw) return Promise.reject(o.throw);
					if (o?.raw !== undefined) return new Response(o.raw, { status: o.status ?? 200 });
					return jsonRes({ ok: true, accepted: true });
				}
			},
			{
				test: (url) => url.endsWith('/api/a2a/register'),
				respond: () => {
					counts.registers += 1;
					const o = overrides.register;
					if (o?.throw) return Promise.reject(o.throw);
					if (o?.raw !== undefined) return new Response(o.raw, { status: o.status ?? 200 });
					return jsonRes({ ok: true });
				}
			}
		]);
		return counts;
	}

	afterEach(() => {
		registerAddPanel(null);
	});

	it('a garbage spine list reads as "no such session" — nothing sent', async () => {
		const counts = stubMention({ spine: { raw: 'garbage', status: 200 } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(noteOf(target)).toContain('no such session');
		expect(counts.prompts).toBe(0);
		unmount(instance);
	});

	it('a spine transport failure is an honest retry note (never "no such session")', async () => {
		const counts = stubMention({ spine: { throw: new Error('spine down') } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(noteOf(target)).toContain('session list unavailable');
		expect(counts.prompts).toBe(0);
		unmount(instance);
	});

	it('a garbage prompt receipt degrades to the HTTP status line, no watch registered', async () => {
		const counts = stubMention({ prompt: { raw: 'garbage', status: 200 } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(noteOf(target)).toContain('mention failed (HTTP 200)');
		expect(counts.prompts).toBe(1);
		expect(counts.registers).toBe(0);
		unmount(instance);
	});

	it('a prompt transport failure reports the message', async () => {
		const counts = stubMention({ prompt: { throw: new Error('prompt wire dead') } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		expect(noteOf(target)).toContain('mention failed (prompt wire dead)');
		expect(counts.registers).toBe(0);
		unmount(instance);
	});

	it('a garbage register reply still says "sent, but untracked"', async () => {
		const counts = stubMention({ register: { raw: 'garbage', status: 200 } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		await vi.waitFor(() => expect(noteOf(target)).toContain('sent, but untracked'));
		expect(counts.registers).toBe(1);
		unmount(instance);
	});

	it('a register transport failure still says "sent, but untracked"', async () => {
		const counts = stubMention({ register: { throw: new Error('ledger down') } });
		registerAddPanel(() => {});
		const { target, instance } = await mountPanel(coldProps({ sessionId: SELF }));
		await submitComposer(target, `@session-${TARGET_UUID} hello`);
		await vi.waitFor(() => expect(noteOf(target)).toContain('sent, but untracked'));
		expect(counts.registers).toBe(1);
		unmount(instance);
	});
});

describe('ConversationPanel — footer context tokens (last usage wins)', () => {
	it('the LAST assistant usage record renders as the ≈N ctx label', async () => {
		stubPanelRoutes([]);
		const { target, instance } = await mountPanel(
			coldProps({
				sessionId: 's-ctx-plain',
				entries: [
					userEntry('u:1', 1, 'question'),
					assistantUsage('a:2', 2, { inputTokens: 900, cacheReadTokens: 60, cacheWriteTokens: 40 }) as never,
					assistantUsage('a:3', 3, { inputTokens: 400 }) as never
				]
			})
		);
		await settle();
		const label = target.querySelector('[data-testid="context-consumption"]') as HTMLElement;
		expect(label.textContent).toContain('400'); // 400 = the LAST record, not 1000
		expect(label.textContent).toContain('ctx');
		unmount(instance);
	});

	it('a known model resolves the window and renders the percentage bar', async () => {
		stubPanelRoutes([
			{
				test: (url) => url.endsWith('/models'),
				respond: () => jsonRes({ current: { provider: 'zai', model: 'glm-5.2' }, routable: true, groups: [], failures: [] })
			}
		]);
		const { target, instance } = await mountPanel(
			coldProps({
				sessionId: 's-ctx-pct',
				entries: [
					userEntry('u:1', 1, 'question'),
					assistantUsage('a:2', 2, { inputTokens: 500_000 }) as never
				]
			})
		);
		await settle();
		await settle();
		const label = target.querySelector('[data-testid="context-consumption"]') as HTMLElement;
		expect(label.textContent).toContain('50%'); // 500k of glm-5.2's 1M window
		unmount(instance);
	});
});

describe('ConversationPanel — answerer cards (cold pending + settled)', () => {
	it('a cold approval card answers through the carrier (POST /respond)', async () => {
		const { calls } = stubPanelRoutes([
			{ test: (url) => url.endsWith('/respond'), respond: () => jsonRes({ ok: true, accepted: true }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({
				sessionId: 's-approve',
				pendingAnswers: [
					{
						rpcId: 'rpc-1',
						sessionId: 's-approve',
						kind: 'approval',
						body: { approvalId: 'appr-1', toolName: 'bash', callId: 'call-9' },
						receivedAt: 1
					}
				]
			})
		);
		const card = target.querySelector('[data-testid="approval-card"]') as HTMLElement;
		expect(card.getAttribute('data-phase')).toBe('waiting');
		expect(target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('bash');
		expect(target.querySelector('[data-testid="answerer-pending"]')).not.toBeNull();
		(target.querySelector('[data-testid="approval-allow"]') as HTMLButtonElement).click();
		await settleAll();
		const responds = calls.filter((c) => c.url.endsWith('/respond'));
		expect(responds).toHaveLength(1);
		expect(responds[0].method).toBe('POST');
		const body = JSON.parse(responds[0].body ?? '{}');
		expect(body.rpcId).toBe('rpc-1');
		expect(body.payload).toEqual({ approvalId: 'appr-1', outcome: 'allowed-once' });
		unmount(instance);
	});

	it('a withdrawn cold answer renders the dimmed settled card with no buttons', async () => {
		stubPanelRoutes([]);
		const { target, instance } = await mountPanel(
			coldProps({
				sessionId: 's-withdrawn',
				pendingAnswers: [
					{
						rpcId: 'rpc-2',
						sessionId: 's-withdrawn',
						kind: 'approval',
						body: { approvalId: 'a', toolName: 'edit' },
						receivedAt: 1
					}
				],
				settledAnswers: [
					{ rpcId: 'rpc-2', sessionId: 's-withdrawn', kind: 'approval', outcome: 'cancelled', settledAt: 2 }
				]
			})
		);
		expect(target.querySelector('[data-testid="answerer-settled"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="answerer-pending"]')).toBeNull();
		const card = target.querySelector('[data-testid="approval-card"]') as HTMLElement;
		expect(card.getAttribute('data-phase')).toBe('withdrawn');
		expect(target.querySelector('[data-testid="approval-allow"]')).toBeNull(); // not answerable
		unmount(instance);
	});
});

describe('ConversationPanel — a2a delegation chips (sender join)', () => {
	it('cold a2a rows render the chip stack with the live state', async () => {
		stubPanelRoutes([]);
		const { target, instance } = await mountPanel(
			coldProps({
				sessionId: 's-a2a',
				a2aRows: [
					{
						id: 'a2a-feed0000000001',
						fromSession: 's-a2a',
						toSession: 'session-x',
						message: 'run the tests',
						state: 'waiting',
						sentAt: 1,
						settledAt: null,
						error: null
					}
				],
				a2aTitles: { 'session-x': 'Target X' }
			})
		);
		const chip = target.querySelector('[data-testid="a2a-chip"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.getAttribute('data-a2a-state')).toBe('waiting');
		// The target title is join data for the chip's own popup, not the
		// collapsed label — the panel's lane is the read-only pass-through.
		expect(chip.getAttribute('data-a2a-id')).toBe('a2a-feed0000000001');
		unmount(instance);
	});
});

describe('ConversationPanel — in-header rename (EditingTitle wiring)', () => {
	it('a successful rename shows optimistically in the header via ontitlechange', async () => {
		stubPanelRoutes([
			{ test: (url) => url.endsWith('/rename'), respond: () => jsonRes({ ok: true, title: 'Renamed in panel' }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ sessionId: 's-rename', title: 'Cold title' }));
		const btn = target.querySelector('[data-testid="session-title"]') as HTMLElement;
		expect(btn.textContent).toContain('Cold title');
		btn.click();
		await settle();
		const input = target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		input.value = 'Renamed in panel';
		input.dispatchEvent(new Event('input'));
		flushSync();
		(target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settleAll();
		expect(target.querySelector('[data-testid="session-title"]')?.textContent).toContain(
			'Renamed in panel'
		);
		unmount(instance);
	});
});

describe('ConversationPanel — sub-agent read-only surface (host agent-busy fence)', () => {
	it('hides the composer: no prompt input renders at all', async () => {
		const { target, instance } = await mountPanel(coldProps({ subagent: true }));
		expect(target.querySelector('[data-testid="prompt-input"]')).toBeNull();
		unmount(instance);
	});

	it('tints the transcript beige at depth 1 and keeps it scrollable', async () => {
		const { target, instance } = await mountPanel(coldProps({ subagent: true }));
		const transcript = target.querySelector('[data-testid="transcript"]');
		expect(transcript).not.toBeNull();
		expect(transcript!.className).toContain('bg-[var(--color-subagent-tint-1)]');
		unmount(instance);
	});

	it('deepens the tint per nesting level: depth 2 darker, depth 3+ capped darkest', async () => {
		const d2 = await mountPanel(coldProps({ subagent: true, depth: 2 }));
		expect(d2.target.querySelector('[data-testid="transcript"]')?.className).toContain('bg-[var(--color-subagent-tint-2)]');
		unmount(d2.instance);
		const d3 = await mountPanel(coldProps({ subagent: true, depth: 3 }));
		expect(d3.target.querySelector('[data-testid="transcript"]')?.className).toContain('bg-[var(--color-subagent-tint-3)]');
		unmount(d3.instance);
		const d5 = await mountPanel(coldProps({ subagent: true, depth: 5 }));
		expect(d5.target.querySelector('[data-testid="transcript"]')?.className).toContain('bg-[var(--color-subagent-tint-3)]');
		unmount(d5.instance);
	});

	it('depth on an ordinary session tints nothing (the tint needs subagent origin)', async () => {
		const h = await mountPanel(coldProps({ depth: 3 }));
		expect(h.target.querySelector('[data-testid="transcript"]')?.className).not.toContain('#');
		unmount(h.instance);
	});

	it('renders the header title as plain text (no rename trigger)', async () => {
		const { target, instance } = await mountPanel(coldProps({ subagent: true }));
		const title = target.querySelector('[data-testid="session-title"]');
		expect(title?.tagName).toBe('SPAN');
		unmount(instance);
	});

	it('keeps the ordinary panel untouched: composer present, no beige tint', async () => {
		const { target, instance } = await mountPanel(coldProps());
		expect(target.querySelector('[data-testid="prompt-input"], [data-testid="prompt-input-textarea"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="transcript"]')?.className).not.toContain('--color-subagent-tint');
		unmount(instance);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Auto-open the live Think (2026-08-31): while the panel STREAMS and the
// reader follows the live end (stick), the LATEST think chip auto-expands
// through the page-owned openChipId — earlier thinks stay closed, a newer
// think MOVES the open, a manual pick wins while held, collapsing the auto
// think suppresses it until the next think, and turn end (or leaving the
// live end) closes the auto think.
// ═══════════════════════════════════════════════════════════════════════

/** Think-bearing assistant message (DsiEntry): reasoning rides beside text. */
function thinkEntry(id: string, seq: number, reasoning: string, streaming = false): Record<string, unknown> {
	return {
		kind: 'assistant-message',
		id,
		seq,
		time: 1000 + seq,
		text: '',
		streaming,
		reasoning,
		reasoningStreaming: streaming
	};
}

/** A todo_write tool-call entry — the plan-card chip (the other watched kind).
 *  argsRaw parses (parseTodoList: {todos:[{content,status}...]}) so the
 *  popup renders the plan CARD, not the junk-args raw panes. */
function todoEntry(id: string, seq: number, callId: string): Record<string, unknown> {
	return {
		kind: 'tool-call',
		id,
		seq,
		time: 1000 + seq,
		callId,
		toolName: 'todo_write',
		summary: 'wrote the plan',
		status: 'pass',
		argsRaw: JSON.stringify({ todos: [{ content: 'load the folders', status: 'in_progress' }] })
	};
}

/** The rendered think chips' data-open flags, wire order. */
function thinkOpens(target: HTMLElement): string[] {
	return [...target.querySelectorAll('[data-testid="reasoning-section"]')].map((el) =>
		el.getAttribute('data-open') ?? '(missing)'
	);
}

/** One live poll tick: the 500 ms running-cadence timer plus a settle. */
async function pollTick(): Promise<void> {
	await new Promise((r) => setTimeout(r, 600));
	await settleAll();
}

describe('ConversationPanel — auto-open the live Think (streaming + stick)', () => {
	it('expands the LAST think while streaming; earlier thinks stay closed', async () => {
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: [], lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({
				running: true,
				entries: [thinkEntry('a1', 2, 'first thoughts'), thinkEntry('a2', 4, 'second thoughts', true)]
			})
		);
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false', 'true']);
		// The auto think's BODY popup renders (its scroller carries the
		// shared stick-to-bottom and follows the deltas).
		expect(target.querySelector('[data-testid="reasoning-body"]')).not.toBeNull();
		unmount(instance);
	});

	it('a newer think MOVES the open on a later poll (earlier one closes)', async () => {
		let delta: Record<string, unknown>[] = [];
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: delta, lastSeq: 6, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ running: true, entries: [thinkEntry('a1', 2, 'only think')] }));
		await pollTick();
		expect(thinkOpens(target)).toEqual(['true']);
		delta = [thinkEntry('a2', 6, 'newer think', true)];
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false', 'true']);
		unmount(instance);
	});

	it('turn end (running=false) closes the auto think', async () => {
		let running = true;
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: [], lastSeq: 2, running: running, gap: false }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ running: true, entries: [thinkEntry('a1', 2, 'the think', true)] }));
		await pollTick();
		expect(thinkOpens(target)).toEqual(['true']);
		running = false;
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false']);
		expect(target.querySelector('[data-testid="reasoning-body"]')).toBeNull();
		unmount(instance);
	});

	it('collapsing the auto think suppresses it; the NEXT think re-engages', async () => {
		let delta: Record<string, unknown>[] = [];
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: delta, lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({ running: true, entries: [thinkEntry('a1', 2, 'first'), thinkEntry('a2', 4, 'second', true)] })
		);
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false', 'true']);
		// The user collapses the auto think — it stays closed across polls.
		(target.querySelectorAll('[data-testid="reasoning-toggle"]')[1] as HTMLElement).click();
		await settle();
		expect(thinkOpens(target)).toEqual(['false', 'false']);
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false', 'false']);
		// A NEW think re-engages the auto on the new target.
		delta = [thinkEntry('a3', 6, 'third', true)];
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false', 'false', 'true']);
		unmount(instance);
	});

	it('a manual pick renders BESIDE the auto think; collapsing the auto think suppresses it', async () => {
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: [], lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({
				running: true,
				entries: [thinkEntry('a1', 2, 'the think', true), toolCall('tc1', 4, 'call-1')]
			})
		);
		await pollTick();
		expect(thinkOpens(target)).toEqual(['true']);
		// The user opens the tool chip — a manual popup beside the auto one;
		// the auto think does NOT close.
		(target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement).click();
		await settle();
		await pollTick();
		expect(thinkOpens(target)).toEqual(['true']);
		// Collapsing the auto think suppresses THAT think (a newer one
		// re-engages); the manual popup is unaffected.
		(target.querySelector('[data-testid="reasoning-toggle"]') as HTMLElement).click();
		await settle();
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false']);
		unmount(instance);
	});

	it('stick OFF (reader scrolled away) never auto-opens', async () => {
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: [], lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({ agent: 'app-dev', running: true, entries: [thinkEntry('a1', 2, 'the think', true)] })
		);
		// The floating stick toggle: OFF releases the live end.
		(target.querySelector('[data-testid="stick-toggle"]') as HTMLElement).click();
		await settle();
		await pollTick();
		expect(thinkOpens(target)).toEqual(['false']);
		expect(target.querySelector('[data-testid="reasoning-body"]')).toBeNull();
		unmount(instance);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// The plan slot (2026-08-31 revision): todo_write joins think as a SECOND,
// INDEPENDENT auto slot. The plan is STICKY — it survives newer thinks and
// the turn ending (the current plan stays readable after the work is
// done); only a NEWER todo_write supersedes it, or the user collapses it.
// ═══════════════════════════════════════════════════════════════════════

describe('ConversationPanel — the plan slot: todo_write auto-open is sticky (streaming + stick)', () => {
	it('a todo_write auto-opens BESIDE the last think (the slots are independent)', async () => {
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: [], lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(
			coldProps({ running: true, entries: [thinkEntry('a1', 2, 'thinking first', true), todoEntry('t1', 4, 'call-t1')] })
		);
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="reasoning-body"]')).not.toBeNull();
		expect(thinkOpens(target)).toEqual(['true']);
		unmount(instance);
	});

	it('the plan survives a newer think AND turn end (persistent)', async () => {
		let running = true;
		let delta: Record<string, unknown>[] = [];
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: delta, lastSeq: 6, running: running, gap: false }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ running: true, entries: [todoEntry('t1', 2, 'call-t1')] }));
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		// A newer think must NOT close the plan...
		delta = [thinkEntry('a1', 6, 'now thinking', true)];
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		expect(thinkOpens(target)).toEqual(['true']);
		// ...and the turn ending must not either — only the think closes.
		running = false;
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		expect(thinkOpens(target)).toEqual(['false']);
		unmount(instance);
	});

	it('a newer todo_write supersedes the open plan (exactly one plan card)', async () => {
		let delta: Record<string, unknown>[] = [];
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: delta, lastSeq: 6, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ running: true, entries: [todoEntry('t1', 2, 'call-t1')] }));
		await pollTick();
		expect(target.querySelectorAll('[data-testid="todo-card"]')).toHaveLength(1);
		delta = [todoEntry('t2', 6, 'call-t2')];
		await pollTick();
		// Still exactly ONE plan card — the newer todo_write took the slot.
		expect(target.querySelectorAll('[data-testid="todo-card"]')).toHaveLength(1);
		unmount(instance);
	});

	it('collapsing the auto plan suppresses it until a newer plan arrives', async () => {
		let delta: Record<string, unknown>[] = [];
		stubPanelRoutes([
			{ test: (url) => url.includes('/events'), respond: () => jsonRes({ ok: true, entries: delta, lastSeq: 4, running: true, gap: false }) }
		]);
		const { target, instance } = await mountPanel(coldProps({ running: true, entries: [todoEntry('t1', 2, 'call-t1')] }));
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		// The user collapses the auto plan — it stays closed across polls.
		(target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement).click();
		await settle();
		expect(target.querySelector('[data-testid="todo-card"]')).toBeNull();
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).toBeNull();
		// A newer todo_write re-engages the slot.
		delta = [todoEntry('t2', 4, 'call-t2')];
		await pollTick();
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationPanel — goal editor wiring (Goal Editor W2, Task 2.2-T)', () => {
	const GOAL = {
		id: 'goal-e1',
		revision: 3,
		objective: 'original objective',
		phase: 'paused' as const,
		roundsStarted: 1,
		maxGoalRounds: 8
	};

	const postBodies: unknown[] = [];

	/** Fetch double: the poll carries the goal projection; POST /goal is
	 *  captured and answered by the case. */
	function installGoalFetch(postResponse: { status: number; body: unknown }): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/goal') && init?.method === 'POST') {
					postBodies.push(JSON.parse(String(init.body)));
					return new Response(JSON.stringify(postResponse.body), {
						status: postResponse.status,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (url.includes('/events')) {
					return new Response(
						JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, goal: GOAL }),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				if (url.includes('/api/dsh/sessions')) return new Response(JSON.stringify({ ok: true, sessions: [] }), { status: 200 });
				if (url.includes('/models')) return new Response(JSON.stringify({ ok: true, current: null }), { status: 200 });
				return new Response(JSON.stringify({ ok: true, entries: [], hasMore: false }), { status: 200 });
			})
		);
	}

	const q = (root: HTMLElement, id: string) => root.querySelector('[data-testid="' + id + '"]') as HTMLElement;
	const type = (el: HTMLElement, value: string) => {
		(el as HTMLInputElement).value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};

	async function mountWithGoal() {
		postBodies.length = 0;
		const h = await mountPanel(coldProps());
		await vi.waitFor(() => {
			if (q(h.target, 'goal-bar') === null) throw new Error('goal bar not seeded yet');
		});
		return h;
	}

	it('Edit opens the pre-filled form; submit sends only the changed fields; success closes', async () => {
		installGoalFetch({ status: 200, body: { ok: true, value: { ...GOAL, revision: 4, objective: 'changed objective' } } });
		const h = await mountWithGoal();
		q(h.target, 'goal-edit').click();
		await settle();
		expect(q(h.target, 'goal-edit-form')).not.toBeNull();
		expect((q(h.target, 'goal-edit-objective') as HTMLTextAreaElement).value).toBe('original objective');
		type(q(h.target, 'goal-edit-objective'), 'changed objective');
		q(h.target, 'goal-edit-submit').click();
		await settle();
		expect(postBodies).toEqual([
			{ verb: 'edit', ref: { id: 'goal-e1', revision: 3 }, edit: { objective: 'changed objective' } }
		]);
		// success closes the editor and applies the returned view to the chip
		await vi.waitFor(() => {
			if (q(h.target, 'goal-edit-form') !== null) throw new Error('editor still open');
		});
		expect(h.target.textContent).toContain('changed objective');
		unmount(h.instance);
		h.target.remove();
	});

	it('submit with no change sends NO request and keeps the form open', async () => {
		installGoalFetch({ status: 200, body: { ok: true, value: GOAL } });
		const h = await mountWithGoal();
		q(h.target, 'goal-edit').click();
		await settle();
		q(h.target, 'goal-edit-submit').click();
		await settle();
		expect(postBodies).toEqual([]);
		expect(q(h.target, 'goal-edit-form')).not.toBeNull();
		unmount(h.instance);
		h.target.remove();
	});

	it('a refused edit keeps the form open and surfaces the host message', async () => {
		installGoalFetch({
			status: 409,
			body: { ok: false, error: { code: 'GOAL_INVALID_TRANSITION', message: 'goal "goal-e1" is already active and armed' } }
		});
		const h = await mountWithGoal();
		q(h.target, 'goal-edit').click();
		await settle();
		type(q(h.target, 'goal-edit-objective'), 'doomed edit');
		q(h.target, 'goal-edit-submit').click();
		await settle();
		expect(postBodies).toHaveLength(1);
		expect(q(h.target, 'goal-edit-form')).not.toBeNull();
		expect(h.target.textContent).toContain('already active and armed');
		unmount(h.instance);
		h.target.remove();
	});

	it('Cancel discards the editor without a request', async () => {
		installGoalFetch({ status: 200, body: { ok: true, value: GOAL } });
		const h = await mountWithGoal();
		q(h.target, 'goal-edit').click();
		await settle();
		type(q(h.target, 'goal-edit-objective'), 'never submitted');
		q(h.target, 'goal-edit-cancel').click();
		await settle();
		expect(postBodies).toEqual([]);
		expect(q(h.target, 'goal-edit-form')).toBeNull();
		unmount(h.instance);
		h.target.remove();
	});
});
