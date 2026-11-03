/**
 * ModelSelector unit tests (POC-3 W3 3.2 coverage lane): the header
 * dropdown's directory fetch lifecycle and the pick wire — mount-time
 * fetch + closed label, open/close toggle with directory caching,
 * loading/empty/current-only/failure render states, HTTP + garbage-JSON
 * degradation, retry, and the one-shot select-model POST (normalized
 * adoption, same-option no-op, failure surfaces).
 *
 * Pattern: direct mount (chat-components.test.ts) with a route-aware
 * global fetch stub (current-model.test.ts Response stubbing).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from '$lib/components/composer/sibling/ModelSelector.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	// One macrotask hop: every pending promise chain (fetch stub →
	// Response.json → state write) resolves before the next flush.
	await new Promise((r) => setTimeout(r, 0));
	for (let i = 0; i < 3; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Directory fixture — the normalized GET /models body shape. */
function directory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		current: { provider: 'openai', model: 'gpt-5' },
		routable: true,
		groups: [
			{
				id: 'openai',
				name: 'OpenAI',
				models: [
					{ id: 'gpt-5', name: 'GPT-5' },
					{ id: 'gpt-4o', name: null }
				]
			}
		],
		failures: [],
		...overrides
	};
}

interface Recorded {
	url: string;
	method: string;
	body?: string;
}

/** Route-aware fetch stub: every call recorded, handler answers. */
function stubFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): { calls: Recorded[] } {
	const calls: Recorded[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : String(init.body) });
			return handler(url, init);
		})
	);
	return { calls };
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mountSelector(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ModelSelector, { target, props: { sessionId: 's-model', ...props } as never });
	return {
		target,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

describe('ModelSelector — mount fetch + closed label', () => {
	it('fetches the directory once on mount and labels the button provider / model', async () => {
		const { calls } = stubFetch(() => json(directory()));
		const h = mountSelector();
		await settle();
		expect(calls.map((c) => c.url)).toEqual(['/api/dsh/session/s-model/models']);
		const btn = h.target.querySelector('[data-testid="model-selector-button"]') as HTMLElement;
		expect(btn.textContent).toContain('openai / gpt-5');
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).toBeNull(); // closed
		h.cleanup();
	});

	it('no current selection renders the honest "model —" placeholder', async () => {
		stubFetch(() => json(directory({ current: null })));
		const h = mountSelector();
		await settle();
		const btn = h.target.querySelector('[data-testid="model-selector-button"]') as HTMLElement;
		expect(btn.textContent).toContain('model —');
		h.cleanup();
	});
});

describe('ModelSelector — open/close toggle + render states', () => {
	it('toggle opens the listbox with options; close/reopen never refetches (directory cached)', async () => {
		const { calls } = stubFetch(() => json(directory()));
		const h = mountSelector();
		await settle();
		const btn = h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement;
		btn.click();
		await settle();
		const menu = h.target.querySelector('[data-testid="model-selector-menu"]') as HTMLElement;
		expect(menu).not.toBeNull();
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		const options = [...h.target.querySelectorAll('[data-testid="model-option"]')];
		expect(options.map((o) => o.getAttribute('data-model'))).toEqual(['gpt-5', 'gpt-4o']);
		// The null-named model falls back to its id for display.
		expect(options[1].textContent).toContain('gpt-4o');
		// The current option carries the selected marker + aria.
		expect(options[0].getAttribute('aria-selected')).toBe('true');
		expect(options[0].querySelector('[data-testid="model-option-current"]')).not.toBeNull();

		btn.click(); // close
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).toBeNull();
		btn.click(); // reopen — directory is cached, no second GET
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).not.toBeNull();
		expect(calls).toHaveLength(1);
		h.cleanup();
	});

	it('loading state renders while the directory request is pending', async () => {
		let release!: (value: Response) => void;
		stubFetch(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				})
		);
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-loading"]')).not.toBeNull();
		release(json(directory()));
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-loading"]')).toBeNull();
		expect(h.target.querySelectorAll('[data-testid="model-option"]').length).toBe(2);
		h.cleanup();
	});

	it('empty directory (no groups, no current) renders "No models listed"', async () => {
		stubFetch(() => json({ current: null, routable: false, groups: [], failures: [] }));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-empty"]')?.textContent).toContain(
			'No models listed'
		);
		h.cleanup();
	});

	it('current model without a catalog renders the current-only line', async () => {
		stubFetch(() => json(directory({ groups: [] })));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		const line = h.target.querySelector('[data-testid="model-selector-current-only"]');
		expect(line?.textContent).toContain('Current: openai / gpt-5');
		expect(line?.textContent).toContain('catalog unavailable');
		h.cleanup();
	});

	it('provider failures render the failure count, singular and plural', async () => {
		stubFetch((url) =>
			json(
				directory({
					failures: url.includes('s-model-one')
						? [{ id: 'anthropic', name: null, message: 'dead key' }]
						: [
								{ id: 'anthropic', name: 'Anthropic', message: 'dead key' },
								{ id: 'gemini', name: null, message: null }
							]
				})
			)
		);
		const one = mountSelector({ sessionId: 's-model-one' });
		await settle();
		(one.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(one.target.querySelector('[data-testid="model-selector-failures"]')?.textContent).toContain(
			'1 provider failed to load'
		);
		one.cleanup();

		const two = mountSelector({ sessionId: 's-model-two' });
		await settle();
		(two.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(two.target.querySelector('[data-testid="model-selector-failures"]')?.textContent).toContain(
			'2 providers failed to load'
		);
		two.cleanup();
	});
});

describe('ModelSelector — load failures', () => {
	it('HTTP failure renders the host error + Retry; a retry refetches and recovers', async () => {
		let failures = 1;
		const { calls } = stubFetch(() =>
			failures > 0
				? json({ ok: false, error: { message: 'catalog down' } }, 500)
				: json(directory())
		);
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain(
			'catalog down'
		);
		failures = 0;
		(h.target.querySelector('[data-testid="model-selector-retry"]') as HTMLButtonElement).click();
		await settle();
		expect(calls).toHaveLength(2);
		expect(h.target.querySelectorAll('[data-testid="model-option"]').length).toBe(2);
		h.cleanup();
	});

	it('a garbage JSON body degrades to the status message (never throws)', async () => {
		stubFetch(() => new Response('not json at all', { status: 200 }));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain(
			'models failed (200)'
		);
		h.cleanup();
	});

	it('a transport failure on the directory GET surfaces the error message', async () => {
		stubFetch(() => Promise.reject(new Error('network down')));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain(
			'network down'
		);
		h.cleanup();
	});
});

describe('ModelSelector — pick (select-model wire)', () => {
	it('picking a model POSTs once, adopts the normalized selection, and closes', async () => {
		const posts: Recorded[] = [];
		const { calls } = stubFetch((url, init) => {
			if (init?.method === 'POST') {
				posts.push({ url, method: 'POST', body: init.body === undefined ? undefined : String(init.body) });
				return json({ ok: true, selected: { provider: 'openai', model: 'gpt-4o' } });
			}
			return json(directory());
		});
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-4o"]') as HTMLButtonElement).click();
		await settle();
		// Text-only body (no reasoningEffort key) — the effort lane has no UI affordance.
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toBe('/api/dsh/session/s-model/select-model');
		expect(JSON.parse(posts[0].body ?? '{}')).toEqual({ provider: 'openai', model: 'gpt-4o' });
		// Menu closed; the closed label reads the host's normalized pick.
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).toBeNull();
		expect(
			(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLElement).textContent
		).toContain('openai / gpt-4o');
		// Reopen: the adopted pick is the marked current option.
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		const marked = h.target.querySelector('[data-testid="model-option"][aria-selected="true"]');
		expect(marked?.getAttribute('data-model')).toBe('gpt-4o');
		expect(calls).toHaveLength(2); // mount GET + select POST — the cached directory never refetches
		h.cleanup();
	});

	it('picking the already-current model submits nothing', async () => {
		const { calls } = stubFetch(() => json(directory()));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-5"]') as HTMLButtonElement).click();
		await settle();
		expect(calls).toHaveLength(1); // mount GET only
		h.cleanup();
	});

	it('a rejected select surfaces the host message verbatim in the open menu', async () => {
		stubFetch((url, init) => (init?.method === 'POST'
			? json({ ok: false, error: { message: 'model not routable' } }, 400)
			: json(directory())));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-4o"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain(
			'model not routable'
		);
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).not.toBeNull(); // stays open for a re-pick
		h.cleanup();
	});

	it('a garbage select response degrades to select failed (HTTP status)', async () => {
		stubFetch((url, init) => (init?.method === 'POST' ? new Response('garbage', { status: 200 }) : json(directory())));
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-4o"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain(
			'select failed (200)'
		);
		h.cleanup();
	});

	it('a transport failure on select surfaces the error message', async () => {
		stubFetch((url, init) => {
			if (init?.method === 'POST') return Promise.reject(new Error('wire dead'));
			return json(directory());
		});
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-4o"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-error"]')?.textContent).toContain('wire dead');
		h.cleanup();
	});

	it('options lock while a pick is in flight (double-submit guard renders disabled)', async () => {
		let release!: (value: Response) => void;
		stubFetch((url, init) => {
			if (init?.method === 'POST') {
				return new Promise<Response>((resolve) => {
					release = resolve;
				});
			}
			return json(directory());
		});
		const h = mountSelector();
		await settle();
		(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		(h.target.querySelector('[data-testid="model-option"][data-model="gpt-4o"]') as HTMLButtonElement).click();
		await settle();
		const locked = [...h.target.querySelectorAll('[data-testid="model-option"]')] as HTMLButtonElement[];
		expect(locked.every((o) => o.disabled)).toBe(true);
		release(json({ ok: true, selected: { provider: 'openai', model: 'gpt-4o' } }));
		await settle();
		expect(h.target.querySelector('[data-testid="model-selector-menu"]')).toBeNull(); // adopted + closed
		h.cleanup();
	});
});

describe('ModelSelector — disabled prop', () => {
	it('the trigger is disabled while a rename/select is in flight elsewhere', async () => {
		stubFetch(() => json(directory()));
		const h = mountSelector({ disabled: true });
		await settle();
		expect(
			(h.target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).disabled
		).toBe(true);
		h.cleanup();
	});
});

describe('ModelSelector — dismissal contract (spec 2026-11-01)', () => {
	function outsidePointerDown(): void {
		const stranger = document.createElement('button');
		document.body.appendChild(stranger);
		stranger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		stranger.remove();
	}

	it('outside pointerdown closes the menu', async () => {
		stubFetch(() => json(directory()));
		const { target, cleanup } = mountSelector();
		await settle();
		(target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="model-selector-menu"]')).not.toBeNull();
		outsidePointerDown();
		await settle();
		expect(target.querySelector('[data-testid="model-selector-menu"]')).toBeNull();
		cleanup();
	});

	it('Escape closes the menu and returns focus to the trigger', async () => {
		stubFetch(() => json(directory()));
		const { target, cleanup } = mountSelector();
		await settle();
		const btn = target.querySelector('[data-testid="model-selector-button"]') as HTMLButtonElement;
		btn.click();
		await settle();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(target.querySelector('[data-testid="model-selector-menu"]')).toBeNull();
		expect(document.activeElement).toBe(btn);
		cleanup();
	});
});

