/**
 * ConversationFooter unit tests — the send-surface wrapper's tint rule:
 * a checked footer (the session's broadcast checkmark on) wears the
 * pastel broadcast gradient, a focused-only footer wears the flat
 * oldlace focus tint, checked wins when both hold, and neither stays
 * white. `data-focused` stays a focus-only signal — the tint and the
 * attribute are different facts. (Prompt Sync amended 2026-09-04.)
 */
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationFooter from '$lib/components/conversation/footer/ConversationFooter.svelte';
import { resetPromptSyncForTests, setSyncChecked } from '$lib/services/chat/prompt-sync.svelte';

const SID = 'c1a0a2b3-4d5e-4f6a-8b7c-9d0e1f2a3b4c';

vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Promise<Response>(() => {}))
);

function mountFooter(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ConversationFooter, {
		target,
		props: {
			onsubmit: vi.fn(async () => true),
			oncancel: () => {},
			isStreaming: false,
			sending: false,
			sessionId: SID,
			contextTokens: undefined,
			...props
		}
	});
	flushSync();
	const footer = () => target.querySelector('[data-testid="conversation-footer"]') as HTMLElement;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { footer, cleanup };
}

/** The tint face, read off the element's classes. */
function tintFace(el: HTMLElement): 'gradient' | 'wash' | 'white' {
	if (el.className.includes('linear-gradient')) return 'gradient';
	if (el.className.includes('bg-header-wash')) return 'wash';
	return 'white';
}

beforeEach(() => {
	localStorage.clear();
	resetPromptSyncForTests();
});

describe('the footer tint (broadcast gradient, focus wash)', () => {
	it('tints the header-wash token when focused-only, white otherwise', () => {
		const h = mountFooter({ focused: true });
		expect(tintFace(h.footer())).toBe('wash');
		h.cleanup();

		const plain = mountFooter();
		expect(tintFace(plain.footer())).toBe('white');
		plain.cleanup();
	});

	it('wears the pastel gradient while the checkmark is on, white after uncheck', () => {
		const h = mountFooter();
		expect(tintFace(h.footer())).toBe('white'); // unchecked
		setSyncChecked(SID, true);
		flushSync();
		expect(tintFace(h.footer())).toBe('gradient'); // the checkmark's pastel
		setSyncChecked(SID, false);
		flushSync();
		expect(tintFace(h.footer())).toBe('white'); // uncheck untints
		h.cleanup();
	});

	it('checked wins over focused — data-focused stays a focus-only fact', () => {
		const h = mountFooter({ focused: true });
		setSyncChecked(SID, true);
		flushSync();
		expect(tintFace(h.footer())).toBe('gradient'); // membership is more specific
		expect(h.footer().getAttribute('data-focused')).toBe('true');
		setSyncChecked(SID, false);
		flushSync();
		expect(tintFace(h.footer())).toBe('wash'); // focus alone keeps its tint
		expect(h.footer().getAttribute('data-focused')).toBe('true');
		h.cleanup();

		const checkedOnly = mountFooter();
		setSyncChecked(SID, true);
		flushSync();
		expect(checkedOnly.footer().getAttribute('data-focused')).toBe('false'); // checked ≠ focused
		checkedOnly.cleanup();
	});
});
