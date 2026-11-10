/**
 * Composer × Prompt Sync (ADR "The Prompt Sync", 2026-09-04) — the
 * panel-composer side of the broadcast:
 *  - D8: the checkmark is a left-flank column stacked ABOVE the paperclip
 *    button (same parent, preceding sibling), only with a sessionId;
 *  - the toggle flips the store (aria-pressed carries the state);
 *  - D4: checking never wipes the composer's draft; a store push mirrors
 *    into the textarea; a checked composer picks up existing shared text;
 *    a claimed composer mirrors an empty push too (the backspace-to-empty
 *    sync, D4 as amended 2026-09-04) while an unclaimed one never wipes;
 *  - D5: the store's submitAll runs THIS component's onsubmit (the
 *    ladder); a refusing ladder keeps the mirrored text (kept);
 *  - D1/D2: unmount unregisters (a gone composer owns no membership).
 *
 * Harness copied from prompt-input-draft.test.ts (component-direct mount,
 * fetch stubbed at the global seam).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import LensComposerHost from '../../LensComposerHost.svelte';
import {
	isSyncChecked,
	pushSharedText,
	registerSyncMember,
	resetPromptSyncForTests,
	setSyncChecked,
	submitAll
} from '$lib/services/chat/prompt-sync.svelte';

vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Promise<Response>(() => {}))
);

const SID = '9f0c1a2b-3d4e-4f5a-6b7c-8d9e0a1b2c3d';

function mountInput(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onsubmit = vi.fn(async () => true);
	const comp = mount(Composer, {
		target,
		props: {
			onsubmit,
			oncancel: () => {},
			isStreaming: false,
			sending: false,
			sessionId: SID,
			...props
		}
	});
	flushSync();
	const textarea = () =>
		target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const check = () => target.querySelector('[data-testid="prompt-sync-check"]') as HTMLButtonElement;
	const attach = () => target.querySelector('[data-testid="attach-button"]') as HTMLButtonElement;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, textarea, check, attach, onsubmit, cleanup, instance: comp };
}

/** Type into the composer and fire the input event (native-like). */
function type(h: ReturnType<typeof mountInput>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	localStorage.clear();
	resetPromptSyncForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('checkmark placement + render (D8)', () => {
	it('the checkmark stacks ABOVE the paperclip in the same left-flank column', () => {
		const h = mountInput();
		const checkEl = h.check();
		const attachEl = h.attach();
		expect(checkEl).toBeTruthy();
		// The checkmark sits in the flank column BEFORE the paperclip (the
		// column's own members: check, then AttachmentManager's fragment
		// root — its sr-only file input, then the attach button; the input
		// is position:absolute, so it never joins the flex layout).
		expect(checkEl.parentElement?.contains(attachEl)).toBe(true);
		expect(
			(checkEl.compareDocumentPosition(attachEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
		).toBe(true);
		h.cleanup();
	});

	it('renders only when the composer has a session', () => {
		const h = mountInput({ sessionId: undefined });
		expect(h.check()).toBeNull();
		h.cleanup();
	});

	it('clicking toggles the store and aria-pressed follows', () => {
		const h = mountInput();
		expect(isSyncChecked(SID)).toBe(false);
		expect(h.check().getAttribute('aria-pressed')).toBe('false');
		h.check().click();
		flushSync();
		expect(isSyncChecked(SID)).toBe(true);
		expect(h.check().getAttribute('aria-pressed')).toBe('true');
		h.check().click();
		flushSync();
		expect(isSyncChecked(SID)).toBe(false);
		h.cleanup();
	});
});

describe('the mirror (D3/D4)', () => {
	it('checking with an empty shared text keeps the composer draft', () => {
		const h = mountInput();
		type(h, 'my draft');
		setSyncChecked(SID, true);
		flushSync();
		expect(h.textarea().value).toBe('my draft');
		h.cleanup();
	});

	it('a store push mirrors into the composer textarea', () => {
		const h = mountInput();
		setSyncChecked(SID, true);
		pushSharedText('hello checked panel');
		flushSync();
		expect(h.textarea().value).toBe('hello checked panel');
		h.cleanup();
	});

	it('checking while a broadcast is live picks the shared text up immediately', () => {
		const h = mountInput();
		pushSharedText('already typing');
		setSyncChecked(SID, true);
		flushSync();
		expect(h.textarea().value).toBe('already typing');
		h.cleanup();
	});

	it('an unchecked composer never mirrors', () => {
		const h = mountInput();
		pushSharedText('not for you');
		flushSync();
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('an empty push clears a claimed composer (the backspace-to-empty sync)', () => {
		const h = mountInput();
		setSyncChecked(SID, true);
		pushSharedText('hello');
		flushSync();
		expect(h.textarea().value).toBe('hello');
		pushSharedText(''); // the backspace that empties the sidebar box
		flushSync();
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('an empty push never wipes an unclaimed draft (a check still never wipes)', () => {
		const h = mountInput();
		type(h, 'my draft');
		setSyncChecked(SID, true); // the box is empty — unclaimed
		pushSharedText('');
		flushSync();
		expect(h.textarea().value).toBe('my draft');
		h.cleanup();
	});

	it('an unrelated uncheck does not echo the shared text over a local edit', () => {
		const OTHER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
		const h = mountInput();
		const other = mountInput({ sessionId: OTHER });
		setSyncChecked(SID, true);
		setSyncChecked(OTHER, true);
		pushSharedText('abc');
		flushSync();
		expect(h.textarea().value).toBe('abc');
		type(h, 'abcd'); // panel-local divergence (D3)
		setSyncChecked(OTHER, false); // an unrelated membership transition
		flushSync();
		expect(h.textarea().value).toBe('abcd'); // not echoed back to the box's text
		h.cleanup();
		other.cleanup();
	});
});

describe('submit through the ladder (D5)', () => {
	it('submitAll runs this composer onsubmit with the mirrored text', async () => {
		const h = mountInput();
		setSyncChecked(SID, true);
		pushSharedText('broadcast prompt');
		flushSync();
		const result = await submitAll();
		flushSync();
		expect(result.dispatched).toBe(1);
		expect(h.onsubmit).toHaveBeenCalledTimes(1);
		expect(h.onsubmit).toHaveBeenCalledWith('broadcast prompt', []);
		expect(h.textarea().value).toBe(''); // the ladder cleared the draft
		h.cleanup();
	});

	it('a refusing ladder (onsubmit false) keeps the mirrored text as kept', async () => {
		const h = mountInput({ onsubmit: async () => false });
		setSyncChecked(SID, true);
		pushSharedText('still here');
		flushSync();
		const result = await submitAll();
		flushSync();
		expect(result.dispatched).toBe(0);
		expect(result.kept).toEqual([SID]);
		expect(h.textarea().value).toBe('still here');
		h.cleanup();
	});

	it('a streaming composer refuses the broadcast submit (the guard arm)', async () => {
		const h = mountInput({ isStreaming: true });
		setSyncChecked(SID, true);
		pushSharedText('during a run');
		flushSync();
		const result = await submitAll();
		flushSync();
		// submit() returns false at the isStreaming||locked guard — the
		// ladder never fires and the text counts as kept.
		expect(result.dispatched).toBe(0);
		expect(result.kept).toEqual([SID]);
		expect(h.onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('during a run');
		h.cleanup();
	});

	it('blur without a session skips the draft flush (no-session arm)', () => {
		const h = mountInput({ sessionId: undefined });
		const ta = h.textarea();
		ta.focus();
		ta.dispatchEvent(new FocusEvent('blur'));
		flushSync();
		expect(() => h.cleanup()).not.toThrow();
	});

	it('a run-shaped draft (! line) is never sent through the ladder', async () => {		const h = mountInput();
		setSyncChecked(SID, true);
		pushSharedText('!run tests');
		flushSync();
		const result = await submitAll();
		flushSync();
		// The run shape returns false before the wire — the strip owns it.
		expect(result.dispatched).toBe(0);
		expect(h.onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('!run tests');
		h.cleanup();
	});
});

describe('membership lifecycle (D1/D2)', () => {
	it('unmount unregisters — a gone composer counts as kept, prune clears it', async () => {
		const h = mountInput();
		setSyncChecked(SID, true);
		pushSharedText('for you');
		flushSync();
		h.cleanup(); // panel closed mid-broadcast
		const result = await submitAll();
		expect(result.dispatched).toBe(0);
		// The floor owner's prune then drops the stale check entirely.
		const { pruneSync } = await import('$lib/services/chat/prompt-sync.svelte');
		pruneSync(new Set());
		expect(isSyncChecked(SID)).toBe(false);
	});

	it('a session swap re-registers under the new session only', () => {
		const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		const h = mountInput();
		setSyncChecked(SID, true);
		// registerSyncMember under OTHER (the remounted composer's session).
		const dispose = registerSyncMember(OTHER, {
			getText: () => '',
			setText: () => {},
			submit: async () => true
		});
		setSyncChecked(OTHER, true);
		expect(isSyncChecked(SID)).toBe(true);
		expect(isSyncChecked(OTHER)).toBe(true);
		dispose();
		h.cleanup();
	});
});

describe('the lens disable (Panel Loupe D8, 2026-09-04)', () => {
	/** Mount the composer inside a lens tree (the LensComposerHost
	 *  fixture = the PanelLoupe provider shape) and return the check. */
	function mountLensInput(props: Record<string, unknown> = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(LensComposerHost, {
			target,
			props: { sessionId: SID, ...props }
		});
		flushSync();
		const check = () =>
			target.querySelector('[data-testid="prompt-sync-check"]') as HTMLButtonElement;
		const cleanup = () => {
			unmount(comp);
			target.remove();
		};
		return { check, cleanup };
	}

	it('plain mount: the check renders enabled (the floor behavior, the probe pin)', () => {
		const h = mountInput();
		expect(h.check().disabled).toBe(false);
		h.cleanup();
	});

	it('a lens-tree mount renders the check visible and disabled; membership never flips', () => {
		const h = mountLensInput();
		const check = h.check();
		expect(check).toBeTruthy(); // visible — the verb renders whole
		expect(check.disabled).toBe(true); // the real attribute, D8's contract
		check.click(); // happy-dom swallows clicks at disabled buttons
		flushSync();
		expect(check.getAttribute('aria-pressed')).toBe('false');
		expect(isSyncChecked(SID)).toBe(false);
		h.cleanup();
	});

	it('a lens-tree mount with lens false renders enabled (the control arm)', () => {
		const h = mountLensInput({ lens: false });
		expect(h.check().disabled).toBe(false);
		h.cleanup();
	});
});
