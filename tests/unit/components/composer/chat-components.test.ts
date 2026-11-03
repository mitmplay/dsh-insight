/**
 * chat-components unit tests (paired with task 3.4).
 *
 * Composer: submit button flips to red Cancel while isStreaming; dots
 * render when running; chip toggles open/closed; Enter submits, Shift+Enter
 * newlines; rapid double-submit blocked — input locked until receipt (BC-3:
 * `sending` covers the receipt window).
 */

import { flushSync } from 'svelte';
import { mount, unmount, createRawSnippet, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import StreamingIndicator from '$lib/components/composer/sibling/StreamingIndicator.svelte';
import ToolCallChip from '$lib/components/message/chips/ToolCallChip.svelte';
import ToolCallDetail from '$lib/components/message/ToolCallDetail.svelte';
import FileContentViewer from '$lib/components/common/viewers/FileContentViewer.svelte';
import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';
import AssistantTurn from '$lib/components/message/assistant/AssistantTurn.svelte';
import PromptBubbleSnippetHost from '../../../fixtures/PromptBubbleSnippetHost.svelte';
import ReasoningSection from '$lib/components/message/ReasoningSection.svelte';
import RuntimeContextChip from '$lib/components/message/chips/RuntimeContextChip.svelte';
import ContextInjection from '$lib/components/message/chips/ContextInjectionChip.svelte';
import ApprovalCard from '$lib/components/card/ApprovalCard.svelte';
import QuestionCard from '$lib/components/card/QuestionCard.svelte';
import ModelSelector from '$lib/components/composer/sibling/ModelSelector.svelte';
import ContextConsumption from '$lib/components/composer/sibling/ContextConsumption.svelte';
import { contextWindowOf, CTX_WINDOW_OVERRIDES_KEY } from '$lib/utils/context-window';
import {
	registerAddPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';

function mountApproval(props: Partial<ComponentProps<typeof ApprovalCard>> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const answered: Array<'allowed-once' | 'rejected'> = [];
	const comp = mount(ApprovalCard, {
		target,
		props: {
			rpcId: 'rpc-a1',
			toolName: 'Write',
			approvalId: 'apr-1',
			phase: 'waiting',
			onanswer: (o: 'allowed-once' | 'rejected') => answered.push(o),
			...props
		}
	});
	return { target, answered, comp };
}

/** Mount helper — bubble under test with settled flushes. */
function mountBubble(props: { text: string; time?: number }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptBubble, { target, props });
	return { target, comp };
}

describe('PromptBubble — Wave-2 readable rendering (task 2.2-T); user-side only since the OCI two-group adoption', () => {
	it('renders markdown: bold becomes a strong element inside the bubble', () => {
		const { target, comp } = mountBubble({ text: 'Cost is **~1–3%** of tokens.' });
		const strong = target.querySelector('[data-testid="message-bubble"] strong');
		expect(strong).not.toBeNull();
		expect(strong?.textContent).toBe('~1–3%');
		expect(target.querySelector('[data-testid="message-bubble"] p')?.textContent).toContain('Cost is');
		unmount(comp);
	});

	it('BC-12: an XSS attempt renders as inert characters — no script/img nodes, no handler fires', () => {
		const { target, comp } = mountBubble({
			text: 'hello <script>window.__pwned=1</script> <img src=x onerror="window.__pwned=2"> [x](javascript:alert(1))'
		});
		expect(target.querySelector('script')).toBeNull();
		expect(target.querySelector('img')).toBeNull();
		expect(target.querySelector('a')).toBeNull(); // javascript: link refused
		expect((window as { __pwned?: number }).__pwned).toBeUndefined();
		expect(target.querySelector('[data-testid="message-bubble"]')?.textContent).toContain('<script>');
		unmount(comp);
	});

	it('timestamp renders from entry.time (relativeTime contract, title carries the ISO instant)', async () => {
		const past = Date.now() - 5 * 60 * 1000; // 5 minutes ago
		const { target, comp } = mountBubble({ text: 'Hi', time: past });
		const stamp = target.querySelector('[data-testid="message-time"]') as HTMLElement;
		expect(stamp).not.toBeNull();
		expect(stamp.textContent).toBe('5m ago');
		expect(stamp.getAttribute('title')).toBe(new Date(past).toISOString());
		unmount(comp);
	});

	it('no time prop → no timestamp node (test mounts / degenerate entries)', () => {
		const { target, comp } = mountBubble({ text: 'Hi' });
		expect(target.querySelector('[data-testid="message-time"]')).toBeNull();
		unmount(comp);
	});

	it('timestamp live-ticks: "30s ago" advances to "1m ago" without a re-render', () => {
		vi.useFakeTimers();
		try {
			const { target, comp } = mountBubble({ text: 'Hi', time: Date.now() - 30_000 });
			const stamp = target.querySelector('[data-testid="message-time"]') as HTMLElement;
			expect(stamp.textContent).toBe('30s ago');

			// Let the component's $effect register its interval before advancing
			flushSync();
			vi.advanceTimersByTime(40_000);
			flushSync();
			expect(stamp.textContent).toBe('1m ago');
			unmount(comp);
		} finally {
			vi.useRealTimers();
		}
	});


	it('OCI pattern: user bubble corners — rounded-2xl + square bottom-right (rounded-br-sm)', () => {
		const { target, comp } = mountBubble({ text: 'Hi' });
		const bubble = target.querySelector('[data-testid="message-bubble"]') as HTMLElement;
		expect(bubble.className).toContain('rounded-2xl');
		expect(bubble.className).toContain('rounded-br-sm');
		expect(bubble.className).not.toContain('rounded-bl-sm');
		expect(bubble.className).toContain('bg-accent-blue/15');
		expect(bubble.className).toContain('border-accent-blue/20');
		unmount(comp);
	});

	it('OCI pattern: user bubble is right-aligned (flex items-end column)', () => {
		const { target, comp } = mountBubble({ text: 'Hi' });
		const wrapper = target.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain('items-end');
		unmount(comp);
	});

	it('children snippet still rides along (streaming dots preserved)', async () => {
		// Snippet passing needs a real client parent (createRawSnippet is
		// server-only) — the fixture mounts PromptBubble the way the page does.
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(PromptBubbleSnippetHost, { target, props: { text: 'thinking…', time: Date.now() } });
		expect(target.querySelector('[data-testid="streaming-indicator"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="message-bubble"] p')?.textContent).toContain('thinking…');
		unmount(comp);
	});

	// --- Action row (OCI port, 2026-08-22): Copy text · Copy canvas · Save prompt · Raw ---

	it('action row: 4 buttons render near the content edge when text+time present', () => {
		const { target, comp } = mountBubble({ text: 'hello **world**', time: Date.now() });
		const row = target.querySelector('[data-testid="prompt-action-row"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.className).toContain('absolute bottom-0.15 left-1/2 -translate-x-1/2');
		expect(row.querySelector('[data-testid="copy-text-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="save-prompt-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		unmount(comp);
	});

	it('no time → no action row (children-only mounts keep the lean contract)', () => {
		const { target, comp } = mountBubble({ text: 'Hi' });
		expect(target.querySelector('[data-testid="prompt-action-row"]')).toBeNull();
		unmount(comp);
	});

	it('Raw markdown toggle flips rendered body ⇄ raw source pre', async () => {
		const { target, comp } = mountBubble({ text: 'Cost is **~1–3%**.', time: Date.now() });
		expect(target.querySelector('[data-testid="message-raw"]')).toBeNull();
		expect(target.querySelector('[data-testid="message-bubble"] strong')).not.toBeNull();

		const toggle = target.querySelector('[data-testid="raw-toggle-button"]') as HTMLButtonElement;
		toggle.click();
		flushSync();

		const raw = target.querySelector('[data-testid="message-raw"]') as HTMLElement;
		expect(raw).not.toBeNull();
		expect(raw.textContent).toBe('Cost is **~1–3%**.');
		expect(target.querySelector('[data-testid="message-bubble"] strong')).toBeNull();

		toggle.click();
		flushSync();
		expect(target.querySelector('[data-testid="message-raw"]')).toBeNull();
		expect(target.querySelector('[data-testid="message-bubble"] strong')).not.toBeNull();
		unmount(comp);
	});

	it('Copy text button writes the raw source to the clipboard', async () => {
		const writes: string[] = [];
		const holder = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
		const original = holder.clipboard?.writeText;
		if (holder.clipboard) holder.clipboard.writeText = (t) => { writes.push(t); return Promise.resolve(); };

		const { target, comp } = mountBubble({ text: 'plain words', time: Date.now() });
		(target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));

		if (holder.clipboard) {
			expect(writes).toEqual(['plain words']);
			if (original) holder.clipboard.writeText = original;
		}
		unmount(comp);
	});
});

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function mountInput(props: Partial<{ isStreaming: boolean; sending: boolean }> = {}) {
	const submitted: string[] = [];
	const cancelled: number[] = [];
	let releaseReceipt: ((admitted: boolean) => void) | undefined;
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(Composer, {
		target,
		props: {
			onsubmit: (text: string) =>
				new Promise<boolean>((resolve) => {
					submitted.push(text);
					releaseReceipt = resolve;
				}),
			oncancel: () => {
				cancelled.push(1);
				return Promise.resolve();
			},
			isStreaming: props.isStreaming ?? false,
			sending: props.sending ?? false
		}
	});
	return { target, submitted, cancelled, comp, release: () => releaseReceipt?.(true) };
}

function textarea(t: HTMLElement): HTMLTextAreaElement {
	return t.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
}

describe('Composer', () => {
	it('Enter submits, Shift+Enter inserts a newline', async () => {
		const h = mountInput();
		const ta = textarea(h.target);
		ta.value = 'Hello';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
		await settle();
		expect(h.submitted).toEqual([]); // Shift+Enter must not submit

		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(h.submitted).toEqual(['Hello']);
		expect(ta.value).toBe(''); // cleared on submit
		unmount(h.comp);
	});

	it('empty / whitespace text never submits', async () => {
		const h = mountInput();
		const ta = textarea(h.target);
		ta.value = '   ';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(h.submitted).toEqual([]);
		const send = h.target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		unmount(h.comp);
	});

	it('rapid double-submit blocked: input locked until the receipt lands (BC-3)', async () => {
		const h = mountInput();
		const ta = textarea(h.target);
		ta.value = 'First';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(h.submitted).toEqual(['First']);
		expect(ta.disabled).toBe(true); // locked while awaiting the receipt

		// Second attempt while the receipt is still pending — must not fire.
		const send = h.target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		send.click();
		await settle();
		expect(h.submitted).toEqual(['First']);

		h.release(); // receipt lands
		await settle();
		expect(ta.disabled).toBe(false); // unlocked
		unmount(h.comp);
	});

	it('Send flips to a red Cancel button while streaming; cancel fires oncancel', async () => {
		const h = mountInput({ isStreaming: true });
		const cancel = h.target.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
		expect(cancel).not.toBeNull();
		expect(h.target.querySelector('[data-testid="send-button"]')).toBeNull();
		// OCI cancel-btn parity: red square + filled Square icon + stop title.
		expect(cancel.className).toContain('bg-status-fail');
		expect(cancel.querySelector('svg')).not.toBeNull();
		expect(cancel.getAttribute('title')).toBe('Stop streaming');
		cancel.click();
		await settle();
		expect(h.cancelled).toHaveLength(1);
		unmount(h.comp);
	});

	it('sending state disables the textarea and locks the send button (OCI icon parity)', async () => {
		const h = mountInput({ sending: true });
		expect(textarea(h.target).disabled).toBe(true);
		const send = h.target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
		// Icon button (OCI send-btn): ArrowUp svg renders, no text label,
		// locked while the receipt is pending (the "Sending…" cue lives in
		// the textarea's streaming-dots overlay, not button text).
		expect(send.querySelector('svg')).not.toBeNull();
		expect(send.textContent?.trim()).toBe('');
		expect(send.disabled).toBe(true);
		unmount(h.comp);
	});

	// ── Auto-grow (OCI pattern port, 2026-08-23): fits content, 15-row clamp ──

	it('auto-grow: height follows content up to the 15-row clamp, then overflows', async () => {
		const h = mountInput();
		const ta = textarea(h.target);
		flushSync();

		// happy-dom: scrollHeight returns 0 (no layout) — the effect then sets
		// height to the clamped 0 and toggles overflow off. Simulate real
		// layout by stubbing scrollHeight per call: one line, many lines.
		let stubScrollHeight = 46; // one line + padding
		Object.defineProperty(ta, 'scrollHeight', { get: () => stubScrollHeight, configurable: true });

		ta.value = 'one line';
		ta.dispatchEvent(new Event('input'));
		flushSync();
		let observed = ta.style.height;
		expect(observed).toBe('46px');
		expect(ta.className).toContain('overflow-y-hidden');

		// 30 lines of content: clamped to 15 rows (15 × 22.75 + 16 padding = 357.25 → 357px)
		stubScrollHeight = 700;
		ta.value = 'x'.repeat(30 * 10) + '\n' + 'line\n'.repeat(29);
		ta.dispatchEvent(new Event('input'));
		flushSync();
		observed = ta.style.height;
		expect(observed).toBe('357px');
		expect(ta.className).toContain('overflow-y-auto');

		// Shrink back: deleting text returns to content height
		stubScrollHeight = 70;
		ta.value = 'two\nlines';
		ta.dispatchEvent(new Event('input'));
		flushSync();
		expect(ta.style.height).toBe('70px');
		expect(ta.className).toContain('overflow-y-hidden');
		unmount(h.comp);
	});
});

describe('StreamingIndicator', () => {
	it('renders three dots with the streaming status', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(StreamingIndicator, { target });
		const el = target.querySelector('[data-testid="streaming-indicator"]');
		expect(el?.getAttribute('role')).toBe('status');
		expect(el?.getAttribute('aria-label')).toBe('streaming');
		expect(el?.children).toHaveLength(3);
		unmount(comp);
	});
});

describe('AssistantTurn — OCI two-group shell (2026-08-21)', () => {
	it('corners: rounded-2xl + square bottom-left (rounded-bl-sm), elevated surface, left-aligned', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		const turn = target.querySelector('[data-testid="assistant-turn"]') as HTMLElement;
		expect(turn.className).toContain('rounded-2xl');
		expect(turn.className).toContain('rounded-bl-sm');
		expect(turn.className).not.toContain('rounded-br-sm');
		expect(turn.className).toContain('bg-surface-elevated');
		expect(turn.className).toContain('border-surface-border');
		const wrapper = target.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain('items-start');
		unmount(comp);
	});

	it('renders children inside the turn bubble; timestamp rides inside at the bottom-left edge (data-role assistant)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: 1755800000000, text: 'turn text', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		expect(target.querySelector('[data-testid="assistant-turn"]')).not.toBeNull();
		const stamp = target.querySelector('[data-testid="message-time"][data-role="assistant"]') as HTMLElement;
		expect(stamp).not.toBeNull();
		unmount(comp);
	});

	it('stamp prefix: with start, the turn wall time rides as the Ran-for prefix (DSH parity)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: 1755800128000, start: 1755800000000, text: 'turn text', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		const stamp = target.querySelector('[data-testid="message-time"][data-role="assistant"]') as HTMLElement;
		expect(stamp.textContent).toContain('Ran for 2m 08s');
		unmount(comp);
	});

	it('stamp prefix: without start the stamp stays the bare relative time', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: 1755800000000, text: 'turn text', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		const stamp = target.querySelector('[data-testid="message-time"][data-role="assistant"]') as HTMLElement;
		expect(stamp.textContent).not.toContain('Ran for');
		unmount(comp);
	});

	// --- Turn usage pill + popup (DSH TurnUsagePanel parity, 2026-09-09) ---

	const TURN_USAGE = {
		inputTokens: 5_060,
		outputTokens: 214,
		totalTokens: 5_479,
		cacheReadTokens: 5_000,
		cacheWriteTokens: 205,
		reasoningTokens: 96,
		routes: [{ provider: 'deepseek', model: 'deepseek-chat' }]
	};

	it('usage pill: mounts bottom-left with the exact total; popup opens with DSH rows', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), usage: TURN_USAGE, text: 'turn text', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		const pill = target.querySelector('[data-testid="turn-usage"] button') as HTMLElement;
		expect(pill).not.toBeNull();
		expect(pill.textContent).toBe('Usage 5,479 tok'); // ADR-0012 D1: the provider's exact total, not the 10,479 bucket double-count
		expect(target.querySelector('[data-testid="turn-usage-popup"]')).toBeNull();
		pill.click();
		flushSync();
		const popup = target.querySelector('[data-testid="turn-usage-popup"]') as HTMLElement;
		expect(popup).not.toBeNull();
		expect(popup.textContent).toContain('Provider / model');
		expect(popup.textContent).toContain('deepseek/deepseek-chat');
		expect(popup.textContent).toContain('Cache hit');
		expect(popup.textContent).toContain('Uncached input');
		expect(popup.textContent).toContain('Cached input');
		expect(popup.textContent).toContain('Output');
		unmount(comp);
	});

	it('usage pill: hidden without usage (turns whose steps settled unattributed)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), text: 'turn text', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		expect(target.querySelector('[data-testid="turn-usage"]')).toBeNull();
		unmount(comp);
	});

	// --- Action row + raw flip (PromptBubble parity, 2026-08-22; save
	// --- prompt is prompt-side only, 2026-08-30) ---

	it('action row: copy · canvas · raw render at bottom-center when text+time present — save prompt hidden', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), text: 'answer **here**', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		const row = target.querySelector('[data-testid="prompt-action-row"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.className).toContain('absolute bottom-0.15 left-1/2 -translate-x-1/2');
		expect(row.querySelector('[data-testid="copy-text-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="save-prompt-button"]')).toBeNull();
		unmount(comp);
	});

	it('tool-only turn (no text) → no action row and no stamp (lean contract)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), children: createRawSnippet(() => ({ render: () => '<p>chips only</p>' })) } });
		expect(target.querySelector('[data-testid="prompt-action-row"]')).toBeNull();
		expect(target.querySelector('[data-testid="message-time"]')).toBeNull();
		unmount(comp);
	});

	it('raw toggle flips rendered runs ⇄ one raw pre of the turn text', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, { target, props: { time: Date.now(), text: 'first block\n\nsecond **block**', children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })) } });
		expect(target.querySelector('[data-testid="message-raw"]')).toBeNull();
		expect(target.querySelector('p')?.textContent).toBe('turn body');

		const toggle = target.querySelector('[data-testid="raw-toggle-button"]') as HTMLButtonElement;
		toggle.click();
		flushSync();

		const raw = target.querySelector('[data-testid="message-raw"]') as HTMLElement;
		expect(raw).not.toBeNull();
		expect(raw.textContent).toBe('first block\n\nsecond **block**');
		expect(target.querySelector('p')).toBeNull();

		toggle.click();
		flushSync();
		expect(target.querySelector('[data-testid="message-raw"]')).toBeNull();
		expect(target.querySelector('p')?.textContent).toBe('turn body');
		unmount(comp);
	});
});

describe('ToolCallChip — chip-only (popup split, 2026-08-22)', () => {
	function chip(props: Partial<ComponentProps<typeof ToolCallChip>>) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallChip, {
			target,
			props: { kind: 'call', toolName: 'grep', ...props } as ComponentProps<typeof ToolCallChip>
		});
		const toggle = target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement;
		const dot = target.querySelector('[data-testid="tool-chip-dot"]') as HTMLElement;
		return { target, toggle, dot, comp };
	}

	it('pending call: amber dot, plain name, no panes in the chip', () => {
		const { toggle, dot, comp, target } = chip({ kind: 'call', toolName: 'grep', status: 'pending' });
		expect(dot.className).toContain('bg-status-pending'); // pending fill (OCI statusConfig)
		expect(toggle.textContent?.trim()).toBe('grep');
		expect(target.querySelector('[data-testid="tool-chip-args"]')).toBeNull();
		unmount(comp);
	});

	it('pending → pass flip: dot turns emerald', () => {
		const { dot, comp } = chip({ kind: 'call', toolName: 'grep', status: 'pass' });
		expect(dot.className).toContain('bg-status-pass/100'); // resolved fill
		unmount(comp);
	});

	it('fail path renders red: dot red + chip border red', () => {
		const { dot, toggle, comp } = chip({ kind: 'call', toolName: 'grep', status: 'fail' });
		expect(dot.className).toContain('bg-status-fail');
		expect(toggle.className).toContain('border-danger-wash-border');
		unmount(comp);
	});

	it('result chip carries ok/error styling; unknown events render as event chips', () => {
		const err = chip({ kind: 'result', toolName: 'grep', ok: false });
		expect(err.toggle.className).toContain('border-danger-wash-border');
		unmount(err.comp);
		const okc = chip({ kind: 'result', toolName: 'grep', ok: true });
		expect(okc.toggle.className).toContain('border-status-pass/30');
		unmount(okc.comp);
		const unk = chip({ kind: 'unknown', toolName: 'plugin/frobnicated' });
		expect(unk.toggle.textContent?.trim()).toBe('event · plugin/frobnicated');
		unmount(unk.comp);
	});

	it('chevron icon present; ontoggle fires; expanded state is page-owned', async () => {
		let toggled = 0;
		const { toggle, comp } = chip({ kind: 'call', toolName: 'bash', status: 'pass', open: true, ontoggle: () => (toggled += 1) });
		expect(toggle.querySelector('svg')).not.toBeNull();
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.className).toContain('accent-purple');
		(toggle as HTMLButtonElement).click();
		expect(toggled).toBe(1);
		unmount(comp);
	});
});

describe('ToolCallDetail — popup content (2026-08-22)', () => {
	it('args pane renders raw JSON as code', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallDetail, { target, props: { argsRaw: '{"path":"/tmp"}' } });
		expect(target.querySelector('[data-testid="tool-chip-args"]')?.textContent).toContain('"/tmp"');
		unmount(comp);
	});

	it('result pane truncates long payloads and expands to the full wire text', async () => {
		const full = 'x'.repeat(600);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallDetail, { target, props: { resultText: full } });
		const pane = target.querySelector('[data-testid="tool-chip-result"]') as HTMLElement;
		expect(pane.textContent?.length).toBe(480);
		(target.querySelector('[data-testid="tool-chip-result-toggle"]') as HTMLButtonElement).click();
		await settle();
		expect((target.querySelector('[data-testid="tool-chip-result"]') as HTMLElement).textContent?.length).toBe(600);
		unmount(comp);
	});

	it('BC-12: payload markup renders as inert text, never as elements', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallDetail, { target, props: { argsRaw: '<script>x</script>' } });
		expect(target.querySelector('script')).toBeNull();
		expect(target.querySelector('[data-testid="tool-chip-args"]')?.textContent).toContain('<script>');
		unmount(comp);
	});

	it('legacy summary pane survives only when there is no raw args', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallDetail, { target, props: { summary: 'did a thing' } });
		expect(target.querySelector('[data-testid="tool-chip-detail"]')?.textContent).toContain('did a thing');
		unmount(comp);
	});
});

describe('ReasoningSection — chip-only (popup split, 2026-08-22)', () => {
	it('renders the think chip: label think always, the running glyph only while streaming; no body inside', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ReasoningSection, { target, props: { reasoning: 'because', streaming: true } });
		const toggle = target.querySelector('[data-testid="reasoning-toggle"]') as HTMLElement;
		expect(toggle.textContent?.trim()).toBe('think');
		expect(toggle.querySelector('svg')).not.toBeNull();
		// streaming state rides the shared SessionStatus glyph (animated
		// run bars), not the label text — the label never changes
		const glyph = toggle.querySelector('[data-testid="session-status"]') as HTMLElement;
		expect(glyph).not.toBeNull();
		expect(glyph.className).toContain('run');
		// the red is app-wide (app.css owns --si-run on :root) — the chip
		// carries no local override
		expect(toggle.getAttribute('style')).toBeNull();
		expect(target.querySelector('[data-testid="reasoning-body"]')).toBeNull(); // popup is page-owned
		unmount(comp);
		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const c2 = mount(ReasoningSection, { target: t2, props: { reasoning: 'because' } });
		const doneToggle = t2.querySelector('[data-testid="reasoning-toggle"]') as HTMLElement;
		expect(doneToggle.textContent?.trim()).toBe('think');
		expect(doneToggle.querySelector('[data-testid="session-status"]')).toBeNull(); // done = no glyph
		unmount(c2);
	});

	it('ontoggle fires (page-owned open state)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		let toggled = 0;
		const comp = mount(ReasoningSection, {
			target,
			props: { reasoning: 'r', open: false, ontoggle: () => (toggled += 1) }
		});
		(target.querySelector('[data-testid="reasoning-toggle"]') as HTMLButtonElement).click();
		expect(toggled).toBe(1);
		unmount(comp);
	});

	it('empty reasoning renders nothing', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ReasoningSection, { target, props: { reasoning: '' } });
		expect(target.querySelector('[data-testid="reasoning-section"]')).toBeNull();
		unmount(comp);
	});
});

describe('ApprovalCard — answerer UI (task 2.1-T)', () => {
	it('waiting: states tool + reason VERBATIM (BC-D), both buttons live, nothing pre-selected', () => {
		const { target, answered } = mountApproval({
			toolName: 'bash <b>rm</b> -rf',
			reason: 'needs your approval because it writes to /etc/hosts'
		});
		const card = target.querySelector('[data-testid="approval-card"]') as HTMLElement;
		expect(card.getAttribute('data-phase')).toBe('waiting');
		expect(target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('bash <b>rm</b> -rf');
		expect(target.querySelector('[data-testid="approval-reason"]')?.textContent).toBe(
			'needs your approval because it writes to /etc/hosts'
		);
		// Nothing pre-selected: no button carries aria-pressed/checked/data-selected —
		// both wait for a human click, always.
		const pressed = target.querySelectorAll('[aria-pressed], [aria-checked], [data-selected]');
		expect(pressed).toHaveLength(0);
		// No "always allow" surface anywhere (the wire has no such grant).
		expect(target.textContent).not.toContain('always');
		expect(answered).toEqual([]);
	});

	it('both outcomes fire exactly their outcome; in-flight locks buttons (double-submit guard)', async () => {
		const a = mountApproval();
		(a.target.querySelector('[data-testid="approval-allow"]') as HTMLButtonElement).click();
		await settle();
		expect(a.answered).toEqual(['allowed-once']);
		unmount(a.comp);

		const b = mountApproval();
		(b.target.querySelector('[data-testid="approval-reject"]') as HTMLButtonElement).click();
		await settle();
		expect(b.answered).toEqual(['rejected']);
		unmount(b.comp);

		// in-flight: both disabled, clicks are inert
		const c = mountApproval({ phase: 'in-flight' });
		const allow = c.target.querySelector('[data-testid="approval-allow"]') as HTMLButtonElement;
		const reject = c.target.querySelector('[data-testid="approval-reject"]') as HTMLButtonElement;
		expect(allow.disabled).toBe(true);
		expect(reject.disabled).toBe(true);
		allow.click();
		reject.click();
		await settle();
		expect(c.answered).toEqual([]);
		expect(c.target.querySelector('[data-testid="approval-inflight"]')?.textContent).toContain('answering');
		unmount(c.comp);
	});

	it('settled names the winning outcome for both directions', () => {
		const allow = mountApproval({ phase: 'settled', outcome: 'allowed-once' });
		expect(allow.target.querySelector('[data-testid="approval-settled"]')?.textContent).toContain('allowed once');
		unmount(allow.comp);

		const reject = mountApproval({ phase: 'settled', outcome: 'rejected' });
		expect(reject.target.querySelector('[data-testid="approval-settled"]')?.textContent).toContain('rejected');
		unmount(reject.comp);
	});

	it('answered-elsewhere settles gracefully (BC-B: not-pending is a state, never an error)', () => {
		const { target, comp } = mountApproval({ phase: 'answered-elsewhere' });
		const card = target.querySelector('[data-testid="approval-card"]') as HTMLElement;
		expect(card.getAttribute('data-phase')).toBe('answered-elsewhere');
		expect(target.querySelector('[data-testid="approval-elsewhere"]')?.textContent).toContain('Answered elsewhere');
		expect(target.querySelector('[data-testid="approval-allow"]')).toBeNull(); // no re-ask
		unmount(comp);
	});

	it('withdrawn (cancelled) shows the withdrawal line and never re-asks', () => {
		const { target, comp } = mountApproval({ phase: 'withdrawn' });
		expect(target.querySelector('[data-testid="approval-withdrawn"]')?.textContent).toContain('cancelled');
		expect(target.querySelector('[data-testid="approval-allow"]')).toBeNull();
		unmount(comp);
	});

	it('XSS inertness: wire text renders as characters, never nodes or handlers', () => {
		const { target, comp } = mountApproval({
			toolName: 'Write <script>window.__ap=1</script>',
			reason: '<img src=x onerror="window.__ap=2"> writes hosts'
		});
		expect(target.querySelector('script')).toBeNull();
		expect(target.querySelector('img')).toBeNull();
		expect((window as { __ap?: number }).__ap).toBeUndefined();
		expect(target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('<script>');
		unmount(comp);
	});
});

describe('QuestionCard — answerer UI (task 2.2-T)', () => {
	const questions = [
		{
			id: 'q1',
			question: 'Which database?',
			detail: 'The migration target for tonight',
			options: [
				{ label: 'prod', description: 'live data' },
				{ label: 'staging', description: 'safe copy' }
			]
		},
		{
			id: 'q2',
			question: 'Which regions?',
			options: [{ label: 'eu' }, { label: 'us' }, { label: 'apac' }],
			multiSelect: true
		}
	];

	function mountQuestion(props: Partial<ComponentProps<typeof QuestionCard>> = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const answers: Array<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }> = [];
		const comp = mount(QuestionCard, {
		target,
		props: {
			rpcId: 'rpc-q1',
			questions: questions.map((q) => ({ ...q })),
			phase: 'waiting',
			onanswer: (
				a: { answers: Array<{ id: string; selected: string[]; custom?: string }> }
			) => answers.push(a),
			...props
		}
	});
		return { target, answers, comp };
	}

	function clickOption(target: HTMLElement, label: string): void {
		const opt = target.querySelector(`[data-testid="question-option"][data-label="${label}"]`) as HTMLButtonElement;
		opt.click();
	}

	function setCustom(target: HTMLElement, id: string, value: string): void {
		const input = target.querySelector(`[data-testid="question-custom"][data-question-id="${id}"]`) as HTMLInputElement;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	it('single-select: click → submit fires the batch answer with echoed id + selected labels', async () => {
		const { target, answers, comp } = mountQuestion();
		clickOption(target, 'prod');
		clickOption(target, 'us');
		await settle();
		(target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(answers).toHaveLength(1);
		expect(answers[0]).toEqual({
			answers: [
				{ id: 'q1', selected: ['prod'] }, // single-select: us replaced nothing — q2 untouched
			{ id: 'q2', selected: ['us'] }
			]
		});
		unmount(comp);
	});

	it('multi-select accumulates in click order; single-select replaces (last one wins)', async () => {
		const { target, answers, comp } = mountQuestion();
		clickOption(target, 'eu');
		clickOption(target, 'apac'); // multiSelect accumulates
		clickOption(target, 'prod');
		clickOption(target, 'staging'); // single-select replaces
		await settle();
		(target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(answers[0]?.answers).toEqual([
			{ id: 'q1', selected: ['staging'] },
			{ id: 'q2', selected: ['eu', 'apac'] }
		]);
		unmount(comp);
	});

	it('custom text rides as `custom` (trimmed); blank-only custom never submits', async () => {
		const { target, answers, comp } = mountQuestion();
		clickOption(target, 'prod');
		setCustom(target, 'q2', '  latam  ');
		await settle();
		(target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement).click();
		await settle();
		expect(answers[0]?.answers[1]).toEqual({ id: 'q2', selected: [], custom: 'latam' });
		unmount(comp);
	});

	it('invalid selections are blocked PRE-SEND with honest errors (host rules mirrored)', async () => {
		// single-select + custom → host rule: custom and selected cannot mix
		const { target, answers, comp } = mountQuestion();
		clickOption(target, 'prod');
		setCustom(target, 'q1', 'my own db');
		await settle();
		expect(target.querySelector('[data-testid="question-invalid"]')?.textContent).toContain('either an option or your own');
		const submit = target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		submit.click(); // disabled — but even a forced click must not fire
		await settle();
		expect(answers).toEqual([]);
		unmount(comp);

		// blank question → submit disabled (honest incomplete, not invalid)
		const blank = mountQuestion();
		expect((blank.target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement).disabled).toBe(true);
		expect(blank.target.querySelector('[data-testid="question-invalid"]')).toBeNull();
		expect(blank.target.querySelector('[data-testid="question-submit-hint"]')?.textContent).toContain('every question needs an answer');
		unmount(blank.comp);
	});

	it('answered-elsewhere settles gracefully; withdrawn never re-asks; XSS inert', () => {
		const elsewhere = mountQuestion({ phase: 'answered-elsewhere' });
		expect(elsewhere.target.querySelector('[data-testid="question-elsewhere"]')?.textContent).toContain('Answered elsewhere');
		expect(elsewhere.target.querySelector('[data-testid="question-submit"]')).toBeNull();
		unmount(elsewhere.comp);

		const withdrawn = mountQuestion({ phase: 'withdrawn' });
		expect(withdrawn.target.querySelector('[data-testid="question-withdrawn"]')?.textContent).toContain('cancelled');
		expect(withdrawn.target.querySelector('[data-testid="question-submit"]')).toBeNull();
		unmount(withdrawn.comp);

		const xss = mountQuestion({
			questions: [{ id: 'x', question: '<script>window.__qc=1</script>', options: [{ label: '<img src=x onerror="window.__qc=2">', description: 'd' }] }]
		});
		expect(xss.target.querySelector('script')).toBeNull();
		expect(xss.target.querySelector('img')).toBeNull();
		expect((window as { __qc?: number }).__qc).toBeUndefined();
		expect(xss.target.querySelector('[data-testid="question-text"]')?.textContent).toContain('<script>');
		unmount(xss.comp);
	});

	// --- Plan review shape (2026-08-31, task 1.2-T): planReviewOf claims the
	// request and the card renders the review; any refusal keeps the generic
	// flow above byte for byte. ---

	/** The canonical exit_plan_mode-shaped request: one question, plan
	 *  markdown in detail, the asker's own Approve / Keep planning options,
	 *  the plan-review intent tag. */
	const planQuestion = {
		id: 'plan-review',
		question: 'Approve this plan and leave plan mode?',
		header: 'Plan review',
		detail: '# The Plan\n\n1. Read the wire\n2. Render the review',
		options: [
			{ label: 'Approve', description: 'leave plan mode' },
			{ label: 'Keep planning', description: 'stay in plan mode' }
		],
		intent: { kind: 'plan-review', approve: 'Approve' }
	};

	it('claimed waiting review: plan body renders; buttons carry the asker’s own labels; no generic affordances', () => {
		const { target, comp } = mountQuestion({ questions: [planQuestion] });
		const body = target.querySelector('[data-testid="plan-review-body"]');
		expect(body).not.toBeNull();
		expect(body?.textContent).toContain('Read the wire');
		expect(body?.textContent).toContain('Approve this plan and leave plan mode?');
		const approve = target.querySelector('[data-testid="plan-review-approve"]') as HTMLButtonElement;
		const decline = target.querySelector('[data-testid="plan-review-decline"]') as HTMLButtonElement;
		expect(approve.textContent?.trim()).toBe('Approve');
		expect(decline.textContent?.trim()).toBe('Keep planning');
		expect(approve.title).toBe('leave plan mode');
		expect(decline.title).toBe('stay in plan mode');
		expect(target.querySelector('[data-testid="question-custom"]')).toBeNull();
		expect(target.querySelector('[data-testid="question-option"]')).toBeNull();
		unmount(comp);
	});

	it('review decisions submit the SAME batch envelope — one question, one label, no custom key', async () => {
		const { target, answers, comp } = mountQuestion({ questions: [planQuestion] });
		(target.querySelector('[data-testid="plan-review-approve"]') as HTMLButtonElement).click();
		await settle();
		expect(answers).toEqual([{ answers: [{ id: 'plan-review', selected: ['Approve'] }] }]);
		unmount(comp);

		const declined = mountQuestion({ questions: [planQuestion] });
		(declined.target.querySelector('[data-testid="plan-review-decline"]') as HTMLButtonElement).click();
		await settle();
		expect(declined.answers).toEqual([{ answers: [{ id: 'plan-review', selected: ['Keep planning'] }] }]);
		unmount(declined.comp);
	});

	it('phase contract kept: review buttons render disabled once in-flight', () => {
		const { target, comp } = mountQuestion({ questions: [planQuestion], phase: 'in-flight' });
		expect((target.querySelector('[data-testid="plan-review-approve"]') as HTMLButtonElement).disabled).toBe(true);
		expect((target.querySelector('[data-testid="plan-review-decline"]') as HTMLButtonElement).disabled).toBe(true);
		unmount(comp);
	});

	it('refusal arms render the generic card — custom input + tick boxes present, no review body', () => {
		const refusals: Array<{ name: string; questions: unknown[] }> = [
			{
				// arm 1: a batch two buttons cannot answer as one decision
				name: 'two-question batch',
				questions: [planQuestion, { id: 'q2', question: 'Second?', options: [{ label: 'A' }] }]
			},
			{
				// arm 3: no detail — nothing to read as a plan
				name: 'missing detail',
				questions: [{ ...planQuestion, detail: undefined }]
			},
			{
				// arm 5: three options — a third answer two buttons cannot express
				name: 'three options',
				questions: [
					{ ...planQuestion, options: [{ label: 'Approve' }, { label: 'Keep planning' }, { label: 'Ask again' }] }
				]
			}
		];
		for (const { name, questions } of refusals) {
			const { target, comp } = mountQuestion({ questions: questions as ComponentProps<typeof QuestionCard>['questions'] });
			expect(target.querySelector('[data-testid="plan-review-body"]'), name).toBeNull();
			expect(target.querySelector('[data-testid="plan-review-approve"]'), name).toBeNull();
			expect(target.querySelector('[data-testid="question-custom"]'), name).not.toBeNull();
			expect(target.querySelector('[data-testid="question-option"]'), name).not.toBeNull();
			unmount(comp);
		}
	});

	it('settled claimed review: plan body read-only, no buttons, decision line shown', () => {
		const { target, comp } = mountQuestion({
			questions: [planQuestion],
			phase: 'settled',
			outcome: 'answered',
			answers: [{ id: 'plan-review', selected: ['Approve'] }]
		});
		expect(target.querySelector('[data-testid="plan-review-body"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="plan-review-approve"]')).toBeNull();
		expect(target.querySelector('[data-testid="plan-review-decline"]')).toBeNull();
		expect(target.querySelector('[data-testid="question-settled"]')?.textContent).toContain('Answered');
		unmount(comp);
	});
});

describe('RuntimeContextChip — collapsed harness context (task 2.4-T)', () => {
	it('renders one collapsed line with a snippet; expand shows the verbatim text', async () => {
		const full = 'Current runtime context. This snapshot supersedes earlier runtime-context. ' + 'detail '.repeat(30);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(RuntimeContextChip, { target, props: { text: full } });
		const chip = target.querySelector('[data-testid="runtime-context-chip"]') as HTMLElement;
		expect(chip.getAttribute('data-open')).toBe('false');
		const label = target.querySelector('[data-testid="runtime-context-toggle"]') as HTMLElement;
		expect(label.textContent).toContain('⚙ runtime context');
		expect(label.textContent).toContain('Current runtime context.');
		expect(label.textContent).toContain('…'); // truncated snippet in collapsed line
		expect(target.querySelector('[data-testid="runtime-context-body"]')).toBeNull();
		(label as HTMLButtonElement).click();
		await settle();
		const body = target.querySelector('[data-testid="runtime-context-body"]') as HTMLElement;
		expect(body.tagName).toBe('PRE'); // verbatim, monospace — data not prose
		expect(body.textContent).toBe(full); // expand = full wire text, exact
		unmount(comp);
	});

	it('BC-12: raw HTML in the context payload never becomes a node', async () => {
		const payload = 'Current runtime context. <img src=x onerror="window.__rc=1">';
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(RuntimeContextChip, { target, props: { text: payload } });
		(target.querySelector('[data-testid="runtime-context-toggle"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('img')).toBeNull();
		expect((window as { __rc?: number }).__rc).toBeUndefined();
		expect(target.querySelector('[data-testid="runtime-context-body"]')?.textContent).toContain('<img src=x');
		unmount(comp);
	});
});

describe('ContextInjection — chip-only (popup split, 2026-08-22)', () => {
	it('title is the producer name only; chip carries NO body (popup is page-owned)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ContextInjection, { target, props: { producer: 'runtime-context', text: 'full payload' } });
		const chip = target.querySelector('[data-testid="context-injection-chip"]') as HTMLElement;
		expect(chip.getAttribute('data-producer')).toBe('runtime-context');
		expect(chip.getAttribute('data-open')).toBe('false');
		expect((target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement).textContent?.trim()).toBe('context');
		expect(target.querySelector('[data-testid="context-injection-body"]')).toBeNull();
		unmount(comp);
	});

	it('all eight producers carry their simple title; toggle emits ontoggle', () => {
		for (const [producer, title] of [
			['runtime-context', 'context'],
			['instructions', 'instructions'],
			['skill-catalog', 'skills'],
			['skill-invocation', 'skill'],
			['goal', 'goal'],
			['tool-goal', 'tool goal'],
			['time-context', 'time context'],
			['compaction', 'compact'],
			['plugin', 'plugin'],
			['recall', 'recall'],
			['injected', 'injected']
		] as const) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			let toggled = 0;
			const comp = mount(ContextInjection, {
				target,
				props: { producer, text: 'payload', open: true, ontoggle: () => (toggled += 1) }
			});
			const toggle = target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement;
			expect(toggle.textContent?.trim(), `title for ${producer}`).toBe(title);
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
			(toggle as HTMLButtonElement).click();
			expect(toggled).toBe(1);
			unmount(comp);
		}
	});

	it('skill-invocation names its chip after the invoked skill (bare category without a name)', () => {
		for (const [name, title] of [
			['dsh-doc', 'skill:dsh-doc'],
			[undefined, 'skill']
		] as const) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const comp = mount(ContextInjection, { target, props: { producer: 'skill-invocation', text: 'payload', name } });
			const toggle = target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement;
			expect(toggle.textContent?.trim(), `title for name=${name}`).toBe(title);
			expect(toggle.getAttribute('aria-label')).toBe(title);
			unmount(comp);
		}
	});

	it('open-family names: plugin/injected titles ARE the wire name; recall pairs category:name', () => {
		for (const [producer, name, title] of [
			['plugin', 'tool-jobs', 'tool-jobs'],
			['plugin', undefined, 'plugin'],
			['injected', 'webhook', 'webhook'],
			['injected', undefined, 'injected'],
			['recall', 'Fix the mux drop', 'recall:Fix the mux drop'],
			['recall', undefined, 'recall']
		] as const) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const comp = mount(ContextInjection, { target, props: { producer, text: 'payload', name } });
			const toggle = target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement;
			expect(toggle.textContent?.trim(), `title for ${producer} name=${name}`).toBe(title);
			expect(toggle.getAttribute('aria-label')).toBe(title);
			unmount(comp);
		}
	});

	it('promoted producers (2026-11-02): bare catalog label on the chip, wire name on tooltip + aria (ADR D3)', () => {
		for (const [producer, name, label] of [
			['goal', 'goal', 'goal'],
			['tool-goal', 'tool-goal', 'tool goal'],
			['time-context', 'time-context', 'time context'],
			['goal', undefined, 'goal'] // no readable wire name → no tooltip suffix
		] as const) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const comp = mount(ContextInjection, { target, props: { producer, text: 'payload', name } });
			const toggle = target.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement;
			expect(toggle.textContent?.trim(), `label for ${producer} name=${name}`).toBe(label);
			if (name === undefined) {
				expect(toggle.getAttribute('title')).toBe(null);
				expect(toggle.getAttribute('aria-label')).toBe(label);
			} else {
				expect(toggle.getAttribute('title')).toBe(name);
				expect(toggle.getAttribute('aria-label')).toBe(`${label} (${name})`);
			}
			unmount(comp);
		}
	});

	it('BC-12: raw HTML in any producer payload stays characters (no nodes, no handlers)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ContextInjection, { target, props: { producer: 'instructions', text: '<img src=x onerror="window.__ci=1"> body' } });
		expect(target.querySelector('img')).toBeNull();
		expect((window as { __ci?: number }).__ci).toBeUndefined();
		unmount(comp);
	});

	it('onopen renders a second open button; absent onopen renders none (subagent family only)', () => {
		const targetA = document.createElement('div');
		document.body.appendChild(targetA);
		let opened = 0;
		const compA = mount(ContextInjection, {
			target: targetA,
			props: { producer: 'injected', text: 'notice', name: 'subagent-settled', onopen: () => (opened += 1) }
		});
		const btn = targetA.querySelector('[data-testid="context-injection-open"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		btn.click();
		expect(opened).toBe(1);
		unmount(compA);

		const targetB = document.createElement('div');
		document.body.appendChild(targetB);
		const compB = mount(ContextInjection, { target: targetB, props: { producer: 'injected', text: 'notice', name: 'subagent-settled' } });
		expect(targetB.querySelector('[data-testid="context-injection-open"]')).toBeNull();
		unmount(compB);
	});
});

describe('tool-titles + one chip per call (task 2.5-T, BC-F)', () => {
	it('chip name is the plain wire name; empty falls back to tool', async () => {
		for (const [name, title] of [
			['bash', 'bash'],
			['pwsh', 'pwsh'],
			['grep', 'grep'],
			['', 'tool']
		] as Array<[string, string]>) {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const comp = mount(ToolCallChip, { target, props: { kind: 'call', toolName: name, status: 'pass' } });
			const toggle = target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement;
			expect(toggle.textContent, `title for '${name}'`).toContain(title);
			unmount(comp);
		}
	});

	it('paired result rides the popup: ToolCallDetail carries args + result', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ToolCallDetail, { target, props: { argsRaw: '{"cmd":"echo hi"}', resultText: 'hi' } });
		expect(target.querySelector('[data-testid="tool-chip-result"]')?.textContent).toBe('hi');
		expect(target.querySelector('[data-testid="tool-chip-args"]')?.textContent).toContain('echo hi');
		unmount(comp);
	});
});

// ── POC-3 W3 (task 3.2-T): ModelSelector dropdown ──────────────────────────

describe('ModelSelector — header dropdown (W3, task 3.2)', () => {
	function directoryFixture() {
		return {
			ok: true,
			current: { provider: 'deepseek', model: 'glm-5.3' },
			routable: true,
			groups: [
				{
					id: 'deepseek',
					name: 'DeepSeek',
					models: [
						{ id: 'glm-5.3', name: 'GLM 5.3' },
						{ id: 'glm-5-mini', name: 'GLM 5 Mini' }
					]
				},
				{
					id: 'ollama',
					name: null,
					models: [{ id: 'qwen3', name: null }]
				}
			],
			failures: []
		};
	}

	function mountSelector() {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ModelSelector, { target, props: { sessionId: 's-1' } });
		return { target, comp };
	}

	/** Flush effects + microtasks (component tests' settle twin). */
	async function settle2(): Promise<void> {
		for (let i = 0; i < 6; i++) {
			flushSync();
			await Promise.resolve();
		}
		flushSync();
	}

	it('closed state shows the current selection (provider / model); "model —" when none', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(directoryFixture()), { status: 200 }))
		);
		const { target, comp } = mountSelector();
		const btn = target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement;
		expect(btn.textContent).toContain('model —'); // no directory yet
		btn.click();
		await settle2();
		expect(btn.textContent).toContain('deepseek / glm-5.3'); // loaded
		unmount(comp);
		vi.unstubAllGlobals();
	});

	it('open loads GET /models once and renders grouped options with the current one marked', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				return new Response(JSON.stringify(directoryFixture()), { status: 200 });
			})
		);
		const { target, comp } = mountSelector();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle2();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('/api/dsh/session/s-1/models');
		const menu = target.querySelector('[data-testid="model-selector-menu"]');
		expect(menu).not.toBeNull();
		const options = target.querySelectorAll('[data-testid="model-option"]');
		expect(options).toHaveLength(3);
		const current = target.querySelector('[data-testid="model-option-current"]');
		expect(current).not.toBeNull();
		expect(current?.closest('[data-testid="model-option"]')?.getAttribute('data-model')).toBe('glm-5.3');
		// Group headings: named group + id-fallback group (the CSS uppercase
		// class is visual-only — textContent carries the raw id)
		expect(menu?.textContent).toContain('DeepSeek');
		expect(menu?.textContent).toContain('ollama');
		unmount(comp);
		vi.unstubAllGlobals();
	});

	it('picking a model POSTs select-model ONCE and adopts the normalized selection', async () => {
		const posts: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/models')) {
					return new Response(JSON.stringify(directoryFixture()), { status: 200 });
				}
				if (url.includes('/select-model')) {
					posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(
						JSON.stringify({ ok: true, selected: { provider: 'ollama', model: 'qwen3' } }),
						{ status: 200 }
					);
				}
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			})
		);
		const { target, comp } = mountSelector();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle2();
		const qwen = [...target.querySelectorAll('[data-testid="model-option"]')].find(
			(o) => o.getAttribute('data-model') === 'qwen3'
		) as HTMLButtonElement;
		qwen.click();
		await settle2();
		await settle2();
		expect(posts).toHaveLength(1);
		expect(posts[0]?.url).toContain('/api/dsh/session/s-1/select-model');
		expect(posts[0]?.body).toEqual({ provider: 'ollama', model: 'qwen3' });
		// Menu closed, button shows the adopted selection
		expect(target.querySelector('[data-testid="model-selector-menu"]')).toBeNull();
		expect((target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).textContent).toContain(
			'ollama / qwen3'
		);
		unmount(comp);
		vi.unstubAllGlobals();
	});

	it('clicking the already-current model posts NOTHING (no-op)', async () => {
		const posts: Array<unknown> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes('/select-model')) {
					posts.push(init?.body);
				}
				return new Response(JSON.stringify(directoryFixture()), { status: 200 });
			})
		);
		const { target, comp } = mountSelector();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle2();
		const current = target.querySelector('[data-testid="model-option-current"]')?.closest(
			'[data-testid="model-option"]'
		) as HTMLButtonElement;
		current.click();
		await settle2();
		await settle2();
		expect(posts).toHaveLength(0);
		unmount(comp);
		vi.unstubAllGlobals();
	});

	it('failed load shows the error + Retry; retry can recover', async () => {
		let fail = true;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				fail
					? new Response(JSON.stringify({ ok: false, error: { code: 'host-unreachable', message: 'ECONNREFUSED' } }), { status: 503 })
					: new Response(JSON.stringify(directoryFixture()), { status: 200 })
			)
		);
		const { target, comp } = mountSelector();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle2();
		expect(target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain('ECONNREFUSED');
		fail = false;
		(target.querySelector('[data-testid="model-selector-retry"]') as HTMLButtonElement).click();
		await settle2();
		expect(target.querySelectorAll('[data-testid="model-option"]').length).toBe(3);
		unmount(comp);
		vi.unstubAllGlobals();
	});

	it('empty catalog renders the honest empty state (no models listed)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ ok: true, current: null, routable: false, groups: [], failures: [] }), { status: 200 })
			)
		);
		const { target, comp } = mountSelector();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle2();
		expect(target.querySelector('[data-testid="model-selector-empty"]')?.textContent).toContain('No models listed');
		unmount(comp);
		vi.unstubAllGlobals();
	});
});

describe('ToolCallDetail — read-view typed file rendering (2026-08-22)', () => {
	function mountDetail(props: Record<string, unknown>) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(ToolCallDetail, { target, props });
		flushSync();
		return target;
	}

	it('a markdown readView renders prose through .md-content, not a flat pre', () => {
		const target = mountDetail({
			readView: {
				path: '/x/README.md',
				lang: 'md',
				offset: 1,
				totalLines: 2,
				lines: [
					{ number: 1, text: '# Title' },
					{ number: 2, text: '- bullet one' }
				]
			}
		});
		const viewer = target.querySelector('[data-testid="file-content-viewer"]');
		expect(viewer).not.toBeNull();
		expect(viewer?.getAttribute('data-lang')).toBe('md');
		const md = target.querySelector('.md-content');
		expect(md?.querySelector('h1')?.textContent).toBe('Title');
		expect(md?.querySelector('ul li')?.textContent).toBe('bullet one');
		expect(target.querySelector('[data-testid="tool-chip-result"]')).toBeNull();
	});

	it('a ts readView renders a highlighted code block', () => {
		const target = mountDetail({
			readView: {
				path: '/x/src/lib/types.ts',
				lang: 'ts',
				offset: 1,
				totalLines: 1,
				lines: [{ number: 1, text: 'export const x: number = 1;' }]
			}
		});
		const code = target.querySelector('[data-testid="file-viewer-code"] code.hljs');
		expect(code).not.toBeNull();
		expect(code?.innerHTML).toContain('hljs-keyword');
	});

	it('a svelte readView highlights through the xml alias (OCI alias table)', () => {
		const target = mountDetail({
			readView: {
				path: '/x/Button.svelte',
				lang: 'svelte',
				offset: 1,
				totalLines: 1,
				lines: [{ number: 1, text: '<div class="x">hi</div>' }]
			}
		});
		const code = target.querySelector('[data-testid="file-viewer-code"] code.hljs');
		expect(code).not.toBeNull();
		expect(code?.innerHTML).toContain('hljs-tag');
		expect(code?.textContent).toContain('<div');
	});

	it('a readView without lang falls to the plain pane (honest fallback)', () => {
		const target = mountDetail({
			readView: {
				path: '/x/NOTES.txt',
				offset: 1,
				totalLines: 1,
				lines: [{ number: 1, text: 'plain notes' }]
			}
		});
		expect(target.querySelector('[data-testid="file-viewer-plain"]')).not.toBeNull();
	});

	it('header shows filename + showing-N-of-M window framing', () => {
		const target = mountDetail({
			readView: {
				path: '/a/b/package.json',
				lang: 'json',
				offset: 10,
				totalLines: 48,
				lines: [
					{ number: 10, text: '{}' },
					{ number: 11, text: '{}' }
				]
			}
		});
		const header = target.querySelector('[data-testid="file-viewer-header"]');
		expect(header?.textContent).toContain('package.json');
		expect(header?.textContent).toContain('lines 10\u201311 of 48');
	});

	it('no readView: legacy args/result pre path unchanged', () => {
		const target = mountDetail({ argsRaw: '{\"command\":\"ls\"}', resultText: 'total 0' });
		expect(target.querySelector('[data-testid="tool-chip-args"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="tool-chip-result"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="file-content-viewer"]')).toBeNull();
	});
});

// ── ContextConsumption — OCI percentage parity (2026-08-24) ──────────

describe('ContextConsumption — percentage bar + honest fallback', () => {
	function mountCtx(props: { used?: number; limit?: number }) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ContextConsumption, { target, props });
		return { target, comp };
	}

	it('used + limit → OCI bar: percentage label + catalog-noted tooltip', () => {
		const { target, comp } = mountCtx({ used: 250_000, limit: 1_000_000 });
		const el = target.querySelector('[data-testid="context-consumption"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toContain('25%');
		expect(el?.getAttribute('title')).toContain('250000 / 1000000');
		expect(el?.getAttribute('title')).toContain('dsi-ctx-windows');
		const fill = el?.querySelector('[style*="width"]') as HTMLElement | null;
		expect(fill?.getAttribute('style')).toContain('width: 25%');
		unmount(comp);
	});

	it('bar keeps the fixed violet fill at any threshold', () => {
		const { target, comp } = mountCtx({ used: 900_000, limit: 1_000_000 });
		const el = target.querySelector('[data-testid="context-consumption"]');
		const fill = el?.querySelector('[style*="width"]') as HTMLElement | null;
		expect(fill?.className).toContain('bg-[var(--color-accent-deep)]');
		unmount(comp);
	});

	it('cap overflow: >100% renders a full bar, not a wider one', () => {
		const { target, comp } = mountCtx({ used: 1_200_000, limit: 1_000_000 });
		const fill = target.querySelector('[data-testid="context-consumption"] [style*="width"]') as HTMLElement | null;
		expect(fill?.getAttribute('style')).toContain('width: 100%');
		expect(target.textContent).toContain('120%');
		unmount(comp);
	});

	it('used only (unknown model) → honest ≈Nk ctx fallback, no bar', () => {
		const { target, comp } = mountCtx({ used: 12_345 });
		const el = target.querySelector('[data-testid="context-consumption"]');
		expect(el?.textContent).toContain('≈12.3k ctx');
		expect(el?.querySelector('div > div')).toBeNull();
		unmount(comp);
	});

	it('neither value → renders nothing (OCI contract)', () => {
		const { target, comp } = mountCtx({});
		expect(target.querySelector('[data-testid="context-consumption"]')).toBeNull();
		expect(target.textContent?.trim()).toBe('');
		unmount(comp);
	});
});

describe('contextWindowOf — catalog + overrides (OCI parity wiring)', () => {
	it('built-in substring match: glm-5.x resolves the operator window', () => {
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
		expect(contextWindowOf('GLM-5.2-chat')).toBe(1_000_000); // case-insensitive
	});

	it('most-specific pattern wins: glm-4.6 beats glm-4', () => {
		expect(contextWindowOf('glm-4.6')).toBe(200_000);
		expect(contextWindowOf('glm-4')).toBe(128_000);
	});

	it('unknown model → undefined (no guessed denominator)', () => {
		expect(contextWindowOf('mystery-model-x')).toBeUndefined();
		expect(contextWindowOf(null)).toBeUndefined();
		expect(contextWindowOf('')).toBeUndefined();
	});

	it('localStorage override wins over the built-in table', () => {
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, JSON.stringify({ 'glm-5.2': 200_000 }));
		expect(contextWindowOf('glm-5.2')).toBe(200_000);
		localStorage.removeItem(CTX_WINDOW_OVERRIDES_KEY);
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
	});

	it('corrupt override blob loses silently to the built-in table', () => {
		localStorage.setItem(CTX_WINDOW_OVERRIDES_KEY, '{not json');
		expect(contextWindowOf('glm-5.2')).toBe(1_000_000);
		localStorage.removeItem(CTX_WINDOW_OVERRIDES_KEY);
	});
});

describe('AssistantTurn — fork-here (The Fork-Here Button ADR, 2026-09-02)', () => {
	const body = (init?: RequestInit): unknown => JSON.parse(String(init?.body));

	function mountTurn(
		props: Partial<ComponentProps<typeof AssistantTurn>> & {
			fork?: ComponentProps<typeof AssistantTurn>['fork'];
			text?: string;
		}
	) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AssistantTurn, {
			target,
			props: {
				time: Date.now(),
				children: createRawSnippet(() => ({ render: () => '<p>turn body</p>' })),
				...props
			} as ComponentProps<typeof AssistantTurn>
		});
		return { target, comp };
	}

	const fork = { sessionId: 'src-1', atSeq: 7, title: 'Loader', agentPreset: 'app-dev' };

	afterEach(() => {
		resetPanelRegistryForTests();
		vi.unstubAllGlobals();
	});

	it('a forkable text turn arms the full row: copy · canvas · raw · fork-here', () => {
		const { target, comp } = mountTurn({ text: 'answer', fork });
		const row = target.querySelector('[data-testid="prompt-action-row"]')!;
		expect(row.querySelector('[data-testid="copy-text-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="raw-toggle-button"]')).not.toBeNull();
		const here = row.querySelector('[data-testid="fork-here-button"]') as HTMLElement;
		expect(here).not.toBeNull();
		expect(here.getAttribute('title')).toBe('Fork from this turn — branch a new session ending at this turn');
		unmount(comp);
	});

	it('a forkable TOOL-ONLY turn gains the row: canvas + fork only (copy/raw stay text-gated)', () => {
		const { target, comp } = mountTurn({ fork });
		expect(target.querySelector('[data-testid="prompt-action-row"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="fork-here-button"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="copy-text-button"]')).toBeNull();
		expect(target.querySelector('[data-testid="raw-toggle-button"]')).toBeNull();
		expect(target.querySelector('[data-testid="save-prompt-button"]')).toBeNull();
		unmount(comp);
	});

	it('click fork-here → POSTs the turn anchor; the child lands after the source', async () => {
		const fetchMock = vi.fn(
			async (_url: string | URL | Request, _init?: RequestInit) =>
				new Response(JSON.stringify({ ok: true, sessionId: 'child-1' }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		const add = vi.fn();
		registerAddPanel(add);
		const { target, comp } = mountTurn({ text: 'answer', fork });

		(target.querySelector('[data-testid="fork-here-button"]') as HTMLButtonElement).click();
		for (let i = 0; i < 8; i++) await Promise.resolve(); // click → fork POST → json → rename → place
		flushSync();

		const forkCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/fork'));
		expect(forkCall).toBeDefined();
		expect(String(forkCall![0])).toBe('/api/dsh/session/src-1/fork');
		expect(body(forkCall![1] as RequestInit)).toEqual({ atSeq: 7 });
		expect(add).toHaveBeenCalledWith({
			sessionId: 'child-1',
			agentPreset: 'app-dev',
			focus: true,
			afterSessionId: 'src-1'
		});
		expect(target.querySelector('[data-testid="fork-turn-error"]')).toBeNull();
		unmount(comp);
	});

	it('the refusal surfaces verbatim in the turn chip and self-heals after 4s', async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = vi.fn(async () =>
				new Response(
					JSON.stringify({
						ok: false,
						error: {
							code: 'session/fork-unavailable',
							message: 'session "src-1" has not completed the turn containing event 7'
						}
					}),
					{ status: 502 }
				)
			);
			vi.stubGlobal('fetch', fetchMock);
			const { target, comp } = mountTurn({ text: 'answer', fork });

			(target.querySelector('[data-testid="fork-here-button"]') as HTMLButtonElement).click();
			await vi.advanceTimersByTimeAsync(0);
			flushSync();

			const error = target.querySelector('[data-testid="fork-turn-error"]') as HTMLElement;
			expect(error).not.toBeNull();
			expect(error.textContent).toContain('has not completed the turn containing event 7');

			vi.advanceTimersByTime(4000);
			flushSync();
			expect(target.querySelector('[data-testid="fork-turn-error"]')).toBeNull();
			unmount(comp);
		} finally {
			vi.useRealTimers();
		}
	});
});
