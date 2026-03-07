# Memory and Job Dependencies

Dispatch has three distinct data channels:

- `step.*` for values produced earlier in the same job
- `run.*` for runtime values populated during the same run
- `memory.*` for durable cross-run state

If a value only matters inside one run, use `step.*` or `run.*`. Persistent memory is for cached reference data, checkpoints, and shared bootstrap context.

## Memory namespaces

Memory is stored under:

```text
~/.dispatch/memory/<namespace>.json
```

Each namespace file contains nested JSON. Keys are dotted paths inside that file.

Example:

```json
{
  "namespace": "reference-data",
  "key": "catalog.primary",
  "value": {
    "payload": {
      "entryId": 123,
      "labels": ["alpha", "beta", "gamma"]
    },
    "meta": {
      "cachedAt": "2026-03-07T18:00:00Z",
      "source": "catalog.get-primary",
      "sourceKey": "primary"
    }
  }
}
```

Rules:

- `namespace` is required
- `key` is a dotted path
- path segments must be non-empty
- `memory.store` replaces the target value
- `memory.recall` returns the stored value or `defaultValue`
- `memory.forget` removes one key or clears one namespace with `all: true`

## Job kinds

Dispatch treats job files as one of two kinds:

- `*.job.case.json`
- `*.job.seed.json`

If a job path does not match either suffix, it is treated as a case job.

### Case jobs

Case jobs are the portable, replayable workflow form.

- may use `memory.recall`
- may not use `memory.store`
- may not use `memory.forget`

### Seed jobs

Seed jobs are the explicit place to populate or clear durable memory.

- may use `memory.store`
- may use `memory.recall`
- may use `memory.forget`

This keeps normal workflow jobs shareable and side-effect-light while making durable cache/bootstrap behavior explicit.

## Inspecting memory

Dispatch exposes a small read-only inspection surface:

```bash
dispatch memory list
dispatch memory inspect --namespace <name>
```

- `memory list` shows the discovered namespace files under `~/.dispatch/memory/`
- `memory inspect` prints the full JSON contents of one namespace

These commands are intentionally read-only. Durable memory mutation still happens through seed jobs, not ad hoc CLI writes.

## Dependencies

Jobs can declare prerequisites at the top level:

```json
{
  "dependencies": {
    "modules": [
      { "name": "catalog", "version": "^0.4.0" }
    ],
    "memory": [
      {
        "namespace": "reference-data",
        "key": "catalog.primary",
        "fill": {
          "module": "catalog",
          "job": "seed-primary-reference"
        }
      }
    ]
  }
}
```

### Module dependencies

- inferred automatically from step actions
- may also be declared explicitly to pin a semver range
- are validated before execution

### Memory dependencies

- must be declared explicitly
- are checked before execution
- if missing, validation/run fails early
- if `fill` exists, `next[]` suggests the seed job to populate it

## Fill jobs and `--resolve-deps`

Fill jobs are resolved by logical module job id:

- check `<job>.job.seed.json` first
- fall back to `<job>.job.case.json`

Default behavior:

- `dispatch job run` never auto-runs dependency jobs

Opt-in behavior:

```bash
dispatch job run --case <path> --resolve-deps
```

With `--resolve-deps`, missing memory dependencies that have valid `fill` jobs are run before the main job. Module installation/version issues are still not auto-resolved.

## Module author guidance

Recommended module shape:

```text
my-module/
  module.json
  index.mjs
  jobs/
    sync-orders.job.case.json
    cache-reference-data.job.seed.json
```

Guidelines:

- keep case jobs runnable without hidden side effects
- use seed jobs to populate durable memory explicitly
- store cached reference objects with `payload` and `meta`
- prefer memory as an optimization layer, not a silent requirement
