/**
 * /api/browser/[id]/input — the pointer/keyboard dispatcher (Wave 1, 1.4).
 * Body is a validated InputDispatch (mouse | key | text) in ALREADY-SCALED
 * CSS-pixel coordinates — the panel owns the displayed÷viewport math (D6).
 * 409 CLOSED after panel-close (D8); 404 NO_SESSION for an unknown id.
 */
import { json } from '@sveltejs/kit';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';
import type { InputDispatch } from '$lib/server/browser/relay.js';

const MOUSE_TYPES = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']);
const KEY_TYPES = new Set(['keyDown', 'keyUp']);

function validate(body: unknown): InputDispatch | null {
	const b = body as Record<string, unknown>;
	if (!b || typeof b !== 'object') return null;
	if (b.kind === 'mouse' && MOUSE_TYPES.has(String(b.type)) && Number.isFinite(b.x) && Number.isFinite(b.y)) {
		return { kind: 'mouse', type: b.type as 'mousePressed', x: Number(b.x), y: Number(b.y), button: typeof b.button === 'string' ? b.button : undefined, clickCount: typeof b.clickCount === 'number' ? b.clickCount : undefined, deltaX: typeof b.deltaX === 'number' ? b.deltaX : undefined, deltaY: typeof b.deltaY === 'number' ? b.deltaY : undefined };
	}
	if (b.kind === 'key' && KEY_TYPES.has(String(b.type)) && typeof b.key === 'string' && typeof b.code === 'string') {
		return { kind: 'key', type: b.type as 'keyDown', key: b.key, code: b.code, windowsVirtualKeyCode: Number(b.windowsVirtualKeyCode) || 0, text: typeof b.text === 'string' ? b.text : undefined };
	}
	if (b.kind === 'text' && typeof b.text === 'string' && b.text.length < 4096) return { kind: 'text', text: b.text };
	return null;
}

export const POST = async (ctx: { params: { id: string }; request: Request }): Promise<Response> => {
	let body: unknown;
	try {
		body = await ctx.request.json();
	} catch {
		return json({ error: 'BAD_REQUEST' }, { status: 400 });
	}
	const input = validate(body);
	if (!input) return json({ error: 'BAD_INPUT' }, { status: 400 });
	try {
		// ADR-0040 D3: optional tab pointer; absent means the ACTIVE tab.
		const tid = (body as { targetId?: unknown }).targetId;
		await browserRegistry.dispatch(ctx.params.id, input, typeof tid === 'string' && tid ? tid : undefined);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof BrowserRegistryRefusal) {
			return json({ error: err.code }, { status: err.code === 'NO_SESSION' || err.code === 'NO_TARGET' ? 404 : 409 });
		}
		if ((err as Error).name === 'RelayClosedError') return json({ error: 'CLOSED' }, { status: 409 });
		throw err;
	}
};
