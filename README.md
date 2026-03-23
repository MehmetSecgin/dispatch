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
dispatch module skill --path modules/jsonplaceholder
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
Specialized agent recipes live in [docs/prompt-module-implementer-skill.md](docs/prompt-module-implementer-skill.md) and [docs/prompt-module-extender-skill.md](docs/prompt-module-extender-skill.md).
Consumer-repo agent bootstrap guidance lives in [docs/integrations/agent-job-authoring-bootstrap.md](docs/integrations/agent-job-authoring-bootstrap.md).

---

## Job Cases

A job case is a portable JSON file: shareable, versionable, replayable.

```json
{
  "schemaVersion": 1,
  "jobType": "my-workflow",
  "inputs": {
    "resourceId": {
      "type": "number",
      "required": true,
      "description": "Caller-supplied resource identifier"
    }
  },
  "scenario": {
    "steps": [
      { "id": "pause", "action": "flow.sleep", "payload": { "duration": "1s" } },
      {
        "id": "wait-for-ready",
        "action": "flow.poll",
        "payload": {
          "action": "probe.get-status",
          "payload": { "id": "${input.resourceId}" },
          "intervalMs": 1000,
          "maxDurationMs": 10000,
          "conditions": {
            "mode": "ALL",
            "rules": [{ "path": "$.ready", "op": "eq", "value": true }]
          },
          "store": { "resourceId": "$.id" }
        }
      }
    ]
  }
}
```

- Actions are always namespaced as `module.action`
- Use `${input.<name>}` for caller-supplied runtime inputs declared under top-level `inputs`
- Use `${step.<id>.response.*}` for prior response data
- Use `${step.<id>.exports.*}` for same-run workflow values
- Use `capture` only to promote `exports.*` into `run.*`
- Keep same-run values in `step.*` or `run.*`, not in persistent memory

Example invocation:

```bash
dispatch job validate --case my.job.case.json --input resourceId=123
dispatch job run --case my.job.case.json --input resourceId=123
```

If multiple values are required, repeat `--input`:

```bash
dispatch job run --case my.job.case.json \
  --input resourceId=123 \
  --input enabled=true \
  --input label=demo-resource
```

Detailed references:

- [SKILL.md](SKILL.md) for the default agent job-authoring workflow
- [docs/jobs/memory-and-dependencies.md](docs/jobs/memory-and-dependencies.md) for memory, dependencies, `capture`, and `--resolve-deps`
- [docs/modules/http-auth.md](docs/modules/http-auth.md) for shared HTTP and credential-backed auth flows

---

## Output Contract

Every command supports dual output mode:

```bash
dispatch job run --case my.job.case.json --input resourceId=123         # human mode
dispatch job run --case my.job.case.json --input resourceId=123 --json  # machine mode
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
dispatch job validate --case <path> [--input <key=value>]
dispatch job run --case <path> [--input <key=value>] [--resolve-deps]
dispatch job run-many --case <path> [--input <key=value>] --count <n> --concurrency <n>
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
dispatch module bootstrap [--from <repo>]
dispatch module list
dispatch module inspect <name>
dispatch module skill --path <dir>
dispatch module validate --path <dir>
dispatch module init --name <name> --out <dir>
dispatch module pack --path <dir> --out <bundle.dpmod.zip>
dispatch module install --bundle <bundle.dpmod.zip>
dispatch module uninstall --name <module>
dispatch module override init --from <module.action> --out <dir>
dispatch module override add --module <module> --action <action> [--path <dir>]
```

### Skills

```bash
dispatch skill install [name] [--all]
dispatch skill update [name] [--all]
```

These commands read the configured module skill sources from `dispatch.config.json`
or `~/.dispatch/config.json`.

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

## Dispatch Config

Dispatch reads config from:

- `./dispatch.config.json`
- `~/.dispatch/config.json`

Project config overrides user config when both exist. User config is the right place
for sensitive registry auth tokens. Project config is the right place for checked-in
module skill mappings and non-secret defaults.

Example:

```json
{
  "registry": {
    "url": "https://registry.example.com/modules",
    "scope": "@example"
  },
  "modules": {
    "jsonplaceholder": {
      "repo": "MehmetSecgin/dispatch",
      "version": "0.1.2"
    },
    "payments": {
      "repo": "${env.DISPATCH_PAYMENTS_SKILL_REPO}",
      "version": "1.4.0"
    }
  }
}
```

Notes:

- `modules.<name>.repo` is the source passed to `skills add`.
- `modules.<name>.version` pins the installed skill version.
- `${env.NAME}` interpolation works in config string values.
- `dispatch skill install <name>` installs one configured module skill.
- `dispatch skill update --all` refreshes every configured module skill.
- `dispatch module validate --path <dir>` warns when a configured module ships
  `SKILL.md` but the current repo does not appear to have that skill installed.

## State Directory

By default, dispatch stores state in `~/.dispatch` (modules, config, memory, action defaults).

You can override this with:

- `DISPATCH_HOME=/path/to/dir` - set the env var for persistent override (for example in `.envrc`)
- `--home <dir>` - pass the flag for a one-off override; takes precedence over the env var

**Agents:** use `DISPATCH_HOME` pointing to a project-local or temp directory to isolate dispatch state from the user's global `~/.dispatch` during automated runs.

## Module Authoring

Use dispatch modules when you want a reusable namespaced action surface rather than one-off jobs.

Start here:

- [MODULE_AUTHORING.md](MODULE_AUTHORING.md) for the module contract, file layout, handlers, schemas, exports, credentials, validation, and introspection
- [docs/prompt-module-implementer-skill.md](docs/prompt-module-implementer-skill.md) for the agent recipe to build a module from scratch
- [docs/prompt-module-extender-skill.md](docs/prompt-module-extender-skill.md) for the agent recipe to add actions to an existing module

Useful commands:

```bash
dispatch module bootstrap
dispatch module init --name payments --out ./modules/payments
dispatch module inspect jsonplaceholder
dispatch module skill --path modules/jsonplaceholder
dispatch module validate --path modules/jsonplaceholder
dispatch module pack --path ./modules/payments --out payments.dpmod.zip
dispatch module install --bundle payments.dpmod.zip
dispatch skill install payments
dispatch skill update payments
```

The repo ships [`modules/jsonplaceholder`](/Users/mehmetsecgin/dispatch/modules/jsonplaceholder) as a public reference module and example job set.

On a fresh consumer-repo clone, run `dispatch module bootstrap` once from the
workspace root if you want repo-local modules normalized into installed runtime
artifacts in `DISPATCH_HOME` for discovery and execution outside that checkout.
`dispatch module pack` and registry installs use the same installed artifact
contract. `dispatch module list`,
`dispatch job validate --case <path>`, and `dispatch module validate --path <dir>`
also auto-discover workspace-local `modules/*/module.json` when you run them
from, or point them at, that repo.

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

Use [SKILL.md](SKILL.md) as the default agent operating guide. It covers built-in discovery, schema inspection, job-writing guardrails, and the validate-before-run loop.

```bash
dispatch skill-version   # verify skill is current
```

---

## Security

- No external telemetry
- Secrets redacted in run artifacts and command output
- Use job-level credential profiles backed by environment variables for sensitive values
