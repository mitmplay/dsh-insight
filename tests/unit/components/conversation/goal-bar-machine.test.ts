/**
 * GoalBarMachine unit tests — the panel-owned CAS wire machine moved
 * whole from ConversationPanel (ADR-0022 R2 W4). Covers every branch of
 * runGoalVerb (busy/null guards, ok/error/null-body/throw, edit payload
 * and editor close), openGoalEditor, editGoalField, and the diff-at-
 * submit contract of submitGoalEditor (ADR Goal Editor D3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalBarMachine } from '$lib/components/conversation/panel/goal-bar.svelte';
import type { GoalResultGoal } from '$lib/utils/goals';

function goal(partial: Partial<GoalResultGoal> = {}): GoalResultGoal {
	return {
		id: 'goal-1',
		revision: 3,
		objective: 'finish the wave',
		phase: 'active',
		roundsStarted: 2,
		maxGoalRounds: 8,
		...partial
	};
}

function makeMachine(initialGoal: GoalResultGoal | null = goal()) {
	const store = {
		goal: initialGoal as GoalResultGoal | null | undefined,
		applyGoal: vi.fn()
	};
	const noteCommand = vi.fn();
	const machine = new GoalBarMachine({
		store: store as never,
		get sessionId() {
			return 'sess-1';
		},
		noteCommand
	});
	return { machine, store, noteCommand };
}

const fetchJSON = (body: unknown) =>
	Promise.resolve({ json: () => Promise.resolve(body) } as Response);

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			void init;
			return fetchJSON({ ok: true, value: goal({ revision: 4 }) });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GoalBarMachine — runGoalVerb guards", () => {
	it("a busy chip drops the re-click (no fetch)", async () => {
		const { machine } = makeMachine();
		machine.goalBusy = true;
		await machine.runGoalVerb("pause");
		expect(fetch).not.toHaveBeenCalled();
		expect(machine.goalBusy).toBe(true);
	});

	it("no goal: no fetch, busy untouched", async () => {
		const { machine } = makeMachine(null);
		await machine.runGoalVerb("pause");
		expect(fetch).not.toHaveBeenCalled();
		expect(machine.goalBusy).toBe(false);
	});
});

describe("GoalBarMachine — runGoalVerb outcomes", () => {
	it("success applies the host GoalView and notes ok; busy resets", async () => {
		const { machine, store, noteCommand } = makeMachine();
		await machine.runGoalVerb("pause");
		expect(fetch).toHaveBeenCalledWith("/api/dsh/session/sess-1/goal", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ verb: "pause", ref: { id: "goal-1", revision: 3 } })
		});
		expect(store.applyGoal).toHaveBeenCalledTimes(1);
		expect(store.applyGoal.mock.calls[0][0].id).toBe("goal-1");
		expect(noteCommand).toHaveBeenCalledWith("ok", "goal pause");
		expect(machine.goalBusy).toBe(false);
	});

	it("ok:true with an unreadable value keeps the projection and still notes ok", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => fetchJSON({ ok: true, value: 42 })));
		const { machine, store, noteCommand } = makeMachine();
		await machine.runGoalVerb("resume");
		expect(store.applyGoal).not.toHaveBeenCalled();
		expect(noteCommand).toHaveBeenCalledWith("ok", "goal resume");
	});

	it("edit verb carries the payload and closes the editor on success", async () => {
		const { machine } = makeMachine();
		machine.openGoalEditor();
		await machine.runGoalVerb("edit", { objective: "new", maxGoalRounds: 5 });
		const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!).body as string);
		expect(sent.edit).toEqual({ objective: "new", maxGoalRounds: 5 });
		expect(machine.goalEditor).toBeNull();
	});

	it("a non-ok body surfaces the host error message", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => fetchJSON({ ok: false, error: { message: "stale ref" } })));
		const { machine, noteCommand } = makeMachine();
		await machine.runGoalVerb("clear");
		expect(noteCommand).toHaveBeenCalledWith("error", "stale ref");
	});

	it("an unreadable body (json parse refused) falls back to the verb text", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => fetchJSON({ ok: false })));
		const { machine, noteCommand } = makeMachine();
		await machine.runGoalVerb("resume");
		expect(noteCommand).toHaveBeenCalledWith("error", "goal resume failed");
	});

	it("a network throw reports err.message", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}));
		const { machine, noteCommand } = makeMachine();
		await machine.runGoalVerb("pause");
		expect(noteCommand).toHaveBeenCalledWith("error", "goal pause failed (ECONNREFUSED)");
		expect(machine.goalBusy).toBe(false);
	});

	it("a non-Error throw reports String(err)", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw "boom";
		}));
		const { machine, noteCommand } = makeMachine();
		await machine.runGoalVerb("pause");
		expect(noteCommand).toHaveBeenCalledWith("error", "goal pause failed (boom)");
	});
});

describe("GoalBarMachine — editor state", () => {
	it("openGoalEditor with no goal does nothing", () => {
		const { machine } = makeMachine(null);
		machine.openGoalEditor();
		expect(machine.goalEditor).toBeNull();
	});

	it("openGoalEditor prefills from the current projection", () => {
		const { machine } = makeMachine();
		machine.openGoalEditor();
		expect(machine.goalEditor).toEqual({ objective: "finish the wave", maxGoalRounds: 8 });
	});

	it("editGoalField with a closed editor is a no-op", () => {
		const { machine } = makeMachine();
		machine.editGoalField("objective", "x");
		expect(machine.goalEditor).toBeNull();
	});

	it("editGoalField writes the objective and finite rounds; junk rounds keep the old value", () => {
		const { machine } = makeMachine();
		machine.openGoalEditor();
		machine.editGoalField("objective", "rewritten");
		machine.editGoalField("maxGoalRounds", "12");
		expect(machine.goalEditor).toEqual({ objective: "rewritten", maxGoalRounds: 12 });
		machine.editGoalField("maxGoalRounds", "not-a-number");
		expect((machine.goalEditor as { maxGoalRounds: number }).maxGoalRounds).toBe(12);
	});
});

describe("GoalBarMachine — submitGoalEditor diff (ADR D3)", () => {
	it("closed editor: no-op", () => {
		const { machine, noteCommand } = makeMachine();
		machine.submitGoalEditor();
		expect(fetch).not.toHaveBeenCalled();
		expect(noteCommand).not.toHaveBeenCalled();
	});

	it("no goal: no-op", () => {
		const { machine } = makeMachine(null);
		machine.openGoalEditor();
		machine.submitGoalEditor();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("untouched prefill notes the nothing-changed error", async () => {
		const { machine, noteCommand } = makeMachine();
		machine.openGoalEditor();
		machine.submitGoalEditor();
		expect(fetch).not.toHaveBeenCalled();
		expect(noteCommand).toHaveBeenCalledWith(
			"error",
			"nothing changed — edit the objective or the round cap"
		);
	});

	it("a changed objective submits objective only", async () => {
		const { machine } = makeMachine();
		machine.openGoalEditor();
		machine.editGoalField("objective", "  new objective  ");
		machine.submitGoalEditor();
		await vi.waitFor(() => expect(machine.goalBusy).toBe(false));
		const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!).body as string);
		expect(sent.edit).toEqual({ objective: "new objective" });
	});

	it("a changed round cap submits maxGoalRounds only; a sub-1 cap is refused", async () => {
		const { machine } = makeMachine();
		machine.openGoalEditor();
		machine.editGoalField("maxGoalRounds", "12");
		machine.submitGoalEditor();
		await vi.waitFor(() => expect(machine.goalBusy).toBe(false));
		const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!).body as string);
		expect(sent.edit).toEqual({ maxGoalRounds: 12 });

		const second = makeMachine();
		second.machine.openGoalEditor();
		second.machine.editGoalField("maxGoalRounds", "0");
		second.machine.submitGoalEditor();
		expect(fetch).toHaveBeenCalledTimes(1); // still the first call only
	});
});