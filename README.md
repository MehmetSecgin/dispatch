# dispatch

**Agent-first job runner for API workflows.**

Write a job. Brief your agent. Let it dispatch.

```bash
npm install -g dispatchkit
```

---

## What is this?

Dispatch is a modular CLI for running API workflows — built from the ground up to be operated by AI agents, and comfortable for the humans who write the jobs.

Most CLIs are built for humans and tolerated by agents. Dispatch inverts this. The primary operator is an AI agent. The human experience is layered on top.

**The flow:**
```
developer (natural language)
  → agent reads SKILL.md
  → agent composes job
  → dispatch job validate
  → dispatch job run        ← real API calls happen here
  → dispatch job assert
  → agent reports back
```

---

## Built-in Modules

### `flow` — control flow primitives

| Action | Description |
|---|---|
| `flow.sleep` | Pause execution for a deterministic duration |
| `flow.poll` | Call another action repeatedly until conditions match or timeout |

### `memory` — namespaced persistent state between sessions

| Action | Description |
|---|---|
| `memory.store` | Store a value by key in a namespace |
| `memory.recall` | Recall a value by key from a namespace |
| `memory.forget` | Forget one key or clear one namespace |

---

## Quick Start

```bash
# Install
npm install -g dispatchkit

# Health check
dispatch self-check
dispatch doctor

# Run the built-in flow example
dispatch job validate --case jobs/flow-sleep.job.case.json
dispatch job run --case jobs/flow-sleep.job.case.json
dispatch job assert --run-id latest

# Try the repo jsonplaceholder module
dispatch module inspect jsonplaceholder
dispatch job validate --case modules/jsonplaceholder/jobs/jsonplaceholder-kitchen-sink.job.case.json
dispatch job run --case modules/jsonplaceholder/jobs/jsonplaceholder-kitchen-sink.job.case.json
dispatch job assert --run-id latest
```

Release notes for maintainers live in [docs/release.md](docs/release.md).
Agent-native product principles live in [docs/agent-native.md](docs/agent-native.md).
HTTP auth/session behavior for module authors lives in [docs/modules/http-auth.md](docs/modules/http-auth.md).

---

## Job Cases

A job case is a portable JSON file — shareable, versionable, replayable.

```json
{
  "schemaVersion": 1,
  "jobType": "my-workflow",
  "scenario": {
    "steps": [
      {
        "id": "pause",
        "action": "flow.sleep",
        "payload": { "duration": "1s" }
      },
      {
        "id": "wait-for-ready",
        "action": "flow.poll",
        "payload": {
          "action": "probe.get-status",
          "payload": {
            "id": "${run.targetId}"
          },
          "intervalMs": 1000,
          "maxDurationMs": 10000,
          "conditions": {
            "mode": "ALL",
            "rules": [
              { "path": "$.ready", "op": "eq", "value": true }
            ]
          },
          "store": {
            "resourceId": "$.id"
          }
        }
      },
    ]
  }
}
```

- Actions are always namespaced: `module.action`
- Payloads use intent fields, not raw wire payloads
- Interpolation uses `${step.<id>.response.<field>}` or `${jsonpath(step:<id>, <path>)}`
- Same-run values should flow through `step.*` or `run.*`, not persistent memory

### Memory and job kinds

Dispatch distinguishes between portable case jobs and memory-mutating seed jobs:

- `*.job.case.json`
  - may use `memory.recall`
  - may not use `memory.store`
  - may not use `memory.forget`
- `*.job.seed.json`
  - may use all memory actions

Memory is for durable cross-run state, not same-run wiring. Persistent values live at:

```text
~/.dispatch/memory/<namespace>.json
```

Keys are dotted paths that address locations inside the namespace file. The file on disk is plain nested JSON:

```json
{
  "users": {
    "user-1": { "id": 1, "name": "Leanne Graham" },
    "user-2": { "id": 2, "name": "Ervin Howell" }
  }
}
```

A seed job step that writes `user-1`:

```json
{
  "id": "store-user",
  "action": "memory.store",
  "payload": {
    "namespace": "reference-data",
    "key": "users.user-1",
    "value": { "id": 1, "name": "Leanne Graham" }
  }
}
```

### Job dependencies

Jobs can declare explicit prerequisites:

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

- Module dependencies are validated before execution
- Missing memory dependencies fail early with actionable `next[]`
- `dispatch job run --resolve-deps` can run fill jobs before the main job
- Fill jobs resolve by logical module job id, preferring `<job>.job.seed.json` over `<job>.job.case.json`

---

## Output Contract

Every command supports dual output mode:

```bash
dispatch job run --case my.job.case.json         # human mode
dispatch job run --case my.job.case.json --json  # machine mode
```

**Machine mode** (`--json`) returns stable JSON envelopes:

```json
{
  "cliVersion": "0.0.1",
  "jobType": "my-workflow",
  "status": "SUCCESS",
  "runId": "20260306-162116-job-run-716a47b",
  "runDir": "~/dispatch/run-output/20260306-162116-job-run-716a47b",
  "moduleResolutionPath": "~/dispatch/run-output/20260306-162116-job-run-716a47b/module_resolution.json",
  "next": [
    {
      "command": "dispatch job assert --run-id 20260306-162116-job-run-716a47b",
      "description": "verify outcomes"
    }
  ]
}
```

The `next` field tells the agent what to do after every command. No reasoning required.

**Exit codes:**
- `0` success
- `1` internal error
- `2` usage/input error — do not retry
- `3` transient — retry safe
- `4` not found

---

## Run Artifacts

Every run writes a full deterministic record:

```
run-output/<runId>/
  summary.json              — status, timing, key outputs
  activity.log              — step-by-step timeline
  job.case.input.json       — original job case
  job.case.resolved.json    — resolved with interpolation applied
  meta.json                 — run metadata
  module_resolution.json    — which module handled each action
```

Written on both success and failure. Assert offline. Replay without network.

---

## Commands

### Jobs
```bash
dispatch job validate --case <path>
dispatch job run --case <path> [--resolve-deps]
dispatch job run-many --case <path> --count <n> --concurrency <n>
dispatch job assert --run-id <id|latest>
dispatch job inspect --run-id <id|latest> [--step <n>]
dispatch job readable --run-id <id|latest>
dispatch job dump --run-id <id|latest> [--out <path>]
dispatch job replay --run-id <id>
dispatch job list [--limit <n>]
dispatch job latest
dispatch job cases
dispatch job export --run-id <id> --out <path>
dispatch job import --file <path>
dispatch job batch-inspect --batch-id <id|latest>
```

### Modules
```bash
dispatch module list
dispatch module inspect <name>
dispatch module validate --path <dir>
dispatch module init --name <name> --out <dir>
dispatch module pack --path <dir> --out <bundle.dpmod.zip>
dispatch module install --bundle <bundle.dpmod.zip>
dispatch module uninstall --name <module>
dispatch module override init --from <module.action> --out <dir>
dispatch module override add --module <module> --action <action> [--path <dir>]
```

```bash
dispatch runtime show
dispatch runtime unset [--all]
dispatch defaults show [--action <module.action>]
dispatch defaults set --action <module.action> --file <path>
dispatch defaults unset --action <module.action>
dispatch memory list
dispatch memory inspect --namespace <name>
```

### Utilities
```bash
dispatch doctor
dispatch self-check
dispatch schema case --print
dispatch schema action --name <module.action> --print
dispatch skill-version
dispatch completion <bash|zsh|fish>
```

---

## Module System

Dispatch modules wrap API surfaces. Three layers, last wins:

```
builtin     src/modules/builtin/*       ships with dispatch
repo        ./modules/*                 project-local
user        ~/.dispatch/modules/*       user-installed bundles
```

### Build a module

```bash
dispatch module init --name payments --out ./modules/payments
```

Generates two files:

```
payments/
  module.json     — discovery manifest
  index.mjs       — runtime module entry
```

```json
{
  "name": "payments",
  "version": "0.1.0",
  "entry": "index.mjs"
}
```

```js
import { z } from 'zod';
import { defineAction, defineModule } from 'dispatchkit';

async function registerWebhook(ctx, payload) {
  return {
    response: {
      ok: true,
      received: payload,
    },
    detail: 'replace with real implementation',
  };
}

export default defineModule({
  name: 'payments',
  version: '0.1.0',
  actions: {
    'register-webhook': defineAction({
      description: 'Register a webhook endpoint',
      schema: z.object({
        url: z.string().url(),
      }),
      handler: registerWebhook,
    }),
  },
});
```

- `module.json` is discovery metadata and runtime entry location
- `index.mjs` default-exports the full module object
- external modules may be authored in TS and compiled to JS; `module.json.entry` should point at the built runtime file

Modules can also ship job files under `jobs/`:

```text
payments/
  module.json
  index.mjs
  jobs/
    sync-catalog.job.case.json
    cache-reference-data.job.seed.json
```

- `dispatch module inspect <name> --json` lists discovered shipped jobs
- `dispatch module validate --path <dir>` validates both handlers and shipped job files
- Use seed jobs for cache/bootstrap flows that populate memory for later case jobs

### Example repo module: `jsonplaceholder`

The repository ships a public example module under [`modules/jsonplaceholder`](/Users/mehmetsecgin/dispatch/modules/jsonplaceholder).

Useful commands:

```bash
dispatch module inspect jsonplaceholder
dispatch module validate --path modules/jsonplaceholder
dispatch job validate --case modules/jsonplaceholder/jobs/jsonplaceholder-kitchen-sink.job.case.json
dispatch job run --case modules/jsonplaceholder/jobs/jsonplaceholder-kitchen-sink.job.case.json
dispatch job run-many --case modules/jsonplaceholder/jobs/jsonplaceholder-run-many.job.case.json --count 3
```

Example shipped jobs:

- `jsonplaceholder-kitchen-sink.job.case.json`
  Exercises `flow.sleep`, `flow.poll`, interpolation, `run.*`, and a follow-up create call.
- `jsonplaceholder-relations.job.case.json`
  Traverses user -> albums -> photos and user -> posts -> comments.
- `jsonplaceholder-poll.job.case.json`
  Focused `flow.poll` example using `jsonplaceholder.get-post`.
- `seed-user-1-reference.job.seed.json`
  Populates durable memory under `jsonplaceholder-reference.users.user-1`.
- `jsonplaceholder-from-memory.job.case.json`
  Declares a memory dependency and recalls the seeded user before listing posts.

### Module auth flows

Cookie-backed auth flows are handled by `ctx.http`, not by module-specific storage.

- a login action can establish a session with `Set-Cookie`
- later actions in the same run automatically reuse the session
- cookies are run-scoped only and are not persisted in `memory`

See [docs/modules/http-auth.md](docs/modules/http-auth.md) for the module-author contract.

### Pack and install

```bash
dispatch module pack --path ./modules/payments --out payments.dpmod.zip
dispatch module install --bundle payments.dpmod.zip
```

---

## Local State

```
~/.dispatch/
  runtime-overrides.json    — global runtime overrides
  action-defaults.json      — per-action default payloads
  modules/                  — user-installed module bundles
  memory/                   — namespaced memory files
    <namespace>.json
```

---

## Agent Briefing

Drop `SKILL.md` into your agent's context before any session. The agent reads it once, knows the preflight sequence, the happy path, and the troubleshooting ladder. No exploration required.

```bash
dispatch skill-version   # verify skill is current
```

---

## Security

- No external telemetry
- Secrets redacted in run artifacts and command output
- Use environment variables for sensitive values
