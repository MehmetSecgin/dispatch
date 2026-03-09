# Module Conventions

Use a graduated structure based on module size while keeping the action surface easy to scan.

`module.json` is for discovery metadata and runtime entry resolution.

The runtime entry should default-export the full module object, typically using `defineModule(...)` and `defineAction(...)`.

External modules may be authored directly in `.mjs`, but a TS-authored module compiled to a built JS entry is also a first-class pattern. In that case, `module.json.entry` should point at the built file.

Reference example:

- [`modules/jsonplaceholder`](../../modules/jsonplaceholder)
  A public repo module showing action definitions, schemas, case jobs, and a seed job.

Related guidance:

- [HTTP auth and session behavior](http-auth.md)
  Use `ctx.http` for cookie-backed auth flows, and `ctx.http.withDefaults(...)` for explicit shared base URLs and headers.

## Small Modules (1-5 actions)

```text
mymodule/
  module.json
  index.mjs
  schemas.mjs
```

- `module.json` points at the runtime entry.
- `index.mjs` contains the module's action wiring and default module export.
- `schemas.mjs` contains all module schemas.

## Medium Modules (6-15 actions)

```text
mymodule/
  module.json
  index.mjs
  schemas.mjs
  webhooks.mjs
  events.mjs
```

- `module.json` points at the runtime entry.
- `index.mjs` defines the module surface and assembles actions by concern.
- `schemas.mjs` contains all module schemas.
- Concern files contain grouped handler logic.

## Large Modules (15+ actions)

```text
mymodule/
  module.json
  index.mjs
  schemas.mjs
  webhooks/
    index.mjs
    handlers.mjs
  events/
    index.mjs
    handlers.mjs
```

- `module.json` points at the runtime entry.
- `index.mjs` defines the module and assembles concern groups.
- `schemas.mjs` stays at the module root.
- Concern folders expose grouped action definitions and grouped implementations.

## Rules At Every Size

- `index.mjs` is declarative and should show the full action surface of the module without implementation-heavy logic.
- `schemas.mjs` stays flat at the module root. If schemas grow, split by concern such as `webhooks.schema.mjs`, but do not create one schema file per action.
- A reader opening `index.mjs` should be able to see the full action surface of the module without scrolling through implementation details.
- Prefer `defineModule(...)` + `defineAction(...)` so schema and handler definitions stay together.
- Ship at least one realistic case job. The `jsonplaceholder` module is a good reference for this.
- Prefer relative HTTP paths in handlers when the job should supply shared API context through the top-level `http` block.
- If a module has login/session behavior, let `ctx.http` own the cookie session for the current run instead of saving cookies in module state or `memory`.
- If a module repeatedly calls the same API in one action or helper, derive a scoped client with `ctx.http.withDefaults(...)` instead of manually rebuilding the same base URL and shared headers on every request.
- If an action generates a same-run workflow value that later steps need, return it in `exports` rather than inventing a fake response field or writing to durable memory.
- If those exports are part of the intended action contract, declare them with `exportsSchema` so `module inspect` and `schema action` can surface them.
- If a job wants stable workflow-level names, let the job capture selected export values into `run.*` instead of hard-coding later steps to module-specific export keys.
