# Design — PanelListboxFilter UX amendment (operator feedback, 2026-11-18)

Small change. Feedback arrived live during R9 Wave 4 on the freshly re-pointed shelf/spine headers.

## Intent and why
The filter organ shipped transparent on DSI and sat in the icon cluster instead of owning the row's free width. Both read as broken to the operator — a filter field you can't see and can't find is dead DX.

## Feedback (operator, verbatim intent)
1. The input becomes transparent — bad DX.
2. It aligns with the icons; expected: aligned with the title, occupying the empty space. Clarified: the input owns the row's free width = title and search share ONE container; the NEXT container holds the icons/pills.

## Approaches considered
- Anatomy: A (picked) — grow the organ: PanelListboxHeader gains an optional search snippet rendered inside .lb-title after the label; .lb-title stays flex:1 so the input owns the free width. Shelf + spine headers move the filter from trailing to search; pills/icons stay trailing. One grammar change, every future consumer inherits it. B (consumer CSS override) rejected: fights scoped styles, next consumer copies the hack.
- Paint: A (picked) — inline neutral fallbacks on every filter token var(--panel-listbox-filter-*, neutral) so any consumer renders a sane field without loading tokens.css. B (consumers must declare tokens) rejected: every fresh consumer starts transparent — the exact trap hit. Per-surface voicing stays available.

## Constraints
- ADR-0071 D6 testids unchanged (sidebar-scheduler-filter, sidebar-spine-filter).
- No match logic in the base; no consumer color names in the base (fallbacks are neutral grays/navy, the R8 D5 voice).
- Reading order stays chevron -> title -> search -> pills -> date -> view.

## Left to the builder
- Pin the search slot + fallbacks in the organ vitest suite; README anatomy rows updated; scoped suites re-run.
