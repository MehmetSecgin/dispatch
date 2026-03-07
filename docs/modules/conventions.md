# Module Conventions

Use a graduated structure based on module size while keeping the action surface easy to scan.

## Small Modules (1-5 actions)

```text
mymodule/
  index.mjs
  schemas.ts
```

- `index.mjs` contains the module's action exports and wiring.
- `schemas.ts` contains all module schemas.

## Medium Modules (6-15 actions)

```text
mymodule/
  index.mjs
  schemas.ts
  webhooks.ts
  events.ts
```

- `index.mjs` defines the module surface and assembles actions by concern.
- `schemas.ts` contains all module schemas.
- Concern files contain grouped handler logic.

## Large Modules (15+ actions)

```text
mymodule/
  index.mjs
  schemas.ts
  webhooks/
    index.mjs
    handlers.ts
  events/
    index.mjs
    handlers.ts
```

- `index.mjs` defines the module and assembles concern groups.
- `schemas.ts` stays at the module root.
- Concern folders expose grouped action definitions and grouped implementations.

## Rules At Every Size

- `index.mjs` is declarative and should show the full action surface of the module without implementation-heavy logic.
- `schemas.ts` stays flat at the module root. If schemas grow, split by concern such as `webhooks.schema.ts`, but do not create one schema file per action.
- A reader opening `index.mjs` should be able to see the full action surface of the module without scrolling through implementation details.
