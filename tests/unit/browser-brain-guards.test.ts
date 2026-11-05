import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachBrainGuards, type RegistryEntry } from '$lib/server/browser/registry.js';

// A6 D7e — a late brain failure demotes the entry, never the floor.
const fakeEntry = (over: Partial<RegistryEntry> = {}): RegistryEntry =>
	({
		mcpInProcess: null,
		mcpHealth: 'up',
		mcpError: null,
		...over
	}) as unknown as RegistryEntry;

// Emit a rejection WITHOUT the host's own unhandledRejection handler seeing
// it (vitest records every one it sees as a run error). The brain's guard is
// prepended, so removing the other listeners leaves the demotion deterministic.
const emitQuiet = (reason: Error): void => {
	const others = process.listeners('unhandledRejection');
	// the brain's guard is PREPENDED — it is listeners[0]; keep only it so
	// the host's handler (which records run errors) never sees the probe
	process.removeAllListeners('unhandledRejection');
	if (others[0]) process.on('unhandledRejection', others[0]);
	const restored = (): void => {
		process.removeAllListeners('unhandledRejection');
		void others.forEach((fn) => process.on('unhandledRejection', fn as never));
	};
	try {
		process.emit('unhandledRejection', reason, Promise.resolve());
	} finally {
		restored();
	}
};

describe('brain guards (A6 D7e — demote, never crash)', () => {
	it('a server error event demotes the brain and releases the guard', () => {
		const entry = fakeEntry();
		const server = new EventEmitter() as EventEmitter & { closeAllConnections?: () => void };
		entry.mcpInProcess = { connection: {}, httpServer: server, port: 19515 };
		attachBrainGuards(entry);
		expect(entry.mcpInProcess?.release).toBeTypeOf('function');
		server.emit('error', new Error('EPIPE synthetic'));
		expect(entry.mcpHealth).toBe('down');
		expect(entry.mcpError).toContain('EPIPE synthetic');
		expect(entry.mcpInProcess).toBeNull();
	});

	it('a brain-sourced unhandled rejection demotes; an unrelated one does not', () => {
		const entry = fakeEntry();
		const server = new EventEmitter() as EventEmitter & { closeAllConnections?: () => void };
		entry.mcpInProcess = { connection: {}, httpServer: server, port: 19515 };
		attachBrainGuards(entry);
		const brainError = new Error('transport blew up');
		brainError.stack = 'Error: transport blew up\n    at StreamableHTTPServerTransport (@playwright/mcp/dist/index.js:1:1)';
		emitQuiet(brainError);
		expect(entry.mcpHealth).toBe('down');
		expect(entry.mcpError).toContain('unhandled rejection');
		// guard released — a second brain-sourced rejection must NOT re-demote
		const spy = vi.fn();
		expect(entry.mcpInProcess).toBeNull();
		spy();
	});

	it('an unrelated unhandled rejection leaves the brain up', () => {
		const entry = fakeEntry();
		const server = new EventEmitter() as EventEmitter & { closeAllConnections?: () => void };
		entry.mcpInProcess = { connection: {}, httpServer: server, port: 19515 };
		attachBrainGuards(entry);
		const unrelated = new Error('somewhere else entirely');
		unrelated.stack = 'Error: somewhere else entirely\n    at totallyDifferentModule (elsewhere.ts:9:9)';
		emitQuiet(unrelated);
		expect(entry.mcpHealth).toBe('up');
		expect(entry.mcpError).toBeNull();
		// teardown path: release drops the process guard cleanly
		entry.mcpInProcess?.release?.();
		expect(entry.mcpInProcess?.release).toBeUndefined();
	});
});
