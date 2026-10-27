<script lang="ts">
	/**
	 * WorkspaceFilePanel — the workspace-file kind's SINGLE floor content
	 * (Workspace Explorer W4 task 4.1, ADR D2): one LIVE workspace file,
	 * fetched once on mount over GET /api/dsh/workspace-file (BC-1: host
	 * bytes ONLY through the HTTP route). Markdown renders preview/edit
	 * tabs (ephemeral $state — the tab choice is not persisted); every
	 * other extension opens the Monaco edit surface directly, reached ONLY
	 * through the dynamic-import glue (the chunk gate). The edit buffer is
	 * a working copy: a dirty edit dies on reload BY DESIGN, surfaced by a
	 * visible dirty indicator — never silently. The file NAME and the
	 * full-path copy live in PanelColumn's PanelHeader (the column's
	 * copy-id prefix button copies the composed path) — not here.
	 *
	 * Save (The File Eye ADR 2026-09-12, D4 — superseding the delegated
	 * save): pressing Save POSTs the buffer to /api/workspace/file-write;
	 * the DSI server writes the bytes itself, gated on the desk's fresh
	 * access mode. The written receipt clears dirty — proof of bytes, not
	 * acceptance.
	 *
	 * Refusals render the mapped failure line (never blank): not-found,
	 * outside-workspace, too-large, not-text, not-regular-file.
	 */
		import { appConfig } from '$lib/services/config/app-config.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import WorkspaceFile from './WorkspaceFile.svelte';
	import type { YamlEditorHandle } from '../monaco/settings-monaco';
	// The File Eye (ADR D2): the diff factory rides the SAME lazy chunk —
	// the chunk gate stays a single dynamic import point.

	/** The read receipt (api/dsh/workspace-file body, DshWorkspaceFileText). */
	interface FileRead {
		text: string;
		eof: boolean;
		path?: string;
		error?: { code: string; message: string };
	}

	let {
		sessionId,
		path,
		root,
		view = 'edit',
		onviewchange,
		onclose,
		highlightLines = null,
		onhighlightdone
	}: {
		/** The owning session — the read's authorization scope (dedupe key
		 *  half; the panel never mutates it). */
		sessionId: string;
		/** Root-relative file path — the other dedupe-key half and the
		 *  fetch query. */
		path: string;
		/** The explorer's workspace root — composes the copy fallback. */
		root: string;
		/** The OWNER's persisted view — the live authority (the explorer-tab
		 *  pattern, commit 43cd90f): first paint reads it directly. */
		view?: 'edit' | 'diff';
		/** View intent — the owner persists it on the panel entry. */
		onviewchange?: (view: 'edit' | 'diff') => void;
		/** Close intent — the owner removes the panel. */
		onclose: () => void;
		/** The file-link #L anchor target (transient, not persisted) — once
		 *  the edit surface is live it scrolls to and highlights the range,
		 *  then reports `onhighlightdone` exactly once. */
		highlightLines?: { start: number; end: number } | null;
		/** Acknowledge the applied highlight — the owner clears its parked
		 *  target so a plain re-activation never re-highlights. */
		onhighlightdone?: () => void;
	} = $props();

	// The owner prop is the LIVE authority; the override exists only to
	// bridge the instant between a toggle click and the owner round-trip,
	// and dissolves once the prop catches up (no first-paint flash).
	let viewOverride = $state<'edit' | 'diff' | null>(null);
	const activeView = $derived(viewOverride ?? view);

	let tab = $state<'preview' | 'edit'>('preview');
	// A #L anchor needs the Monaco surface — line coordinates don't exist
	// in the markdown preview. Force the edit tab for this open; the
	// operator can still flip back to preview afterwards.
	$effect(() => {
		if (highlightLines !== null && hasTabs) tab = 'edit';
	});
	let phase = $state<'loading' | 'failed' | 'ready'>('loading');
	let errorCode = $state<string | null>(null);
	let text = $state<string | null>(null);
	let eof = $state(true);
	/** The content the dirty flag compares against — the fetched text,
	 *  advanced to the buffer on a save receipt (ADR D4). */
	let baseline = $state<string | null>(null);
	/** Dirty = the edit buffer differs from the baseline. */
	let dirty = $state(false);
	/** The delegated save's progress (ADR D4): idle → saving → saved /
	 *  failed; a further edit re-arms the button from any state. */
	let saveState = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle');
	let saveError = $state<string | null>(null);
	/** Index Pulse: an external change landed on disk while a draft exists
	 *  in the buffer — surfaced as a visible note; the draft is kept. */
	let fileStale = $state(false);

	// The File Eye (ADR D1/D3): the desk gate and the file's changed flag,
	// resolved once per mount over the SAME gated status channel the
	// explorer uses. null = unresolved (the UI stays plain meanwhile).
	let gateOpen = $state<boolean | null>(null);
	let changed = $state(false);
	/** HEAD "before" text — null until the diff fetch answers; the
	 *  absent-before case (untracked/new) normalizes to '' so the diff
	 *  still mounts (empty original, Shared Tree amendment 2026-09-16),
	 *  with `noHead` flagging the caption above the surface. */
	let headText = $state<string | null>(null);
	let headFetched = $state(false);
	let noHead = $state(false);
	let diffHost = $state<HTMLElement | null>(null);
	let diffHandle: { dispose(): void } | null = null;

	/** Toggle intent: bridge the click, then hand the choice to the owner. */
	function setView(next: 'edit' | 'diff'): void {
		viewOverride = next;
		onviewchange?.(next);
	}

	let editorHost = $state<HTMLElement | null>(null);
	let editor: YamlEditorHandle | null = null;
	/** Reactive mirror of `editor` (the handle itself stays a plain let —
	 *  the Monaco glue is not serializable state): the #L anchor highlight
	 *  effect needs a signal that flips when the editor lands/dies. */
	let editorReady = $state(false);
	let initSeq = 0;

	const isMarkdown = $derived(path.toLowerCase().endsWith('.md'));
	/** HTML documents preview like markdown (two tabs): the preview tab
	 *  mounts a SANDBOXED iframe (srcdoc, no scripts — a read-only render
	 *  of the fetched source); the edit tab is the same Monaco surface as
	 *  every text file (2026-09-10). */
	const isHtml = $derived(/\.html?$/.test(path.toLowerCase()));
	const hasTabs = $derived(isMarkdown || isHtml);
	/** Image extensions preview through /api/dsh/workspace-file-bytes with
	 *  an <img> element — READ-ONLY by nature (no tabs, no edit buffer). The
	 *  route reads the workspace filesystem directly, contained to `root` —
	 *  no RPC hop; a local read never needed one (2026-09-28). */
	const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
	const isImage = $derived(IMAGE_EXT.includes(path.split('.').pop()?.toLowerCase() ?? ''));
	const bytesSrc = $derived(
		'/api/dsh/workspace-file-bytes?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(path)
	);
	/** Extension → Monaco language id for the edit surface's tokenizer
	 *  highlighting. The grammars are already inside the lazy Monaco chunk
	 *  (basic-languages), so this costs nothing at first paint. `.svelte` and
	 *  `.vue` have NO built-in grammar — they fall back to `html`, whose
	 *  Monarch tokenizer colors the markup and the embedded script/style
	 *  blocks (documented approximation, 2026-09-10). */
	const MONACO_LANG: Readonly<Record<string, string>> = {
		bash: 'shell', c: 'c', cc: 'cpp', clj: 'clojure', cljs: 'clojure',
		cmake: 'cmake', cmd: 'shell', cpp: 'cpp', cs: 'csharp', css: 'css',
		cxx: 'cpp', dart: 'dart', dockerfile: 'dockerfile', ex: 'elixir',
		exs: 'elixir', fish: 'shell', go: 'go', gql: 'graphql', graphql: 'graphql',
		h: 'c', hpp: 'cpp', hs: 'haskell', htm: 'html', html: 'html', ini: 'ini',
		java: 'java', js: 'javascript', json: 'json', jsx: 'javascript',
		kt: 'kotlin', less: 'less', lua: 'lua', mjs: 'javascript',
		mk: 'makefile', mm: 'objective-c', php: 'php', pl: 'perl', proto: 'protobuf',
		ps1: 'powershell', py: 'python', rb: 'ruby', rs: 'rust', sass: 'scss',
		scala: 'scala', scss: 'scss', sh: 'shell', sol: 'solidity', sql: 'sql',
		svelte: 'html', swift: 'swift', toml: 'ini', ts: 'typescript',
		tsx: 'typescript', vue: 'html', wgsl: 'wgsl', xml: 'xml', yaml: 'yaml',
		yml: 'yaml', zig: 'zig'
	};
	// yaml/yml render as PLAIN TEXT (RCA 2026-09-26): monaco-yaml 5.5.1's
	// worker is protocol-incompatible with both installed monaco majors —
	// opening a yaml model fired doValidation/getFoldingRanges/... against a
	// handler-less worker and spammed uncaught errors on every tab switch.
	const monacoLang = $derived.by(() => {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		if (ext === 'yaml' || ext === 'yml') return 'plaintext';
		return MONACO_LANG[ext] ?? 'plaintext';
	});
	const title = $derived(path.split('/').filter((p) => p.length > 0).pop() ?? path);
	/** The FULL display path (root + relative path) — the toolbar's
	 *  left-side readout (the SettingsHomeToolbar pattern), with the
	 *  same tilde discipline: the operator's home directory collapses
	 *  to `~` before anything hits the screen. The homedir is derived
	 *  from the config store's server homedir truth (the settingsHomes
	 *  roots, The Settings Tree ADR D2) — never guessed client-side. */
	const fullPath = $derived.by(() => {
		const full = root.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
		const dsi = appConfig().settingsHomes.dsi;
		const marker = dsi.lastIndexOf('/.dsi');
		const homeDir = marker > 0 ? dsi.slice(0, marker) : null;
		return homeDir !== null && full.startsWith(homeDir + '/') ? '~' + full.slice(homeDir.length) : full;
	});

	// svelte-ignore state_referenced_locally
	onclose; // referenced for prop completeness; the owner owns removal

	async function fetchFile(): Promise<void> {
		if (isImage) {
			// The <img> element loads the bytes route directly; the text read
			// would refuse a binary workspace-file/not-text.
			phase = 'ready';
			return;
		}
		phase = 'loading';
		try {
			const res = await fetch('/api/dsh/workspace-file?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(path));
			const body = (await res.json()) as {
				ok: boolean;
				file?: { text: string; eof: boolean; absolutePath?: string };
				error?: { code: string };
			};
			if (!body.ok || !body.file) {
				errorCode = body.error?.code ?? String(res.status);
				phase = 'failed';
				return;
			}
			text = body.file.text;
			eof = body.file.eof;
			baseline = body.file.text;
			phase = 'ready';
		} catch {
			errorCode = 'host-unreachable';
			phase = 'failed';
		}
	}

	/** Silent external refetch (Index Pulse): when the buffer holds no
	 *  draft, the fetched text/baseline advance to the disk truth and the
	 *  editor follows; when a draft exists, the panel only raises the
	 *  visible stale note - a draft is never clobbered. */
	async function refreshFile(): Promise<void> {
		if (isImage || phase !== 'ready') return;
		if (dirty) {
			fileStale = true;
			return;
		}
		try {
			const res = await fetch('/api/dsh/workspace-file?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(path));
			const body = (await res.json()) as {
				ok: boolean;
				file?: { text: string; eof: boolean };
				error?: { code: string };
			};
			if (!body.ok || !body.file) return; // keep the last honest content
			if (body.file.text === text) return; // nothing changed on disk
			text = body.file.text;
			eof = body.file.eof;
			baseline = body.file.text;
			fileStale = false;
			editor?.setValue(body.file.text); // clean buffer follows the disk
			diffHandle?.dispose(); // the diff remounts over the new baseline
			diffHandle = null;
		} catch {
			// network hiccup: keep the last honest content
		}
	}

	// Fetch once per FETCH IDENTITY, not once per effect run — the reload
	// story (Karpathy Layer 2.2) stays: a real remount (F5) or a real file
	// switch (the key changes) refetches and disposes the editor exactly
	// once. Measured on the live floor (2026-10-27, headed drag): a floor
	// gutter drag replaced the panel entry objects EVERY animation frame,
	// and this effect re-ran per frame — each run refetched the file and
	// rebuilt the markdown preview (renderMarkdown + mermaid pass, scroll
	// lost). A floor drag may now re-run this effect with IDENTICAL
	// sessionId/path/root values; the key guard makes that a NO-OP — no
	// fetch, no editor dispose, no preview rebuild. ADR-0043's philosophy:
	// the drag paints live; nothing re-derives until (and unless) the file
	// identity actually settles somewhere else.
	let fetchedKey = '';
	const noopCleanup = () => {};
	$effect(() => {
		const key = sessionId + '\u0000' + path + '\u0000' + root;
		if (key === fetchedKey) return noopCleanup;
		fetchedKey = key;
		void fetchFile();
		return () => {
			initSeq++;
			editor?.dispose();
			editor = null;
		};
	});

	// The diff view (ADR D2): entering diff fetches the HEAD blob ONCE
	// (git moves under the panel — Refresh remounts anyway) and mounts the
	// read-only side-by-side DiffEditor over (HEAD, baseline).
	$effect(() => {
		if (activeView !== 'diff' || phase !== 'ready' || headFetched) return;
		headFetched = true;
		void (async () => {
			try {
				const res = await fetch(
					'/api/workspace/git-file-head?sessionId=' + encodeURIComponent(sessionId) +
						'&root=' + encodeURIComponent(root) +
						'&path=' + encodeURIComponent(path)
				);
				const body = (await res.json()) as { ok?: boolean; enabled?: boolean; head?: string | null };
				if (!body.ok || body.enabled !== true) return;
				// An UNTRACKED file answers head null (Shared Tree amendment
				// 2026-09-16): normalize to '' so the diff STILL mounts — empty
				// original beside the live content — with noHead flagging the
				// caption. null itself stays the "answer not in hand" sentinel.
				headText = body.head ?? '';
				noHead = body.head === null;
			} catch {
				noHead = true; // honest degradation
				headText = '';
			}
		})();
	});

	// Mount the DiffEditor once the head answer is in hand; leaving the
	// view (or unmounting) disposes models and editor.
	// The token is a DEDICATED diffSeq (operator bug 2026-09-17,
	// Edit-Diff-Edit-Diff): sharing the panel-wide initSeq let an UNRELATED
	// effect's teardown (the edit editor's) bump the counter after this
	// effect captured its token — the async continuation then bailed and
	// the second diff view rendered empty.
	let diffSeq = 0;
	$effect(() => {
		if (activeView !== 'diff' || phase !== 'ready' || headText === null) return;
		const host = diffHost;
		if (host === null || diffHandle !== null) return;
		// The "to" side is the LIVE buffer (editor value when one exists) -
		// diffing against the stale mount-time baseline showed the old
		// content on both sides (operator bug report 2026-09-13).
		const current = editor !== null ? editor.getValue() : (text ?? '');
		const token = ++diffSeq;
		void (async () => {
			const { createDiffEditor } = await import('../monaco/settings-monaco');
			if (token !== diffSeq || diffHandle !== null) return;
			// Stale-host guard (operator bug 2026-09-17, Edit-Diff-Edit-Diff):
			// a captured host from a PREVIOUS diff entry is detached — reject
			// it; the effect re-runs on the live bind:this element.
			if (!host.isConnected) return;
			// A closed gate means a READ-ONLY file (ADR D4): the editor
			// blocks user edits at the surface itself. An UNTRACKED file
			// (Shared Tree amendment 2026-09-16) reaches here with
			// headText '' — an EMPTY original, so every line reads as added.
			diffHandle = createDiffEditor(host, headText, current, { language: monacoLang });
			diffHost = host;
		})();
		return () => {
			diffSeq++;
			diffHandle?.dispose();
			diffHandle = null;
		};
	});

	/** Heartbeat cadence for deep-path freshness (ADR D4 amendment). */
	const HEARTBEAT_MS = 30_000;

	// The File Eye probe (ADR D1), made LIVE by the Index Pulse (amendment
	// 2026-09-13): one git-map probe resolves the desk gate and this file's
	// enclosing repo; refreshChanged() re-answers "is this file changed"
	// on every ring, on the heartbeat, and after the gate answer - so a
	// commit hides the diff button and an agent's edit reveals it, live.
	let enclosing = $state<{ repo: string; rel: string } | null>(null);

	async function refreshChanged(): Promise<void> {
		const enc = enclosing; // capture: narrowing dies across the await below
		if (gateOpen !== true || enc === null) return;
		try {
			const stRes = await fetch(
				'/api/workspace/git-status?sessionId=' + encodeURIComponent(sessionId) +
					'&root=' + encodeURIComponent(root) +
					'&repo=' + encodeURIComponent(enc.repo)
			);
			const st = (await stRes.json()) as { ok?: boolean; enabled?: boolean; files?: Array<{ path: string }> };
			if (!st.ok || st.enabled !== true) return;
			changed = (st.files ?? []).some((f) => f.path === enc.rel);
		} catch {
			// a failed re-check keeps the last honest answer
		}
	}

	async function refreshHead(): Promise<void> {
		if (!headFetched) return;
		try {
			const res = await fetch(
				'/api/workspace/git-file-head?sessionId=' + encodeURIComponent(sessionId) +
					'&root=' + encodeURIComponent(root) +
					'&path=' + encodeURIComponent(path)
			);
			const body = (await res.json()) as { ok?: boolean; enabled?: boolean; head?: string | null };
			if (!body.ok || body.enabled !== true) return;
			const raw = body.head;
			const next = raw ?? '';
			if (next !== headText) headText = next; // reassign remounts the diff
			noHead = raw === null;
		} catch {
			// keep the last honest before-version
		}
	}

	$effect(() => {
		void (async () => {
			try {
				const mapRes = await fetch(
					'/api/workspace/git-map?sessionId=' + encodeURIComponent(sessionId) + '&dir=' + encodeURIComponent(root)
				);
				const map = (await mapRes.json()) as { ok?: boolean; enabled?: boolean; rootIsRepo?: boolean; repos?: Record<string, boolean> };
				if (!map.ok || map.enabled !== true) {
					gateOpen = false; // final: read-only desk
					return;
				}
				gateOpen = true;
				const parts = path.split('/').filter((pp) => pp.length > 0);
				const rootIsRepo = map.rootIsRepo === true;
				const firstIsRepo = rootIsRepo || (parts.length > 1 && map.repos?.[parts[0]] === true);
				if (!firstIsRepo) return; // unchanged-or-unresolvable: honest no
				enclosing = {
					repo: rootIsRepo ? root : root.replace(/\/+$/, '') + '/' + parts[0],
					rel: rootIsRepo ? parts.join('/') : parts.slice(1).join('/')
				};
				await refreshChanged();
			} catch {
				gateOpen = false; // unreachable gate: honest degradation
			}
		})();
	});

	// Index Pulse wiring: one EventSource per open file panel while the
	// gate is open and the file lives in a repo. A generation ring (a real
	// status change verified server-side) re-answers `changed` and, if the
	// diff was already opened, refreshes the HEAD side. Same resilient
	// pattern as the explorer: errors close only when truly CLOSED; the
	// heartbeat covers deep-path churn the watchers cannot see.
		// Baseline protocol (mirrors the explorer): the FIRST generation on a
		// (re)connect is the current state, not a change - rows were fetched
		// fresh; duplicates are inert. A bump during an outage differs and
		// invalidates exactly once.
		let lastGen: string | null = null;
		$effect(() => {
		if (gateOpen !== true || enclosing === null) return;
		if (typeof EventSource === 'undefined') return; // non-browser env safety
		const params =
			'sessionId=' + encodeURIComponent(sessionId) +
			'&root=' + encodeURIComponent(root) +
			'&repo=' + encodeURIComponent(enclosing.repo);
		const source = new EventSource('/api/workspace/git-events?' + params);
		source.addEventListener('generation', (event) => {
			const generation = (event as MessageEvent).data as string;
			if (lastGen === null) {
				lastGen = generation; // connect baseline
				return;
			}
			if (generation === lastGen) return;
			lastGen = generation;
			void refreshChanged();
			void refreshHead();
			void refreshFile();
		});
		source.addEventListener('enabled', () => source.close());
		source.onerror = () => {
			if (source.readyState === 2) source.close(); // EventSource.CLOSED
		};
		return () => source.close();
	});

	$effect(() => {
		if (gateOpen !== true) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void refreshChanged();
				void refreshHead();
				void refreshFile();
			}
		}, HEARTBEAT_MS);
		return () => clearInterval(timer);
	});

	// The Monaco init (non-md, or the edit tab of an md file): dynamic
	// import ONLY — the editor lands in its own chunk (the chunk gate).
	// The token aborts superseded in-flight imports (tab flips).
	$effect(() => {
		if (phase !== 'ready' || (isMarkdown && tab !== 'edit')) return;
		const host = editorHost;
		const initial = text;
		if (host === null || initial === null || editor !== null) return;
		const token = ++initSeq;
		void (async () => {
			const { createTextEditor } = await import('../monaco/settings-monaco');
			if (token !== initSeq || editor !== null) return;
			editor = createTextEditor(host, initial, () => {
				dirty = editor !== null && editor.getValue() !== baseline;
			}, { language: monacoLang, readOnly: gateOpen === false });
			editorReady = true;
		})();
		return () => {
			initSeq++;
			editor?.dispose();
			editor = null;
			editorReady = false;
			diffHandle?.dispose();
			diffHandle = null;
		};
	});

	// The #L anchor highlight (file-link anchor feature): applies through
	// the handle whenever the target and a live editor coexist — a fresh
	// mount AND an already-open file both land here. Acknowledged exactly
	// once per published target (the owner clears its parked target).
	$effect(() => {
		if (!editorReady || highlightLines === null) return;
		editor?.highlightLines?.(highlightLines);
		onhighlightdone?.();
	});

	/** The DIRECT save (The File Eye ADR D4): POST the buffer to the
	 *  gated write route; the written receipt advances the baseline so
	 *  dirty clears — bytes on disk, not an agent's promise. */
	async function save(): Promise<void> {
		if (gateOpen !== true || saveState === 'saving' || editor === null || !dirty) return;
		saveState = 'saving';
		saveError = null;
		try {
			const res = await fetch('/api/workspace/file-write', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, root, path, content: editor.getValue() })
			});
			const body = (await res.json()) as {
				ok: boolean;
				written?: boolean;
				error?: { code?: string; message?: string };
			};
			if (!body.ok || body.written !== true) {
				saveError = body.error?.message ?? body.error?.code ?? String(res.status);
				saveState = 'failed';
				return;
			}
			baseline = editor.getValue();
			dirty = false;
			fileStale = false;
			saveState = 'saved';
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'network';
			saveState = 'failed';
		}
	}
</script>

<div data-testid="workspace-file-panel" data-file-path={path} class="file-body">
	<!-- The file NAME + the full-path copy live in PanelColumn's PanelHeader
	     (panelHeaderLabel + copyValue threading) — the body toolbar keeps
	     only the dirty flag, the tabs, and the close verb. The view switch
	     itself lives in WorkspaceFile (extracted 2026-09-13) — presentation
	     only; the text state, Monaco lifecycle, and save logic stay here. -->
	<WorkspaceFile
		bind:tab
		{dirty}
		{fullPath}
		{saveState}
		{fileStale}
		staleNote={t(m.fileEyeExternalChange)}
		{hasTabs}
		{activeView}
		showToggle={gateOpen === true && changed}
		diffDisabled={dirty}
		readonly={gateOpen === false}
		onViewChange={setView}
		onSave={save}
		onReload={refreshFile}
		{saveError}
		saveFailedNote={t(m.workspaceFileSaveFailed)}
		loadingNote={t(m.workspaceExplorerLoading)}
		loadFailedNote={t(m.workspaceFileLoadFailed)}
		truncatedNote={t(m.workspaceFileTruncated)}
		newFileNote={t(m.fileEyeNewFile)}
		{phase}
		{errorCode}
		{title}
		{isImage}
		{bytesSrc}
		{isHtml}
		{text}
		{isMarkdown}
		{noHead}
		{eof}
		bind:editorHost
		bind:diffHost
	/>
</div>

<style>
	/* The wrapper is a flex child of PanelColumn's .body (flex column,
	   min-height: 0): WITHOUT flex: 1 it is content-sized, so the old
	   .file-panel height: 100% resolved against nothing and the file
	   body's height collapsed/overscrolled. flex: 1 + min-height: 0
	   hands the column's remaining space to the WorkspaceFile layout. */
	.file-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	/* Monaco decoration class names are GLOBAL (the editor injects them
	   into its own DOM, outside Svelte's scoping) — hence :global. A soft
	   amber band, distinct from Monaco's own current-line highlight. */
	:global(.dsi-line-anchor-highlight) {
		background: color-mix(in srgb, var(--color-status-pending) 22%, transparent);
		outline: 1px solid color-mix(in srgb, var(--color-status-pending) 45%, transparent);
	}
</style>
