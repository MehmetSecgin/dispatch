# Agent Job Authoring Bootstrap

Use this snippet in consumer-repo agent instructions such as `CLAUDE.md` when
that repo expects agents to write dispatch job files.

The goal is to make the CLI-first job-authoring workflow visible at task start,
instead of relying on agents to discover it by reading source code or existing
jobs first.

## Copy-Paste Bootstrap

```md
## Writing jobs with dispatch

When a task is to create or repair a dispatch job:

1. Start with `dispatch module list` to inventory available modules.
2. Discover built-in capabilities before choosing actions:
   - `dispatch module inspect flow` — lists orchestration actions (sleep, poll, etc.)
   - `dispatch module inspect memory` — lists durable-state actions (recall, store, etc.)
   These tell you what dispatch can do natively. Do not skip them.
3. Once you know which actions you need, inspect each contract:
   - `dispatch schema action --name <module.action> --print`
4. Read nearby job files only after CLI discovery, to learn local conventions.
5. Validate before handoff:
   - `dispatch job validate --case <path>`

Use source-reading and existing jobs to learn local patterns, but do not use
them as the primary way to discover what dispatch can do.
```

## Notes

- `flow` is the built-in orchestration module. Inspect it before writing
  sleeps, polling, or manual retry ladders.
- `memory` is the built-in durable-state module. Inspect it before using
  cross-run state.
- Existing jobs are best for local conventions such as `http`, credentials,
  dependencies, and metadata shape.
- Action schemas are the authoritative source for payload fields, exports, and
  credential requirements.
