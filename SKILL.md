---
name: dispatch
description: Agent-first CLI for orchestrating API workflows via declarative job files. Provides context on job file syntax, module actions, step sequencing, credential profiles, and the dispatch command surface.
license: MIT
---

# dispatch

`dispatch` is an agent-first CLI for orchestrating API workflows with declarative job files. Use it to validate and run portable workflows made of namespaced module actions.

## Job Authoring Loop

```bash
dispatch module list
dispatch module inspect flow
dispatch module inspect memory
dispatch schema action --name <module.action> --print
dispatch job validate --case my.job.case.json
dispatch job run --case my.job.case.json
```

- Current CLI flag is `--case`.
- Start with `dispatch module list` so you inventory built-ins before inventing step structure.
- `--resolve-deps` fills declared memory prerequisites before the main run; `--home` overrides the state directory.

## Job file structure

Top-level fields:

- `schemaVersion`: schema version, currently `1`.
- `jobType`: stable workflow name.
- `http`: shared run-level transport config such as `baseUrl` and `defaultHeaders`.
- `dependencies`: declared module, memory, or required `http` prerequisites.
- `scenario`: executable workflow; contains `steps`.
- `credentials`: named credential profiles.
- `metadata`: optional non-execution context.

Minimal single-step job:

```json
{
  "schemaVersion": 1,
  "jobType": "flow-sleep",
  "scenario": {
    "steps": [
      { "id": "pause", "action": "flow.sleep", "payload": { "duration": "1s" } }
    ]
  }
}
```

Job with shared HTTP config, dependencies, and metadata:

```json
{
  "schemaVersion": 1,
  "jobType": "users-fetch",
  "http": {
    "baseUrl": "${env.DISPATCH_HTTP_BASE_URL}",
    "defaultHeaders": { "x-client": "dispatch" }
  },
  "dependencies": {
    "http": { "required": ["baseUrl", "defaultHeaders.x-client"] }
  },
  "scenario": {
    "steps": [
      { "id": "user", "action": "example.get-user", "payload": { "id": 1 } }
    ]
  },
  "metadata": { "owner": "agent" }
}
```

## Modules and actions

Modules package actions and optional shipped jobs. Actions are always namespaced as `module.action`, for example:

- `flow.sleep`
- `memory.recall`
- `example.create-user`

Dispatch ships built-ins you should inspect first: `flow` for orchestration (`flow.sleep`, `flow.poll`) and `memory` for durable cross-run state (`memory.recall`, `memory.store`, `memory.forget`).

Use inspection instead of guessing:

```bash
dispatch module list
dispatch module inspect jsonplaceholder
dispatch module skill --path ./modules/my-module
dispatch schema action --name jsonplaceholder.get-user --print
dispatch module validate --path ./modules/my-module
dispatch module install --bundle my-module.dpmod.zip
dispatch module install --name my-module --version 0.1.0
dispatch skill install <name>
dispatch skill install --all
dispatch skill update <name>
dispatch skill update --all
```

To use `dispatch skill install/update`, define module skill sources in `dispatch.config.json` or `~/.dispatch/config.json`:

```json
{ "modules": { "my-module": { "repo": "owner/my-module", "version": "0.1.0" } } }
```

## Step anatomy

Each `scenario.steps[]` item usually contains:

- `id`: unique step name used by interpolation.
- `action`: target `module.action`.
- `payload`: JSON input.
- `credential`: optional credential profile name.
- `capture`: optional map from `exports.*` to stable `run.*` names.

```json
{ "id": "login", "action": "auth.login", "credential": "apiUser", "payload": {} }
```

## Exports and capture

Actions can return both `response` and `exports`.

- `${step.<id>.response.<field>}` reads transport-facing response data.
- `${step.<id>.exports.<field>}` reads same-run workflow values emitted by the action.
- `capture` promotes a selected export into `${run.<name>}` for later steps and only accepts `exports.*`.

Multi-step job with capture:

```json
{
  "schemaVersion": 1,
  "jobType": "publish-followup",
  "scenario": {
    "steps": [
      {
        "id": "publish",
        "action": "example.publish",
        "payload": { "title": "Hello" },
        "capture": { "workflowId": "exports.generatedId" }
      },
      {
        "id": "fetch",
        "action": "example.get",
        "payload": { "id": "${run.workflowId}" }
      }
    ]
  }
}
```

Direct export wiring without capture:

```json
{ "id": "fetch", "action": "example.get", "payload": { "id": "${step.publish.exports.generatedId}" } }
```

## Credentials

Credential profiles let jobs declare secret requirements without storing secret values in the file. Define profiles under `credentials`, map fields with `fromEnv`, then bind a profile to a step with `credential`.

Credential-bound step:

```json
{
  "schemaVersion": 1,
  "jobType": "auth-login",
  "http": { "baseUrl": "${env.DISPATCH_HTTP_BASE_URL}" },
  "credentials": {
    "apiUser": {
      "fromEnv": {
        "username": "DISPATCH_API_USERNAME",
        "password": "DISPATCH_API_PASSWORD"
      }
    }
  },
  "scenario": {
    "steps": [
      { "id": "login", "action": "auth.login", "credential": "apiUser", "payload": {} }
    ]
  }
}
```

Rules:

- `fromEnv` maps credential field names to env var names.
- Steps still bind profiles explicitly with `credential`.
- Keep secrets out of `payload`; actions receive resolved credentials at runtime.

## Common patterns

- Single-step workflow: literal payload, one action, no interpolation.
- Multi-step workflow: later steps read `${step.*}` or `${run.*}`.
- Repeated checks: inspect `flow.poll` before writing manual retry loops.
- Env-backed transport: put shared request config under top-level `http`.
- Dependency-aware runs: declare `dependencies`; use `--resolve-deps` when you want dispatch to fill missing memory prerequisites.

When writing a job, start with `module list`, inspect built-ins and planned actions, then validate, then run.
