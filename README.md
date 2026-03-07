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

### `memory` — persistent state between sessions

| Action | Description |
|---|---|
| `memory.store` | Store a value by key |
| `memory.recall` | Recall a value by key |
| `memory.forget` | Forget one key or clear all memory |

---

## Quick Start

```bash
# Install
npm install -g dispatchkit

# Health check
dispatch self-check
dispatch doctor

# Run the example job
dispatch job validate --case jobs/flow-sleep.job.case.json
dispatch job run --case jobs/flow-sleep.job.case.json
dispatch job assert --run-id latest
```

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
        "id": "store-result",
        "action": "memory.store",
        "payload": { "key": "last-run", "value": "$.pause.response" }
      }
    ]
  }
}
```

- Actions are always namespaced: `module.action`
- Payloads use intent fields, not raw wire payloads
- Interpolation: `$.stepId.response.field` references previous step responses

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
dispatch job run --case <path>
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
dispatch module inspect --name <module>
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
  module.json     — manifest
  index.mjs       — action handler exports
```

```json
{
  "name": "payments",
  "version": "0.1.0",
  "entry": "index.mjs",
  "actions": {
    "register-webhook": {
      "handler": "registerWebhook",
      "description": "Register a webhook endpoint"
    }
  }
}
```

```js
export async function registerWebhook(ctx, payload) {
  return {
    response: {
      ok: true,
      received: payload,
    },
    detail: 'replace with real implementation',
  };
}
```

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
  memory.json               — memory module persistent store
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
