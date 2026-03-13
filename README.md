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

| Action       | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `flow.sleep` | Pause execution for a deterministic duration                     |
| `flow.poll`  | Call another action repeatedly until conditions match or timeout |

### `memory` — namespaced persistent state between sessions

| Action          | Description                            |
| --------------- | -------------------------------------- |
| `memory.store`  | Store a value by key in a namespace    |
| `memory.recall` | Recall a value by key from a namespace |
| `memory.forget` | Forget one key or clear one namespace  |

---

## Quick Start

```bash
# Install
npm install -g dispatchkit

# Health check
dispatch self-check
dispatch doctor

# Optional: repo-local env loading with direnv
cp .envrc.example .envrc
direnv allow

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

### Local Environment Setup With `direnv`

For local development, the recommended workflow is to keep environment-specific values
outside the job file and load them automatically when you enter the repo.

1. Copy `.envrc.example` to `.envrc`
2. Replace placeholder values with your local values
3. Run `direnv allow`

```bash
cp .envrc.example .envrc
direnv allow
```

This gives you one repo-local environment bundle for:

- secret values such as usernames and passwords
- non-secret values such as base URLs and shared headers

The job file stays portable and explicit. The local environment stays out of git.

Release notes for maintainers live in [docs/release.md](docs/release.md).
Agent-native product principles live in [docs/agent-native.md](docs/agent-native.md).
HTTP auth/session behavior for module authors lives in [docs/modules/http-auth.md](docs/modules/http-auth.md).
Packaged module-author guidance lives in [MODULE_AUTHORING.md](MODULE_AUTHORING.md) and [CONVENTIONS.md](CONVENTIONS.md).

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
            "rules": [{ "path": "$.ready", "op": "eq", "value": true }]
          },
          "store": {
            "resourceId": "$.id"
          }
        }
      }
    ]
  }
}
```

- Actions are always namespaced: `module.action`
- Payloads use intent fields, not raw wire payloads
- Interpolation uses `${env.NAME}`, `${step.<id>.response.<field>}`, `${step.<id>.exports.<field>}`, or `${jsonpath(step:<id>, <path>)}`
- Same-run values should flow through `step.*` or `run.*`, not persistent memory

`env.*` is the bridge between repo-local setup and portable jobs. With `direnv`, the values
come from `.envrc`; in CI they can come from normal environment injection.

If an action generates a same-run workflow value that should not be faked into the transport response, return it under `exports` and reference it from later steps:

```js
return {
  response: { ok: true },
  exports: { generatedId },
};
```

```json
{
  "id": "consume",
  "action": "example.consume",
  "payload": {
    "generatedId": "${step.publish.exports.generatedId}"
  }
}
```

If the job wants a stable workflow-level name instead of coupling later steps to the action’s export key, capture it explicitly into `run.*`:

```json
{
  "id": "publish",
  "action": "example.publish",
  "capture": {
    "workflowId": "exports.generatedId"
  }
}
```

Later steps can then use `${run.workflowId}`.

### Job-level HTTP defaults

Jobs can declare shared request context once at the top level:

```json
{
  "http": {
    "baseUrl": "https://api.example.com",
    "defaultHeaders": {
      "x-client": "dispatch"
    }
  }
}
```

- `http.baseUrl` configures the root `ctx.http` transport for the whole run
- `http.defaultHeaders` applies to all requests in the run unless a handler narrows or overrides them
- Cookies/session continuity still live in the shared run transport
- Handlers can still derive narrower clients with `ctx.http.withDefaults(...)`

If those values differ by developer machine, environment, or CI target, keep the job explicit
and resolve the actual values from `${env.*}`:

```json
{
  "http": {
    "baseUrl": "${env.DISPATCH_HTTP_BASE_URL}",
    "defaultHeaders": {
      "x-client": "dispatch",
      "x-context": "${env.DISPATCH_HTTP_X_CONTEXT}"
    }
  }
}
```

This is the recommended way to connect `direnv` to shared request config.

If the env-backed values are missing or resolve to invalid HTTP config:

- `dispatch job validate` fails before execution
- `dispatch job run` also fails before execution

If a job intentionally relies on shared HTTP context, declare that explicitly in dependencies:

```json
{
  "http": {
    "baseUrl": "https://api.example.com",
    "defaultHeaders": {
      "x-client": "dispatch"
    }
  },
  "dependencies": {
    "http": {
      "required": ["baseUrl", "defaultHeaders.x-client"]
    }
  }
}
```

- `job.http` holds the actual values
- `dependencies.http.required` declares which paths must be present
- `dispatch job validate` and `dispatch job run` fail early if required HTTP config is missing

### Job-level credential profiles

Jobs can bind named credential profiles without putting plaintext secrets in the case file:

```json
{
  "credentials": {
    "adminQa": {
      "fromEnv": {
        "username": "DISPATCH_ADMIN_USERNAME",
        "password": "DISPATCH_ADMIN_PASSWORD"
      }
    }
  },
  "scenario": {
    "steps": [
      {
        "id": "login",
        "action": "admin.login",
        "credential": "adminQa",
        "payload": {}
      }
    ]
  }
}
```

- `credentials.<name>.fromEnv` maps credential field names to environment variables
- step `credential` binds one named profile to an action
- actions read resolved secrets from `ctx.credential`, not from payload
- `dispatch job validate` fails if a step is missing a required credential binding
- `dispatch job run` also fails early if required environment variables are missing

This pairs naturally with `direnv`: the job stores only env var names, while `.envrc`
or CI provides the actual secret values.

If an action expects a credential contract, declare it with `credentialSchema` so `module inspect`
and `schema action --print` can surface it.

### Putting It Together

The intended setup is:

1. `direnv` loads environment-specific values into your shell
2. the job reads non-secret values through `${env.*}`
3. the job binds secrets through `credentials.<name>.fromEnv`
4. steps still bind credentials explicitly with `credential`

Example:

```json
{
  "http": {
    "baseUrl": "${env.DISPATCH_HTTP_BASE_URL}",
    "defaultHeaders": {
      "x-context": "${env.DISPATCH_HTTP_X_CONTEXT}"
    }
  },
  "credentials": {
    "admin": {
      "fromEnv": {
        "username": "DISPATCH_ADMIN_USERNAME",
        "password": "DISPATCH_ADMIN_PASSWORD"
      }
    }
  },
  "scenario": {
    "steps": [
      {
        "id": "login",
        "action": "admin.login",
        "credential": "admin",
        "payload": {}
      }
    ]
  }
}
```

That keeps the job inspectable and portable while removing the need for repeated manual
`export ...` commands.

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
    "modules": [{ "name": "jsonplaceholder", "version": "^0.2.0" }],
    "memory": [
      {
        "namespace": "jsonplaceholder-reference",
        "key": "users.user-1",
        "fill": {
          "module": "jsonplaceholder",
          "job": "seed-user-1-reference"
        }
      }
    ],
    "http": {
      "required": ["baseUrl", "defaultHeaders.x-client"]
    }
  }
}
```

- Module dependencies are validated before execution
- Missing memory dependencies fail early with actionable `next[]`
- Missing required HTTP config fails before actions execute
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

Use `dispatch --home <dir> ...` to override that user state root for one invocation.

## State Directory

By default, dispatch stores state in `~/.dispatch` (modules, config, memory, action defaults).

You can override this with:

- `DISPATCH_HOME=/path/to/dir` - set the env var for persistent override (for example in `.envrc`)
- `--home <dir>` - pass the flag for a one-off override; takes precedence over the env var

**Agents:** use `DISPATCH_HOME` pointing to a project-local or temp directory to isolate dispatch state from the user's global `~/.dispatch` during automated runs.

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
- `dispatch schema action --name <module.action> --print` includes input, declared exports, and declared credential schema when present
- `dispatch module validate --path <dir>` validates both handlers and shipped job files
- Use seed jobs for cache/bootstrap flows that populate memory for later case jobs

### Example repo module: `jsonplaceholder`

The repository ships a public example module under [`modules/jsonplaceholder`](/Users/mehmetsecgin/dispatch/modules/jsonplaceholder).

Its shipped jobs now demonstrate the intended pattern: each job declares
`http.baseUrl`, and the module actions use relative HTTP paths through the shared run
transport.

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

- use the top-level job `http` block for shared base URLs and default headers
- a login action can establish a session with `Set-Cookie`
- later actions in the same run automatically reuse the session
- cookies are run-scoped only and are not persisted in `memory`

See [docs/modules/http-auth.md](docs/modules/http-auth.md) for the module-author contract.

### Pack and install

```bash
dispatch module pack --path ./modules/payments --out payments.dpmod.zip
dispatch module install --bundle payments.dpmod.zip
```

Packed bundles are runtime-focused by default:

- `module.json`
- the runtime entry subtree (for example `dist/`)
- `jobs/`
- `README.md` when present

Authoring files such as `src/`, `tsconfig.json`, and bundler configs are not bundled unless the
module manifest explicitly adds extra runtime assets under `pack.include`.

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

For isolated project-local state during development:

```bash
dispatch --home ./.dispatch-dev module list
dispatch --home ./.dispatch-dev job run --case ./jobs/example.job.case.json
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
- Use job-level credential profiles backed by environment variables for sensitive values
