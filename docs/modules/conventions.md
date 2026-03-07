# Module Conventions

Use a graduated structure based on module size while keeping the action surface easy to scan.

## Small Modules (1-5 actions)

```text
mymodule/
  index.mjs
  schemas.mjs
```

- `index.mjs` contains the module's action exports and wiring.
- `schemas.mjs` contains all module schemas.

## Medium Modules (6-15 actions)

```text
mymodule/
  index.mjs
  schemas.mjs
  webhooks.mjs
  events.mjs
```

- `index.mjs` defines the module surface and assembles actions by concern.
- `schemas.mjs` contains all module schemas.
- Concern files contain grouped handler logic.

## Large Modules (15+ actions)

```text
mymodule/
  index.mjs
  schemas.mjs
  webhooks/
    index.mjs
    handlers.mjs
  events/
    index.mjs
    handlers.mjs
```

- `index.mjs` defines the module and assembles concern groups.
- `schemas.mjs` stays at the module root.
- Concern folders expose grouped action definitions and grouped implementations.

## Rules At Every Size

- `index.mjs` is declarative and should show the full action surface of the module without implementation-heavy logic.
- `schemas.mjs` stays flat at the module root. If schemas grow, split by concern such as `webhooks.schema.mjs`, but do not create one schema file per action.
- A reader opening `index.mjs` should be able to see the full action surface of the module without scrolling through implementation details.
