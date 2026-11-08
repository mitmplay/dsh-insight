/**
 * Test helper: a $state-wrapped DsiPermission the test can mutate in place,
 * so the chip's poll-fold confirm $effect fires MID-MOUNT (the remount-style
 * suites in access-mode-chip.test.ts can never reach that arm).
 */
import { localPermission, type DsiPermission } from '$lib/services/conversation/permission-state';

export function makePerm(current: string): DsiPermission {
	const perm = $state({ ...localPermission(), current });
	return perm;
}
