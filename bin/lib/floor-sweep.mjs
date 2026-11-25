// floor-sweep.mjs — ADR-0082 (The Loud Floor) D3: never kill by name while
// the parent lives. The old killOrphans pkilled by command-line pattern —
// able to kill a FOREIGN live floor (the exact co-tenant shape that started
// this whole ADR). The replacement enumerates the same ORPHAN_PATTERNS
// candidates from one ps snapshot, keeps ONLY processes whose parent pid is
// dead (a true orphan — a pair whose parent died before it could tear down
// its sibling), and SIGTERMs by pid with a per-pid receipt. Port-held
// survivors are NOT swept here: they belong to the existing takeover path
// (takeoverFloorPorts / freeFloorPorts, the click-is-consent rule) — the
// caller delegates them so a held port still exits 64 naming holder and port.
//
// Pure decision layer with injectable edges; dsi.mjs supplies the real ps.

/** @typedef {{ pid: number, ppid: number, command: string }} ProcRow */

/**
 * Parse 'ps -eo pid=,ppid=,command=' output into rows.
 * @param {string} [output]
 * @returns {ProcRow[]}
 */
export function parseProcs(output) {
	return (output || '').split('\n').flatMap((line) => {
		if (!line.trim()) return [];
		const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3].trim() }] : [];
	});
}

/**
 * The orphan set: command matches a pattern AND its parent pid is not in
 * the snapshot's pid set (dead parent). Never returns the caller itself.
 * @param {ProcRow[]} rows
 * @param {{ patterns: string[], selfPid?: number }} opts
 * @returns {ProcRow[]}
 */
export function selectOrphans(rows, { patterns, selfPid = process.pid }) {
	const alivePids = new Set(rows.map((r) => r.pid));
	const regexes = patterns.flatMap((p) => { try { return [new RegExp(p)]; } catch { return []; } });
	return rows.filter((r) =>
		r.pid !== selfPid &&
		!alivePids.has(r.ppid) &&
		regexes.some((re) => re.test(r.command))
	);
}

/**
 * The scoped sweep. Returns { swept: [{ pid, command }], skipped }.
 * @param {{ patterns?: string[], selfPid?: number, listProcs?: () => string, terminate?: (pid: number, signal: NodeJS.Signals) => void, log?: (line: string) => void, freePorts?: () => number[] | undefined }} [opts]
 * @returns {{ swept: { pid: number, command: string }[], skipped: boolean, ports: number[] | undefined }}
 */
export function sweepOrphans({
	patterns,
	selfPid = process.pid,
	listProcs,
	terminate,
	log = (line) => console.log(line),
	freePorts
} = {}) {
	if (typeof listProcs !== 'function') throw new Error('sweepOrphans: listProcs is required');
	if (!Array.isArray(patterns)) throw new Error('sweepOrphans: patterns is required');
	const rows = parseProcs(listProcs());
	const orphans = selectOrphans(rows, { patterns, selfPid });
	for (const orphan of orphans) {
		log('dsi dsh: orphan swept (pid ' + orphan.pid + ', ' + orphan.command.slice(0, 120) + ')');
		try { terminate?.(orphan.pid, 'SIGTERM'); } catch { /* already gone */ }
	}
	// Port-held survivors are the takeover path's business, not the sweep's:
	// the caller injects freePorts so a held port still exits 64 through the
	// existing receipt (freeFloorPorts — reused, never re-implemented).
	const ports = typeof freePorts === 'function' ? freePorts() : undefined;
	return { swept: orphans.map(({ pid, command }) => ({ pid, command })), skipped: false, ports };
}
