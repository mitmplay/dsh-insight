// The Three-State Lamp — DSI's consumer seam onto the base (ADR-0063 D2).
// The MECHANISM (choice store, OS resolution, html[data-theme] hinge,
// profile-scoped key grammar, pre-paint applier) lives in
// @deepseek-insight/container-base/src/theming/ — DSI contributes only its
// identity: the storage base key 'dsi-theme'. Public API is unchanged from
// the hand-rolled module this replaces (ADR-0023 consumers keep working).

import { createThemePrefs } from '@deepseek-insight/container-base';

export type { ThemeChoice, ResolvedTheme } from '@deepseek-insight/container-base';

export const THEME_BASE_KEY = 'dsi-theme';

export const themePrefs = createThemePrefs({ baseKey: THEME_BASE_KEY });
