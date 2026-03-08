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

Each namespace file contains nested JSON. Keys are dotted paths that address locations inside that file — `users.user-1` becomes `users → user-1` in the object tree.

For example, after running a seed job that stores two users, `~/.dispatch/memory/jsonplaceholder-reference.json` looks like:

```json
{
  "users": {
    "user-1": {
      "id": 1,
      "name": "Leanne Graham",
      "email": "Sincere@april.biz"
    },
    "user-2": {
      "id": 2,
      "name": "Ervin Howell",
      "email": "Shanna@melissa.tv"
    }
  }
}
```

The job step that wrote `user-1` would look like:

```json
{
  "id": "store-user",
  "action": "memory.store",
  "payload": {
    "namespace": "jsonplaceholder-reference",
    "key": "users.user-1",
    "value": {
      "id": 1,
      "name": "Leanne Graham",
      "email": "Sincere@april.biz"
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
dispatch memory inspect --namespace jsonplaceholder-reference
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
      { "name": "jsonplaceholder", "version": "^0.2.0" }
    ],
    "memory": [
      {
        "namespace": "jsonplaceholder-reference",
        "key": "users.user-1",
        "fill": {
          "module": "jsonplaceholder",
          "job": "seed-user-1-reference"
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

Public reference example in this repo:

```text
modules/jsonplaceholder/
  module.json
  index.mjs
  jobs/
    jsonplaceholder-kitchen-sink.job.case.json
    jsonplaceholder-relations.job.case.json
    jsonplaceholder-poll.job.case.json
    jsonplaceholder-run-many.job.case.json
    seed-user-1-reference.job.seed.json
    jsonplaceholder-from-memory.job.case.json
```

Guidelines:

- keep case jobs runnable without hidden side effects
- use seed jobs to populate durable memory explicitly
- store whatever shape makes sense for the consumer — the memory module accepts any value
- prefer memory as an optimization layer, not a silent requirement
- let `module.json` point at the runtime entry; keep action/schema definitions in the module entry itself
