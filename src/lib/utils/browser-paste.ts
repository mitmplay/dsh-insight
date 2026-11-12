/**
 * browser-paste — the ONE clipboard-read dispatcher (ADR-0061 D5). Both
 * paste paths that START from the operator's clipboard (the header Paste
 * button; the native paste event supplies its own text and chunks
 * directly) land the read + chunk + in-order send here. Chunks post IN
 * ORDER, awaiting each response before the next — the relay chain is
 * serialized only if the client never races (Tasks.md commitment 6).
 */
import { pasteChunks } from './paste-chunks.js';

/** Honest outcomes only: 'denied'/'empty' are no-op states, never a
 *  fake success (risk register row 1). */
export type PasteOutcome = 'pasted' | 'empty' | 'denied';

export async function dispatchClipboardPaste(send: (chunk: string) => Promise<void>): Promise<PasteOutcome> {
	let text: string;
	try {
		text = await navigator.clipboard.readText();
	} catch {
		return 'denied'; // clipboard read refused — nothing honest to paste
	}
	if (!text) return 'empty';
	for (const chunk of pasteChunks(text)) await send(chunk);
	return 'pasted';
}
