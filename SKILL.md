---
name: dispatch
description: Agent-first job runner for API workflows. Use dispatch to validate and run job cases, inspect run artifacts, manage modules, and operate API workflows deterministically.
---

## Golden Rules

- Always use `--json` when consuming output programmatically
- Validate before run — never skip `dispatch job validate`
- Every run produces an artifact — use it before asking questions
- `next[]` in every JSON response tells you what to do next — follow it

## Preflight

Run before any session:

```bash
dispatch self-check
dispatch doctor
dispatch module list
```

If `self-check` or `doctor` fail, stop and fix before proceeding.

## Default Flow

```bash
dispatch job validate --case <path>
dispatch job run --case <path> --json
# follow next[] from output
dispatch job assert --run-id <id> --json
```

On assert PASS → done.
On assert FAIL → go to Troubleshooting.

## Troubleshooting

Work through this in order. Stop when you find the cause.

```bash
# 1. Step-level failure diagnostics
dispatch job inspect --run-id <id|latest> --step <n>

# 2. Full request/response trace
dispatch job readable --run-id <id|latest>

# 3. Retry the same run
dispatch job replay --run-id <id>

# 4. Export full artifact for deep inspection
dispatch job dump --run-id <id|latest> --out /tmp/run-dump.json
```

The `--step <n>` value comes from `failedStepIndex` in the failed run JSON envelope.

## Job Case Format

```json
{
  "schemaVersion": 1,
  "jobType": "my-workflow",
  "scenario": {
    "steps": [
      {
        "id": "step-id",
        "action": "module.action",
        "payload": { }
      }
    ]
  }
}
```

- Action names are always `module.action` (e.g. `flow.sleep`, `memory.store`)
- Interpolate previous step responses: `$.stepId.response.fieldName`
- Validate schema: `dispatch schema case`

## Built-in Actions

### flow
- `flow.sleep` — `{ "duration": "1s" }` — pause execution
- `flow.poll` — poll another action until conditions match

### memory
- `memory.store` — `{ "key": "...", "value": ... }` — persist a value
- `memory.recall` — `{ "key": "...", "defaultValue": ... }` — retrieve a value
- `memory.forget` — `{ "key": "..." }` or `{ "all": true }` — delete

Inspect any action schema:
```bash
dispatch schema action --name flow.poll
dispatch schema action --name memory.store
```

## Output Contract

All `--json` responses include `next[]`:

```json
{
  "status": "SUCCESS",
  "runId": "...",
  "next": [
    { "command": "dispatch job assert --run-id ...", "description": "verify outcomes" }
  ]
}
```

`next[]` is empty on terminal states (assert PASS).
Always follow `next[]` before deciding what to do.

Exit codes: `0` success · `1` internal · `2` bad input · `3` retryable · `4` not found

## Module Operations

```bash
dispatch module list                                      # see all loaded modules
dispatch module inspect --name <module>                  # inspect one module
dispatch module init --name <n> --out <dir>              # scaffold new module
dispatch module validate --path <dir>                    # validate before packing
dispatch module pack --path <dir> --out <bundle.dpmod.zip>
dispatch module install --bundle <bundle.dpmod.zip>
dispatch module uninstall --name <module>
```

## Batch Runs

```bash
dispatch job run-many --case <path> --count <n> --concurrency <n>
dispatch job batch-inspect --batch-id latest
```

## Config

```bash
dispatch runtime show                                    # global runtime overrides
dispatch defaults show --action <module.action>         # per-action defaults
dispatch defaults set --action <module.action> --file <path>
```