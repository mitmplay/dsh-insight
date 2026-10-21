<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { ArrowUp, Square, SquareCheck } from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';
	import type { AttachmentDraft, SerializedImage } from '$lib/services/chat/attachment-service.svelte';
	import { DEFAULT_IMAGE_LIMITS } from '$lib/services/conversation/image-limits';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import {
		getTrigger,
		searchKey,
		triggerMode,
		type SuggestedPrompt
	} from '$lib/services/chat/prompt-trigger.js';
	import { MENU_GESTURES } from '$lib/services/chat/command-help';
	import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
	import { loadDraft } from '$lib/utils/draft-prefs';
import { DraftPersistence } from '$lib/services/chat/draft-persistence.svelte';
	import {
		isSyncChecked,
		mirrorTextFor,
		registerSyncMember,
		setSyncChecked,
		type SyncSlashView,
		type SyncStripView
	} from '$lib/services/chat/prompt-sync.svelte';
	import { getLensMode } from '$lib/services/conversation/lens-context.svelte';
	import TokenCounter from './sibling/TokenCounter.svelte';
	import ModelSelector from './sibling/ModelSelector.svelte';
	import PromptInputText from './sibling/PromptInputText.svelte';
	import StreamingIndicator from './sibling/StreamingIndicator.svelte';
	import ContextConsumption from './sibling/ContextConsumption.svelte';
	import AccessModeChip from './access-mode/AccessModeChip.svelte';
	import AttachmentChips from './attachment/AttachmentChips.svelte';
	import AttachmentManager from './attachment/AttachmentManager.svelte';
	import SuggestStrip from './menu/suggest-strip/SuggestStrip.svelte';
	import SlashMenu from './menu/SlashMenu.svelte';
	import CommandHelpCard from '../card/CommandHelpCard.svelte';
	import PromptsManagerDialog from '../prompt-manager/PromptsManagerDialog.svelte';
	import { KeyboardRouter } from './controller/keyboard-router.svelte';
	import { HelpController } from './controller/help-controller.svelte';
	import { SlashController } from './controller/slash-controller.svelte';
	import { StripController } from './controller/suggest-controller.svelte';

	/**
	 * Composer — the send surface (PRD §3.4: input → Cancel/dots UX).
	 *
	 * Contract (BC-3 + rapid double-submit lock):
	 *   - Enter submits, Shift+Enter newlines
	 *   - sending=true (awaiting the receipt): textarea + button locked
	 *   - isStreaming=true (turn running): Send flips to red Cancel
	 *   - empty text never submits
	 *
	 * Command help (command-help, 2026-08-30): a draft that is a known
	 * command with `?` as its entire first argument (`/new ?`,
	 * `/permission ?`, `@<session-id> ?`) opens the CommandHelpCard above
	 * the textarea; Enter never sends a `?` line, Esc hides the card.
	 *
	 * Slash Menu (ADR "The Slash Menu", 2026-08-30): the THIRD floating
	 * surface. A `/`-draft the parser DECLINES opens the two-section host
	 * vocabulary (parser stand-down — gesture drafts never open it);
	 * Enter/arrows intercept only while filter-matching rows exist, else
	 * Enter falls through to submit (the strip's row-gated guard). Kind-
	 * aware picks: hint-less commands execute via onpickcommand (BC-A3
	 * boolean), hint commands and skills land `/name ` — the operator's
	 * Enter is press 2. Catalog state rides props (onslashopen bridge);
	 * this component never fetches and never wakes a cold session.
	 *
	 * Auto-grow (OCI pattern, 2026-08-23): the textarea fits its content
	 * and clamps at MAX_ROWS rows — height = min(scrollHeight,
	 * MAX_ROWS × lineHeight), measured from the live element (no magic
	 * pixel constants). Past the clamp the box scrolls instead of growing.
	 *
	 * Config (2026-08-25, OCI ~/.openclaw-insight pattern): MAX_ROWS starts
	 * at the default 15 and re-clamps when ~/.dsi/settings.yaml
	 * `chat.input.maxRows` arrives (GET /api/config, singleton load shared
	 * by every panel — reading it in the auto-grow effect re-measures on
	 * arrival).
	 *
	 * Info row (OCI ChatInput pattern, 2026-08-23) under the textarea:
	 *   TokenCounter + AccessModeChip (left) · ModelSelector (center) ·
	 * ContextConsumption (right). The selector opens upward (menuUp) — a
	 * downward menu would clip off the page bottom. All members are
	 * optional: the row renders only when something is in it, and each
	 * member hides itself without data.
	 *
	 * Access chip (ADR-0007, 2026-08-25): the left flank mirrors DSH's
	 * composer grammar (access mode beside the turn-shaping controls,
	 * context opposite) — "about the input you're about to send". The
	 * chip hides without `permission` or `onpermission`. Mid-flight it
	 * stays USABLE (2026-08-28): a running turn never locks it (DSH
	 * parity — the pick is a host-side command, independent of the
	 * turn); only the submit window does.
	 *
	 * Draft persistence (2026-08-30, HMR DX): the draft saves debounced to
	 * `localStorage['dsi-draft_<sessionId>']` (draft-prefs) while typing
	 * and is the composer's INITIAL value at the next mount with the
	 * caret at the end — an HMR strike or reload mid-typing no longer
	 * wipes it. An unmount inside the debounce window flushes the tail;
	 * blur flushes with focused=false; send, macro run-accept, and any
	 * emptied draft clear the stored entry synchronously.
	 *
	 * Presentational: state arrives via props, intents leave via callbacks.
	 */
	interface Props {
		/** Resolves false when nothing was admitted (W2 failure path):
		 *  drafts survive a rejected send (BC-A3). Any other result clears.
		 *  Wave 2: images arrive serialized at submit (serialize-at-submit,
		 *  BC-A2) — the only moment base64 exists in the composer. */
		onsubmit: (text: string, images: SerializedImage[]) => boolean | Promise<boolean>;
		oncancel: () => void | Promise<void>;
		isStreaming: boolean;
		sending: boolean;
		/** Session id — mounts the ModelSelector in the info row's center. */
		sessionId?: string;
		/** Context tokens consumed by the last model request (wire usage). */
		contextTokens?: number;
		/** Model context window size — absent on the DSH wire today. */
		totalContextLimit?: number;
		/** Access-mode read state (ADR-0007); null/absent hides the chip. */
		permission?: import('$lib/services/conversation/permission-state').DsiPermission | null;
		/** Submit one preset pick (the panel POSTs the /permission line). */
		onpermission?: (preset: string) => Promise<boolean> | boolean;
		/** Host admission numbers (imageLimits projection, task 4.2) —
		 *  drives the picker accept list, pre-flight, and drop copy. */
		imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits;
		/** Prompt Macro (ADR "The Prompt Macro", 2026-08-29): `!` accept is
		 *  find-and-RUN — Enter/Tab/click on a strip row fires this with the
		 *  highlighted index instead of inserting text. Absent = run mode
		 *  falls back to insert (the component never imports the runner —
		 *  presentational contract, D7). */
		onrunmacro?: (index: number) => void;
		/** ⏯ Step on a strip row (run mode): start the run HELD — the
		 *  supervised path (D10). Absent hides the Step buttons. */
		onstep?: (index: number) => void;
		/** Prompt Macro (W2 2.2): the panel mirrors the strip rows to
		 *  resolve accepted indices into row text/id at accept time — the
		 *  composer reports its own state (presentational contract kept;
		 *  the panel never reaches into the component). */
		onrows?: (rows: SuggestedPrompt[]) => void;
		/** Slash Menu (ADR "The Slash Menu", 2026-08-30): the session's
		 *  cached host catalog + lifecycle, bridged from the panel — the
		 *  component never fetches (props-only, the MacroBar rule);
		 *  null/absent renders the menu's loading row until the bridge
		 *  lands the first read. */
		slashCatalog?: SlashDirectory | null;
		/** Fired while the menu is open-shaped and its query moved (the
		 *  open included): the panel re-reads directoryFor — a no-op map
		 *  read while cached, the single-flight fetch kick on first open.
		 *  Never fires closed, so a panel mount wakes nothing (ADR §3.3). */
		onslashopen?: () => void;
		/** Execute a picked hint-less host command: the FULL line rides
		 *  the command route; the boolean admits draft clearing (BC-A3 —
		 *  false keeps the draft, the honest note is the receipt). */
		onpickcommand?: (line: string) => boolean | Promise<boolean>;
		/** Pick a hint-carrying command row — the composer lands `/name `
		 *  (press 2 sends); the panel is informed for symmetry. */
		onpickcommandwithhint?: (name: string) => void;
		/** Pick a skill row — the composer lands `/name `; the operator's
		 *  own Enter is press 2 (the two-press rule, never auto-sent). */
		onpickskill?: (name: string) => void;
		/** Focus the textarea once at mount (the /new swap-focus, 2026-08-29):
		 *  the floor marks a panel the operator just retargeted, and the
		 *  fresh composer takes the caret. Absent/false (every ordinary
		 *  mount — page load, restored desk) never steals focus. */
		focusOnMount?: boolean;
		/** Fired once after the mount focus landed — the floor clears its
		 *  one-shot marker on it (a panel that never mounts, e.g. a dead
		 *  session's error card, leaves the marker inert). */
		onfocused?: () => void;
	}

	let {
		onsubmit,
		oncancel,
		isStreaming,
		sending,
		sessionId,
		contextTokens,
		totalContextLimit,
		permission = null,
		onpermission = undefined,
		imageLimits = undefined,
		onrunmacro = undefined,
		onstep = undefined,
		onrows = undefined,
		slashCatalog = null,
		onslashopen = undefined,
		onpickcommand = undefined,
		onpickcommandwithhint = undefined,
		onpickskill = undefined,
		focusOnMount = false,
		onfocused = undefined
	}: Props = $props();

	// ── Draft persistence (HMR/reload DX, 2026-08-30) ──
	/** Restored draft, read ONCE at init: the script body re-runs on every
	 *  HMR remount, so the saved text is the composer's INITIAL state —
	 *  in place before any effect (including the save watcher below) can
	 *  run. SSR reads no localStorage and restores nothing. */
	// Intentional initial capture: the panel floor keys panels by sessionId
	// (a session change remounts rather than re-initializes), so the draft
	// belongs to the mount's one session.
	// svelte-ignore state_referenced_locally
	const restoredDraft = sessionId !== undefined ? loadDraft(sessionId) : null;
	// svelte-ignore state_referenced_locally
	let value = $state(restoredDraft?.text ?? '');

	// Lens flag (The Panel Loupe ADR D8, 2026-09-04), read ONCE at init —
	// the same read point as the draft above: a composer only ever remounts
	// per surface, never flips surfaces live. True inside the loupe: the
	// prompt-sync check renders visible-disabled, because the broadcast
	// membership it toggles is keyed by session id — a live second check
	// would be control-at-a-distance over the floor column's membership.
	const lens = getLensMode();
	/** In-flight submit awaiting its receipt (component-owned lock, BC-3). */
	let awaiting = $state(false);

	/** Whether the textarea owned the caret at the last focus/blur — the
	 *  flag, not a live DOM read, is what a teardown-time flush saves
	 *  (an element removed mid-HMR fires no blur). */
	let textareaFocused = false;
	/** Debounced draft save/clear (ADR-0018 W3 3.1): scheduling lives in
	 *  the service; this composer instance owns its own timer instance. */
	const draftPersistence = new DraftPersistence(400);

	// Debounced save while typing; an emptied draft clears SYNCHRONOUSLY —
	// send / macro run-accept must never let a submitted prompt resurrect
	// from storage.
	$effect(() => {
		if (sessionId === undefined) return;
		draftPersistence.schedule(sessionId, value, () => textareaFocused);
	});

	// Teardown flush — no reactive reads in the body, so this runs ONCE
	// at unmount: an HMR strike (or panel close) inside the debounce
	// window still persists the tail, and the remount's restore picks it
	// up. The closure reads the CURRENT value/flag at teardown time.
	$effect(() => {
		return () => {
			if (sessionId !== undefined) {
				draftPersistence.flush(sessionId, value, textareaFocused);
			} else {
				draftPersistence.cancel();
			}
		};
	});

	/** Draft attachments (task 1.5): the Manager owns the service; the
	 *  chips row, the enable rule, and the submit payload read the mirror. */
	let attachmentMgr = $state<AttachmentManager>();
	let drafts = $state<AttachmentDraft[]>([]);

	const locked = $derived(sending || awaiting);
	const disabled = $derived(
		locked || (isStreaming ? false : value.trim().length === 0 && drafts.length === 0)
	);

	// ── Prompt Sync (ADR "The Prompt Sync", 2026-09-04) ──
	/** The checkmark's state — this session's membership in the sidebar
	 *  broadcast (the store is the one owner; the button only flips it). */
	const syncChecked = $derived(sessionId !== undefined && isSyncChecked(sessionId));

	// ── Suggest Strip state (ADR "The Suggest Strip", Wave 2) — machine
	// moved whole into StripController (ADR-0020 D1); the shell keeps the
	// ladder rung, the lock gate, and the IME state. ──
	/** IME composition state — suggest keys pass through while composing
	 *  (BC-8); composition input events skip the debounce too. */
	let isComposing = $state(false);

	// ── Command help card (command-help, 2026-08-30) — machine moved whole
	// into HelpController (ADR-0020 D1); the shell keeps the ladder rung. ──
	const help = new HelpController(
		{ getValue: () => value },
		() => slashCatalog
	);

	// ── Prompts Manager (Wave 3, ADR E4): opened from the strip's ⚙ row ──
	let managerOpen = $state(false);
	/** Portal host for the manager modal — appended to document.body so the
	 *  modal's position:fixed escapes the panel floor's CSS zoom (BC-7). */
	let mgrPortal = $state<HTMLDivElement | undefined>();

	$effect(() => {
		if (!mgrPortal) return;
		const el = mgrPortal; // capture: bind:this nulls before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});

	/** Auto-grow clamp: default 15 rows (user spec, 2026-08-23; OCI clamps
	 *  at ~12); operator-tunable via ~/.dsi/settings.yaml
	 *  `chat.input.maxRows` (ADR-0007 access-chip follow-up, 2026-08-25). */
	const MAX_ROWS = $derived(appConfig().chat.input.maxRows);

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	/** Past the row clamp the box scrolls instead of growing. */
	let isOverflow = $state(false);

	/** Trigger active for the current text + caret — value-reactive for the
	 *  strip's visibility; the keydown guard reads the LIVE textarea (the
	 *  controller's liveQuery) so a stale caret can never leak into
	 *  interception. (Declared after textareaEl — derived reads it.) */
	const triggerActive = $derived(
		getTrigger(value, textareaEl?.selectionStart ?? value.length) !== null
	);
	// The strip machine (ADR-0020 D1): constructed after textareaEl — the
	// element reader and the lock gate close over it.
	const strip = new StripController(
		{ getElement: () => textareaEl, getValue: () => value, setValue: (v) => (value = v) },
		{ active: () => triggerActive, locked: () => locked },
		{
			get onrunmacro() {
				return onrunmacro;
			},
			get onrows() {
				return onrows;
			},
			focus: () => textareaEl?.focus()
		}
	);
	// The controller's $effect.root outlives nothing: stop its effects at
	// unmount (panel close, /new remount, HMR strike).
	onDestroy(() => strip.destroy());

	// ── Slash Menu state (ADR "The Slash Menu", 2026-08-30) — machine moved
	// whole into SlashController (ADR-0020 D1); the shell keeps the ladder
	// rung, the cross-surface gates, and the catalog bridge effect. ──
	/** The pre-move pickInsert re-focus: queued microtask, caret to the
	 *  draft's end + focus (a gone composer owns no caret — the == null
	 *  guard rides the microtask). */
	const focusInsert = () =>
		queueMicrotask(() => {
			const el = textareaEl;
			if (el == null) return;
			el.selectionStart = value.length;
			el.selectionEnd = value.length;
			el.focus();
		});
	const slash = new SlashController(
		{ getValue: () => value, setValue: (v) => (value = v) },
		() => slashCatalog,
		{ stripTriggerActive: () => triggerActive, helpVisible: () => help.visible, helpShape: () => help.shape },
		{
			// live getters — the pre-move shell read the PROPS at call time,
			// so a late-arriving callback must be honored (and the BC-A3
			// undefined check inside the controller stays honest).
			get onpickcommand() {
				return onpickcommand;
			},
			get onpickcommandwithhint() {
				return onpickcommandwithhint;
			},
			get onpickskill() {
				return onpickskill;
			},
			focusInsert,
			focusExecute: () => textareaEl?.focus()
		}
	);
	// Catalog bridge (props-only contract): while the menu is open-shaped —
	// or a `?`-shaped draft asks about the host vocabulary — every query
	// move asks the panel to re-read directoryFor — a cached read is a
	// no-op map lookup; the first read (or a post-failure read) starts the
	// single-flight fetch. Never fires closed: a panel that never opens
	// the menu (and never asks a host `?`) wakes nothing (ADR §3.3, cold
	// sessions stay cold — an explicit `?` about a command IS the ask).
	$effect(() => {
		if (!slash.open && !help.shape) return;
		void slash.draft; // re-query per keystroke, not only on the open edge
		onslashopen?.();
	});

	// Panel row mirror (Prompt Macro W2 2.2) and the lock-clears-strip
	// effect moved INTO the controller (ADR-0020 D1) — driven by the gates
	// and the onrows callback injected above.
	// Config load: singleton GET /api/config — every mount may kick it, the
	// store dedupes to one fetch per page load. SSR-safe (onMount is a no-op
	// server-side); failures keep the default inside the store.
	onMount(() => {
		void loadAppConfig();
		// Swap-focus (2026-08-29): the textarea exists by onMount (bind:this
		// runs first); the mount lock is never held (sending/awaiting start
		// false), so the element accepts the caret.
		if (focusOnMount) {
			textareaEl?.focus();
			onfocused?.();
		}
		// Draft restore: the caret lands at the end of the restored text,
		// and a snapshot saved mid-typing takes the caret back — an HMR
		// strike or reload mid-sentence resumes where the keys stopped.
		// The swap-focus contract above stays the only onfocused fire.
		if (restoredDraft !== null) {
			queueMicrotask(() => {
				const el = textareaEl;
				// An unmount inside this microtask window nulls bind:this —
				// a gone composer owns no caret.
				if (el == null) return;
				el.selectionStart = value.length;
				el.selectionEnd = value.length;
				if (restoredDraft.focused) el.focus();
			});
		}
	});

	$effect(() => {
		void value; // re-run when text changes
		if (!textareaEl) return;
		// px() guards parseFloat: unresolved styles ("normal", "") yield NaN,
		// and a NaN maxHeight silently voids the height assignment (browsers
		// and happy-dom's CSSOM both reject "NaNpx" without error).
		const px = (v: string, fallback: number): number => {
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : fallback;
		};
		const style = getComputedStyle(textareaEl);
		// Fallbacks match the classes: text-sm × leading-relaxed, py-2.
		const lineHeight = px(style.lineHeight, 22.75);
		const maxHeight = Math.round(MAX_ROWS * lineHeight + px(style.paddingTop, 8) + px(style.paddingBottom, 8));
		textareaEl.style.height = 'auto';
		const fits = Math.min(textareaEl.scrollHeight, maxHeight);
		textareaEl.style.height = `${fits}px`;
		isOverflow = textareaEl.scrollHeight > maxHeight;
	});

	// Strip accept/close/cycle/rename/delete and the lock-clears-strip
	// effect moved INTO StripController (ADR-0020 D1); sync delegates below
	// forward into it.

	async function submit(): Promise<boolean> {
		if (isStreaming || locked) return false;
		if (help.handles()) return false; // a `?` help line is a question, never a send
		// A run-shaped draft is macro traffic, never a send (Prompt Sync
		// amendment 2026-09-04): the strip's run accept is a `!` line's
		// only executor — the line itself must not ride the wire as a
		// prompt, broadcast or typed. Find-shape (`?`) keeps its pinned
		// fall-through: an unmatched finder question ships as chat.
		const draftShape = getTrigger(value, value.length);
		if (draftShape !== null && triggerMode(draftShape) === 'run') return false;
		const text = value.trim();
		if (text.length === 0 && drafts.length === 0) return false;
		const imageIds = drafts.map((draft) => draft.id);
		value = '';
		awaiting = true;
		try {
			// The ONLY base64 moment (BC-A2): drafts serialize at submit and
			// ride the widened callback; the panel POSTs them (task 2.4).
			const images = imageIds.length > 0 ? ((await attachmentMgr?.serialize(imageIds)) ?? []) : [];
			const admitted = await onsubmit(text, images);
			// Admitted send OR completed command dispatch (the panel
			// intercepts commands and returns true — BC-A7 clears them
			// too). An explicit false keeps the attachments (BC-A3) AND
			// restores the line: a rejected send or a command-rung miss
			// leaves the operator's text in the composer — never in the
			// void behind an honest banner (Slash Menu ADR §4.3/§5).
			if (admitted !== false) {
				attachmentMgr?.clear();
			} else if (value === '') {
				value = text;
			}
			return admitted !== false;
		} finally {
			awaiting = false;
		}
	}

	// Membership (ADR D1/D2): the composer joins the sync store keyed by
	// its session; the disposer rides the effect cleanup — unmount (panel
	// close, /new remount) unregisters. The broadcast hands (amended
	// 2026-09-04) are one-line forwards into the surface controllers
	// (ADR-0020 D3): cycle/accept/dismiss minus the focus steal — the
	// box drives the accept from the sidebar, the panel never steals
	// the caret.
	$effect(() => {
		if (sessionId === undefined) return;
		return registerSyncMember(sessionId, {
			getText: () => value,
			setText: (text: string) => {
				value = text;
			},
			// ADR D5: the SAME submit ladder — the boolean the broadcast
			// pass counts; a refusal keeps the mirrored draft and lands
			// the panel in `kept`.
			submit: () => submit(),
			syncStripState: () =>
				strip.rows.length > 0
					? { rows: strip.rows, index: strip.index, query: strip.query, mode: strip.liveMode() }
					: null,
			syncCycleStrip: (delta) => strip.cycle(delta),
			syncAcceptStrip: () => strip.accept(strip.index, false),
			syncDismissStrip: () => strip.close(false),
			syncSlashState: () =>
				slash.open
					? {
							gestures: MENU_GESTURES,
							commands: slashCatalog?.commands ?? [],
							skills: slashCatalog?.skills ?? [],
							state: slashCatalog?.state ?? 'idle',
							query: slash.draft,
							index: slash.index
						}
					: null,
			syncCycleSlash: (delta) => slash.cycle(delta),
			syncDismissSlash: () => slash.memoize(), // the menu's own Esc
			syncAcceptSlashInsert: (text) => slash.pickInsert(text, undefined, false),
			syncAcceptSlashExecute: (name) => slash.pickExecute(name, false)
		});
	});

	// Mirror (ADR D3/D4; D4 as amended 2026-09-04): once the broadcast has
	// claimed this panel — the box held text at check time, or a non-empty
	// push landed while checked — the draft mirrors the shared text
	// verbatim, '' included, so clearing the box clears the panel. Before
	// the claim the store's verdict is `undefined` (a check never wipes),
	// and the write is skipped when the verdict repeats: an unrelated
	// membership transition re-runs this effect and must not echo the box
	// over a panel-local edit (D3).
	let lastMirrored: string | undefined;
	$effect(() => {
		if (sessionId === undefined) return;
		const text = mirrorTextFor(sessionId);
		if (text === undefined) {
			lastMirrored = undefined; // the claim ended — a new claim overwrites
			return;
		}
		if (text === lastMirrored) return;
		// Land the DOM text BEFORE the state write: the trigger derived
		// snapshots the untracked textarea caret at its eager re-evaluation
		// (selectionStart is not reactive state), and the bind lands the new
		// value only later in the flush — writing state first would cache a
		// trigger verdict computed against the stale caret. The element's
		// value setter rides the caret to the end, the mirrored caret.
		const el = textareaEl;
		if (el !== undefined) el.value = text;
		value = text;
		lastMirrored = text;
		// A mirrored draft wakes the panel's own surfaces like a typed one:
		// the help card and slash menu are value-derived and wake themselves,
		// but the strip's rows ride a fetch that only DOM input events used
		// to schedule. Trigger-shaped mirrored text schedules it too — the
		// 120 ms debounce also lands the bind's DOM value ahead of
		// fetchSuggestions' live read. A locked composer stays strip-free
		// (the lock clears the strip).
		if (!locked && getTrigger(text, text.length) !== null) strip.schedule();
	});

	/** Paste forwarding: image clipboard items become drafts; text stays text. */
	function handlePaste(event: ClipboardEvent): void {
		attachmentMgr?.handlePaste(event);
	}

	/** Draft input: the strip's debounce PLUS the slash-menu dismiss
	 *  unlock (the strip's rule — a longer draft is fresh intent, so a
	 *  memo-closed menu re-arms as the operator keeps typing). The draft
	 *  is read from the live element: bind:value ordering vs this handler
	 *  is not relied on (the file's live-read convention). */
	function handleInput(): void {
		const draft = (textareaEl?.value ?? value).trim();
		slash.noteInput();
		strip.schedule();
	}

	/** Blur = the operator looked away: flush immediately with
	 *  focused=false so a stale focused=true snapshot can never make an
	 *  unrelated composer steal the caret on the next restore. */
	function handleBlur(): void {
		textareaFocused = false;
		if (sessionId === undefined) return;
		draftPersistence.flush(sessionId, value, false);
	}

	// The keyboard priority ladder moved whole into KeyboardRouter
	// (ADR-0020 D2 as amended 2026-10-10): a NEUTRAL party owning no
	// surface — the shell still constructs it with the controllers, the
	// IME gate, and the submit ladder, so the precedence stays a
	// contract between equals and the shell remains the wiring point.
	const keyboard = new KeyboardRouter({
		strip,
		slash,
		help,
		isComposing: () => isComposing,
		submit
	});
	/** Keydown forwarding — the ladder lives in the router. */
	function onkeydown(event: KeyboardEvent): void {
		void keyboard.onKey(event);
	}
</script>

<div class="flex flex-col gap-1.5" data-testid="prompt-input">
	<!-- OCI AttachmentChips placement: the pending-file row sits ABOVE the
	     input row — attachments are about the message being composed. -->
	<AttachmentChips {drafts} onremove={(id) => attachmentMgr?.removeAttachment(id)} />

	<div class="flex items-end gap-2">
		<!-- Prompt Sync checkmark column (ADR D8, 2026-09-04): the left
		     flank mirrors the right — the membership toggle stacked ABOVE
		     the paperclip button, bottom-aligned by the row's items-end.
		     Unchecked is the AttachmentManager ghost grammar; checked is
		     the app's yellowgreen selected state (the .on scoped rule). -->
		<div class="flex shrink-0 flex-col items-center gap-1">
			{#if sessionId !== undefined}
				<button
					type="button"
					data-testid="prompt-sync-check"
					aria-pressed={syncChecked}
					title={t(m.syncComposer)}
					class="prompt-sync-check flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
					class:on={syncChecked}
					disabled={lens}
					onclick={() => setSyncChecked(sessionId, !syncChecked)}
				>
					{#if syncChecked}
						<SquareCheck size={16} />
					{:else}
						<Square size={16} />
					{/if}
				</button>
			{/if}
			<AttachmentManager bind:this={attachmentMgr} bind:drafts disabled={locked} limits={imageLimits ?? DEFAULT_IMAGE_LIMITS} />
		</div>
		<!-- OCI textarea-wrap pattern: the relative wrapper anchors the
		     streaming dots overlay (right edge, vertically centered on the
		     Send/Cancel button — the row is items-end, so the anchor holds
		     while the textarea auto-grows). -->
		<div class="relative flex-1">
			<!-- Command help card (command-help, 2026-08-30): floating above
			     the textarea wrapper, same geometry as the strip — shows the
			     draft's usage while it asks `?` (a DSI gesture from the
			     COMMAND_HELP copy, or a host command/skill from the cached
			     catalog row's own wire copy). Mutually exclusive with the
			     strip by construction (`?`/`!` lead vs a `/`- or
			     `@token ?`-shaped draft). -->
			{#if help.visible && help.view !== null}
				<CommandHelpCard view={help.view} />
			{/if}
			<!-- Slash Menu (ADR "The Slash Menu", 2026-08-30): the composer's
			     THIRD floating surface — same geometry as strip/help card
			     (absolute above the wrapper, never joins layout); mutually
			     exclusive with both by trigger construction. Presentational
			     rows only: catalog state rides props from the panel, the
			     keyboard lifecycle is the row-gated onkeydown guard above. -->
			{#if slash.open}
				<SlashMenu
					gestures={MENU_GESTURES}
					commands={slashCatalog?.commands ?? []}
					skills={slashCatalog?.skills ?? []}
					state={slashCatalog?.state ?? 'idle'}
					query={slash.draft}
					activeIndex={slash.index}
					onpickgesture={(seed) => slash.pickInsert(seed)}
					onpickcommand={(name) => void slash.pickExecute(name)}
					onpickcommandwithhint={(name) =>
						slash.pickInsert(`/${name} `, () => onpickcommandwithhint?.(name))}
					onpickskill={(name) => slash.pickInsert(`/${name} `, () => onpickskill?.(name))}
				/>
			{/if}
			<!-- Suggest Strip (ADR "The Suggest Strip", W2): floating above the
			     textarea wrapper — never joins layout (BC-1). Renders nothing
			     while no rows (component-level {#if}). -->
			<SuggestStrip
				rows={strip.rows}
				activeIndex={strip.index}
				query={strip.query}
				mode={strip.liveMode()}
				onpick={(i) => strip.accept(i)}
				// ⏯ Step starts the run too (held) — same composer hygiene as
				// run-accept: strip closes, draft clears, focus returns.
				onstep={
					onstep === undefined
						? undefined
						: (i: number) => {
								value = '';
								strip.forgetRows();
								textareaEl?.focus();
								onstep(i);
							}
				}
				onrename={(row, fields) => strip.rename(row, fields)}
				ondelete={(row) => strip.remove(row)}
				onmanage={() => {
					managerOpen = true;
					textareaEl?.focus();
				}}
				onclose={() => textareaEl?.focus()}
				// Tag-chip toggle: focus returns to the textarea so the
				// strip's keyboard navigation never parks on a checkbox.
				onrefocus={() => textareaEl?.focus()}
			/>
			<!-- PromptInputText — the composer textarea. display:block keeps
			     this wrapper collapsed onto the box (2026-08-24 alignment
			     fix — the geometry note lives in the component). The element
			     and the draft bind back: focus, autosize, selection and the
			     draft flushes stay the owner's. -->
			<PromptInputText
				bind:el={textareaEl}
				bind:value
				maxRows={MAX_ROWS}
				{isStreaming}
				{locked}
				{awaiting}
				{isOverflow}
				onkeydown={onkeydown}
				onpaste={handlePaste}
				oninput={handleInput}
				onfocus={() => (textareaFocused = true)}
				onblur={handleBlur}
				oncompositionstart={() => (isComposing = true)}
				oncompositionend={() => {
					isComposing = false;
					strip.schedule(); // the composed text is final — search it
				}}
			/>
			{#if isStreaming || awaiting}
				<StreamingIndicator title={isStreaming ? 'Turn in flight…' : 'Sending…'} />
			{/if}
		</div>

		<!-- Right-flank column (2026-09): the stick toggle moved to the
		     panel's floating mount; this column keeps the Send/Cancel face
		     bottom-aligned (items-end). -->
		<div class="flex shrink-0 flex-col items-center justify-end gap-1">
		{#if isStreaming}
			<!-- OCI cancel-btn parity: 2rem red square, filled Square icon,
			     hover darkens + scales 1.05, disabled at 0.3 opacity. -->
			<button
				type="button"
				onclick={() => void oncancel()}
				data-testid="cancel-button"
				class="cancel-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-status-fail text-status-fail-ink transition-[background-color,transform] hover:bg-status-fail hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
				disabled={locked}
				title={t(m.stopStreaming)}
				aria-label={t(m.stopStreaming)}
			>
				<Square size={14} fill="currentColor" />
			</button>
		{:else}
			<!-- OCI send-btn parity: 2rem blue square, ArrowUp icon, hover
			     darkens; disabled at 0.3 opacity (empty/locked states). -->
			<button
				type="button"
				onclick={() => void submit()}
				disabled={disabled}
				data-testid="send-button"
				class="send-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-blue text-white transition-colors hover:bg-accent-blue disabled:cursor-not-allowed disabled:opacity-30"
				title={t(m.sendMessage)}
				aria-label={t(m.sendMessage)}
			>
				<ArrowUp size={18} />
			</button>
		{/if}
		</div>
	</div>

	{#if sessionId !== undefined || contextTokens !== undefined || (permission !== null && permission !== undefined && onpermission !== undefined)}
		<!-- OCI ChatInput info-row pattern: token + access (left) · model
		     (center) · context (right). justify-between keeps the selector
		     truly centered between flanks of unequal width. -->
		<div class="flex items-center justify-between gap-2 px-1" data-testid="prompt-info-row">
			<span class="flex min-w-0 items-center gap-2">
				<TokenCounter text={value} />
				{#if permission !== null && permission !== undefined && onpermission !== undefined}
					<!-- DSH parity (2026-08-28 bug fix): a RUNNING turn never locks
					     the chip — the pick rides the host-side /permission command
					     wire and never touches the model or the turn (DSH's
					     PermissionRow gates only its own load/save lifecycle). Only
					     the brief submit window (`locked`) keeps the footer's
					     uniform lock. -->
					<AccessModeChip {permission} disabled={locked} onpick={onpermission} />
				{/if}
			</span>
			{#if sessionId !== undefined}
				<ModelSelector {sessionId} menuUp disabled={locked} />
			{/if}
			<ContextConsumption used={contextTokens} limit={totalContextLimit} />
		</div>
	{/if}

	{#if managerOpen}
		<!-- Prompts Manager host (Wave 3, BC-7): the host div portals to
		     document.body — the modal's position:fixed escapes the panel
		     floor's CSS zoom. The strip refreshes nothing eagerly on change;
		     it refetches on the next trigger. -->
		<div bind:this={mgrPortal}>
			<PromptsManagerDialog
				onclose={() => {
					managerOpen = false;
				}}
				onchanged={() => {
					/* strip refetches on next trigger — nothing eager */
				}}
			/>
		</div>
	{/if}
</div>

<style>
	/* Control-owned icon color (app.css icon standard exception): the
	   send/cancel surfaces are saturated (blue/red) with white glyphs —
	   the global purple icon default must not paint the icon into its
	   own button surface. */
	.cancel-btn :global(svg),
	.send-btn :global(svg) {
		color: inherit;
	}

	/* Prompt Sync checkmark (ADR D8): unchecked keeps the ghost grammar
	   (the utility classes); checked is the segmented-toggle's selected
	   state — yellowgreen glyph, unlayered rule beats the utility color. */
	.prompt-sync-check :global(svg) {
		color: inherit;
	}
	.prompt-sync-check.on {
		color: yellowgreen;
	}
	.prompt-sync-check.on:hover {
		color: color-mix(in srgb, yellowgreen 70%, black);
		background-color: color-mix(in srgb, var(--color-status-pass) 12%, var(--color-surface-elevated));
	}
</style>
