# Module Design Conventions

These conventions help module authors build action surfaces that are easy to
read, easy to compose into jobs, and stable even when backend APIs are verbose
or inconsistent.

## Prefer Intent-Shaped Actions

Favor actions that express user intent over actions that mirror raw endpoints.

Good:

- `create-record`
- `update-state`
- `create-invoice`

Less useful:

- `post-v1-records`
- `patch-v1-state`
- `invoke-create-invoice-endpoint`

An action should describe what the workflow wants to accomplish, not how the
HTTP transport is wired underneath.

## Prefer Domain Language Over Transport Language

Public payload fields should use domain terms when they are clearer than the
backend's wire shape.

Good:

- `status: 'archived'`
- `priority: 'high'`
- `startTime: '2026-03-10T12:00:00Z'`

Avoid leaking transport-specific objects, numeric enums, or nested wrappers into
the public schema unless they are already the clearest domain language.

## Keep Payloads Small And Explicit

Expose only the fields a workflow actually needs to express intent.

- Prefer a compact payload plus internal normalization over passing the full
  upstream request body through the job.
- Keep required fields small and meaningful.
- Do not force callers to supply fields the handler can derive safely.

## Default Generously, Require Explicitly

Provide sensible defaults for common paths, but require explicit fields for
choices that materially change behavior.

Good defaults:

- timestamp defaults such as "now"
- derived names from other fields
- standard headers or route fragments

Require explicit input for:

- environment or tenant choice
- actions with multiple business meanings
- destructive or irreversible behavior

## Use Lookup Maps For Enum-Like Resolution

When a compact public value must expand into a wire object, keep the lookup in
code rather than pushing the wire object into job files.

Example:

```ts
export const STATUS_MAP = {
  archived: { code: 'ARCHIVED', label: 'Archived' },
  active: { code: 'ACTIVE', label: 'Active' },
} as const;
```

This keeps jobs readable while making the wire translation explicit and testable.

## Derive Values When Reasonable

Derive IDs, names, timestamps, and related helper values when there is a clear
and deterministic rule, but always allow an explicit override when callers may
need to break the default.

Examples:

- generate a display name from `firstName` and `lastName` unless `displayName` is set
- derive `effectiveAt` from current time unless a caller overrides it
- compute a normalized identifier from human input unless the workflow provides
  one directly

## Return Derived Values As Exports

If an action computes or receives a value that later steps need, return it under
`exports`.

Use `response` for the main outcome.
Use `exports` for workflow wiring.

Examples of good exports:

- generated IDs
- normalized names
- computed timestamps
- resolved URLs used later in the run

Declare `exportsSchema` when exports are part of the intended contract.

## Keep Secrets Out Of Payloads

Never accept secrets directly in an action payload.

Instead:

1. declare `credentialSchema`
2. let the job bind a named credential profile
3. read the resolved object from `ctx.credential`

This keeps job files portable and prevents module APIs from inventing ad hoc
env-var conventions.

## Use Activity Logs As Workflow Breadcrumbs

Log meaningful action milestones with `ctx.artifacts.appendActivity(...)`.

Recommended format:

```text
<action-name> key=value key=value
```

Examples:

- `authenticate user=operator success=true`
- `create-record recordId=abc-123 state=created`
- `update-state recordId=abc-123 state=archived`

Keep activity lines compact, factual, and free of secrets.

## Keep The Runtime Entry Declarative

`index.ts` or `index.mjs` should make the module surface easy to scan.

- keep action wiring in the entry file
- move schemas to `schemas.ts`
- move constants and lookup maps to `constants.ts`
- move heavier handler logic to dedicated files as the module grows

Someone opening the runtime entry should be able to understand the full action
surface without reading implementation-heavy code first.
