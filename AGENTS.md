# AGENTS.md

## Purpose
Canonical source for `dispatch`.

## Core Rules
- Keep behavior deterministic and explicit.
- Preserve security boundaries and redaction.
- Keep machine output stable (`--json`).

## Validation Before Review
- `npm run check`
- `npm test`
- `npm run build`
