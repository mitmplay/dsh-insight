/**
 * Browser relay — one CDP session's screencast downstream + input upstream
 * (spec 2026-10-19 The Glass Browser, Wave 1 task 1.3; ADR-0029 D1/D6).
 *
 * Frames: Page.startScreencast pushes JPEG frames; the ring keeps the LATEST
 * frame only (the glass is live video, not a backlog) with a monotonic seq so
 * SSE attachers can resume. Input: dispatches are SERIALIZED — a chain, so a
 * burst of pointer events cannot race inside CDP (the terminal keystroke
 * lesson, TerminalPanel.svelte:72). The relay throws CLOSED after stop().
 */
import type { CDPSession } from 'playwright-core';

export type InputDispatch =
	| { kind: 'mouse'; type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'; x: number; y: number; button?: string; clickCount?: number; deltaX?: number; deltaY?: number }
	| { kind: 'key'; type: 'keyDown' | 'keyUp'; key: string; code: string; windowsVirtualKeyCode: number; text?: string }
	| { kind: 'text'; text: string };

export interface RelayFrame {
	seq: number;
	jpeg: string;
	metadata: Record<string, unknown>;
}

export class RelayClosedError extends Error {
	constructor() {
		super('relay is closed');
		this.name = 'RelayClosedError';
	}
}

export class BrowserRelay {
	private cdp: CDPSession | null;
	private readonly subscribers = new Set<(f: RelayFrame) => void>();
	private seq = 0;
	private latest: RelayFrame | null = null;
	private chain: Promise<void> = Promise.resolve();
	private started = false;

	/** JPEG quality 0..100 — from BrowserConfig.screencastQuality
	 *  (default 90; yaml `browser.screencast:` override, amendment 3).
	 *  maxFps — ADR-0039 D1: target fps intent; start() derives CDP's
	 *  everyNthFrame from a nominal 30 Hz paint clock (clamp ≥1). */
	constructor(cdp: CDPSession, private quality = 90, private maxFps = 15) {
		this.cdp = cdp;
	}

	async start(): Promise<void> {
		if (!this.cdp || this.started) throw new RelayClosedError();
		// no inline annotation — playwright-core infers the screencastFrame
		// payload from the .on overload (an annotation conflicts with it)
		this.cdp.on('Page.screencastFrame', (ev) => {
			this.seq += 1;
			this.latest = { seq: this.seq, jpeg: ev.data, metadata: ev.metadata as unknown as Record<string, unknown> };
			for (const sub of this.subscribers) sub(this.latest);
			void this.cdp?.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
		});
		// quality from config (default 90; omitted = Chrome's low default,
		// which dithered captcha images into noise). JPEG stays JPEG: the
		// encode is libjpeg-turbo SIMD on the CPU either way — no hardware
		// path exists to lose (ADR-0031 amendments 3).
		await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.quality, everyNthFrame: Math.max(1, Math.round(30 / this.maxFps)) });
		this.started = true;
	}

	/** Deterministic first-frame seed (RCA 2026-10-23 The First Frame That
	 *  Never Knocked): a starved screencast birth leaves the ring empty
	 *  FOREVER — screencast only speaks on paint damage. The opener synthesizes
	 *  the first frame via Page.captureScreenshot and seeds the ring here so
	 *  attachers get a frame immediately. Does not advance past a real frame. */
	seed(frame: RelayFrame): void {
		if (!this.cdp) throw new RelayClosedError();
		if (this.latest) return;
		this.seq += 1;
		this.latest = { ...frame, seq: this.seq };
		for (const sub of this.subscribers) sub(this.latest);
	}

	latestFrame(): RelayFrame | null {
		if (!this.cdp) throw new RelayClosedError();
		return this.latest;
	}

	subscribe(fn: (f: RelayFrame) => void): () => void {
		if (!this.cdp) throw new RelayClosedError();
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	/** Serialized dispatch — every input waits for the previous one. */
	dispatch(input: InputDispatch): Promise<void> {
		if (!this.cdp) return Promise.reject(new RelayClosedError());
		const run = async (): Promise<void> => {
			if (!this.cdp) throw new RelayClosedError();
			if (input.kind === 'mouse') {
				await this.cdp.send('Input.dispatchMouseEvent', {
					type: input.type,
					x: input.x,
					y: input.y,
					button: (input.button ?? 'none') as 'left',
					clickCount: input.clickCount,
					deltaX: input.deltaX,
					deltaY: input.deltaY,
					pointerType: 'mouse'
				});
			} else if (input.kind === 'key') {
				await this.cdp.send('Input.dispatchKeyEvent', {
					type: input.type,
					key: input.key,
					code: input.code,
					windowsVirtualKeyCode: input.windowsVirtualKeyCode,
					text: input.text
				});
			} else {
				await this.cdp.send('Input.insertText', { text: input.text });
			}
		};
		const next = this.chain.then(run, run);
		this.chain = next.catch(() => undefined);
		return next;
	}

	stop(): void {
		const cdp = this.cdp;
		this.cdp = null;
		this.subscribers.clear();
		this.latest = null;
		if (cdp && this.started) void cdp.send('Page.stopScreencast').catch(() => undefined);
	}
}