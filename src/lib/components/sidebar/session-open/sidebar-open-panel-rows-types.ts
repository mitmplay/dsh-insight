import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
import type { FamilyRenderEntry } from '$lib/services/lineage/lineage';

/** The member shape the host adapts the published rows to (both
 *  kinds — panel and ghost rows carry the same PanelRow payload).
 *  Lives in a .ts module so raw tsc — which resolves *.svelte imports
 *  to a default-only wildcard — can import the named types. */
export type RowsRenderMember = {
	id: string;
	parent: string | null;
	order?: number;
	depth: number;
	row: PanelRow;
};
export type RowsRenderEntry = FamilyRenderEntry<RowsRenderMember, RowsRenderMember>;
