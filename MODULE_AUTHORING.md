# Module Authoring Reference

This document is for dispatch module authors working from the published
`dispatchkit` package. It focuses on the runtime contract, recommended file
layout, and the conventions that make modules easy for both humans and agents
to author and inspect.

For job syntax and operator-facing CLI behavior, see `README.md`.
For design guidance on intent-shaped APIs, see `CONVENTIONS.md`.

## Module Structure

A dispatch module is a directory containing:

- `module.json` - discovery manifest
- Runtime entry file - referenced by `module.json.entry`
- `src/` - optional TypeScript sources when authoring in TS
- `jobs/` - optional shipped example jobs
- `README.md` - optional module-specific notes

Typical JavaScript layout:

```text
my-module/
  module.json
  index.mjs
  schemas.mjs
  jobs/
    ping-minimal.job.case.json
```

Typical TypeScript layout:

```text
my-module/
  module.json
  src/
    index.ts
    schemas.ts
    constants.ts
  dist/
    index.mjs
  jobs/
    ping-minimal.job.case.json
  tsconfig.json
  tsup.config.ts
  README.md
```

## module.json

`module.json` is the discovery manifest that dispatch uses to find and load a
module. The file must live at the module root.

Example:

```json
{
  "name": "payments",
  "version": "0.1.0",
  "entry": "dist/index.mjs",
  "metadata": {
    "generatedBy": "dispatch module init --typescript"
  }
}
```

Field meanings:

- `name` - Required module namespace. Must match `defineModule({ name })`.
- `version` - Required version string. Must match `defineModule({ version })`.
- `entry` - Required relative path to the runtime entry file. Use `index.mjs`
  for plain JavaScript or `dist/index.mjs` for a TS + tsup build.
- `metadata` - Optional tooling metadata. Dispatch preserves it for inspection
  but does not apply runtime behavior to it.
- `pack.include` - Optional list of extra runtime assets to ship when packing a
  module bundle. Use this for files outside the entry subtree, `jobs/`, and
  optional `README.md`.

A portable JSON Schema for this file ships at
`schemas/module.json.schema.json`.

## Runtime Entry

The runtime entry file must default-export the return value of
`defineModule(...)`.

Minimal example:

```ts
import { defineAction, defineModule } from 'dispatchkit';
import { z } from 'zod';

export default defineModule({
  name: 'payments',
  version: '0.1.0',
  actions: {
    ping: defineAction({
      description: 'Health check action.',
      schema: z.object({}),
      handler: async () => ({
        response: { ok: true },
        detail: 'pong',
      }),
    }),
  },
});
```

Rules:

- The default export must be the module object itself, not a factory.
- `module.json.name` must equal `defineModule({ name })`.
- `module.json.version` must equal `defineModule({ version })`.
- Action keys inside `actions` are suffixes only. Dispatch combines them with
  the module name, so `ping` becomes `payments.ping`.

## Authoring In TypeScript

TypeScript-authored modules are a first-class pattern. The recommended setup is
to keep source under `src/` and bundle an ESM runtime entry to `dist/index.mjs`.

Recommended dependencies in the module repo:

```bash
npm install dispatchkit zod
npm install -D tsup typescript
```

Recommended `tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  external: ['dispatchkit', 'zod'],
  clean: true,
  bundle: true,
  outDir: 'dist',
  outExtension() {
    return {
      js: '.mjs',
    };
  },
});
```

Keep `dispatchkit` and `zod` as dependencies of the module repo and externalize
them in the module bundle. That keeps the generated runtime entry small and
lets the module load the installed package surface directly.

Recommended `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tsup.config.ts"]
}
```

Set `module.json.entry` to `dist/index.mjs` when using this layout.

## Action Anatomy

### Handler Signature

```ts
import type { ActionContext, ActionResult } from 'dispatchkit';

async function myAction(ctx: ActionContext, payload: MyPayload): Promise<ActionResult> {
  return {
    response: { ok: true },
  };
}
```

`ctx` gives the handler access to:

- `ctx.http` - shared run-scoped HTTP transport with cookie/session continuity
- `ctx.artifacts` - run artifact manager for activity logging
- `ctx.runtime.steps` - prior step responses and exports
- `ctx.runtime.run` - run-level captured values and metadata
- `ctx.step` - the normalized job step currently executing
- `ctx.credential` - resolved credential object when the job binds a profile

See `dist/index.d.ts` for the detailed behavioral contract of each type.

### Schema Conventions

- Define Zod schemas in a dedicated `schemas.ts` or `schemas.mjs` file.
- Export inferred payload types alongside schemas for handler type safety.
- Use `.min(1)` on required strings so empty values fail validation early.
- Use `z.enum([...])` or typed lookup maps for fixed value sets.
- Keep the public schema intent-shaped. Do not expose raw wire payloads unless
  the wire shape is already the clearest user intent.

### The Intent To Wire Pattern

Module actions should expose an intent-shaped API and translate internally to
the service's transport or endpoint shape.

- Public schema: what the caller means
- Wire payload: what the endpoint expects
- Handler: the bridge between the two

Example:

- Public input: `{ state: 'archived' }`
- Internal wire payload: `{ lifecycle: { code: 'ARCHIVED', label: 'Archived' } }`

This keeps job files small, stable, and readable even when the backend API is
verbose or awkward.

### Constants And Lookup Data

- Keep stable paths, enum maps, and reusable labels in `constants.ts`.
- Use typed lookup maps when a compact public input resolves to a larger wire
  object.
- Export lookup types when they help keep handler code precise.

### Response vs Exports

Use `response` for the action's main result, especially when it mirrors the
backend response body.

Use `exports` for generated or derived values that later steps need but that do
not belong in the transport response. Examples:

- generated IDs
- normalized names
- computed timestamps
- request-local values assembled before the HTTP call

Declare an `exportsSchema` when an action returns exports so inspection and
schema commands can surface the available fields.

Jobs can promote exports into stable workflow names with step capture:

```json
{
  "id": "create-record",
  "action": "records.create",
  "capture": {
    "recordId": "exports.generatedId"
  }
}
```

Later steps can reference `${run.recordId}`.

### Credentials

When an action needs secrets:

1. Declare `credentialSchema` on the action definition.
2. Have the job declare a profile under `credentials.<name>.fromEnv`.
3. Bind the profile on the step with `"credential": "<name>"`.
4. Read the resolved object from `ctx.credential` inside the handler.

Do not accept secrets in the action payload.

### Activity Logging

Use `ctx.artifacts.appendActivity(...)` to log significant action-level events.

Recommended format:

```text
<action-name> key=value key=value
```

Example:

```ts
ctx.artifacts.appendActivity(`create-record recordId=${id} state=${state}`);
```

## Job Files

Modules can ship example jobs under `jobs/`.

Kinds:

- `*.job.case.json` - read-only case jobs
- `*.job.seed.json` - setup jobs that may write memory

Conventions for module-shipped jobs:

- Always declare `dependencies.modules` with the module name and version.
- Use `${env.*}` for environment-specific values such as base URLs or headers.
- Declare `dependencies.http.required` for any shared HTTP config the job
  expects.
- Use `metadata.notes` to explain what the job demonstrates.
- Keep shipped jobs realistic enough to exercise the public action surface.

## Validation

Validate a module from disk:

```bash
dispatch module validate --path ./modules/payments
```

Validation checks:

- `module.json` shape
- runtime entry existence and loadability
- module name and version match between `module.json` and `defineModule(...)`
- action schemas and handler wiring
- shipped job files and their declared dependencies

## Introspection

Inspect the loaded module:

```bash
dispatch module inspect payments
```

Inspect one action schema:

```bash
dispatch schema action --name payments.create-invoice --print
```

`schema action --print` surfaces:

- the action description
- input schema from `schema`
- export schema from `exportsSchema`, when declared
- credential schema from `credentialSchema`, when declared

## File Layout Example

```text
payments/
  module.json
  src/
    index.ts
    schemas.ts
    constants.ts
    create-invoice.ts
  dist/
    index.mjs
  jobs/
    create-invoice-minimal.job.case.json
  tsconfig.json
  tsup.config.ts
  README.md
```

This layout keeps the runtime entry declarative, schema definitions centralized,
and handler logic separated enough to scale as the module grows.
