# ADR-007: Atlassian Pragmatic drag-and-drop; accessibility via move-to menus

**Status**: accepted (2026-07-16)

## Context

Drag-and-drop (cross-lane + within-lane reorder) is the UI crux. Candidates: dnd-kit,
@atlaskit/pragmatic-drag-and-drop, @dnd-kit/react.

## Decision

- **@atlaskit/pragmatic-drag-and-drop 2.x** — the engine behind Trello/Jira/Confluence,
  actively maintained (verified July 2026: published 2026-06-17, ~4.5M downloads/month),
  headless, framework-agnostic, built on native HTML5 DnD. Companions: `-hitbox`
  (closest-edge + reorderWithEdge), `-react-drop-indicator`, `-auto-scroll`, `-live-region`.
  Start from Atlassian's published board example.
- dnd-kit classic is in maintenance; **@dnd-kit/react is still 0.5.x beta** — not a mature
  alternative yet. Keep all DnD wiring behind one thin board-level adapter component so a future
  swap stays contained.
- **Accessibility**: Pragmatic DnD deliberately ships no keyboard drag; Atlassian's sanctioned
  pattern is action menus. Every card gets a "Move to…" menu (lane + position) driving the same
  move API, plus live-region announcements. These flows are part of the card's definition of
  done and covered by Playwright — not a fast-follow.

## Consequences

Board wiring costs days rather than hours (headless), accepted for the maintenance pedigree and
exact-fit kanban semantics. The move-to menu doubles as the touch/AT fallback and as the e2e
hook for deterministic reorder tests.
