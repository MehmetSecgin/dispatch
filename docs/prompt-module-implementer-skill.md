# Module Implementer Skill

Reusable prompt recipe for agents creating a dispatch module from scratch.

Your job is to create a complete dispatch module from a design document that describes the module domain, action surface, and wrapped API endpoints.

## Your inputs

1. **A design document** — describes the module purpose, full action surface, and for each action: the wire endpoint, field inventory, proposed public intent contract, normalization rules, and wire builder rules.
2. **The dispatch documentation** — read these repo-local files first, or their installed package equivalents when working outside this repo:
   - `dist/index.d.ts` when available — typed API with behavioral documentation
   - `MODULE_AUTHORING.md` — file structure, handler patterns, schema conventions
   - `CONVENTIONS.md` — design principles for intent-shaped actions
   - `schemas/module.json.schema.json` — `module.json` validation schema
   - `SKILL.md` — operator-facing job-authoring expectations and built-in module discovery
3. **Reference modules** (optional) — if the workspace already has other modules, read them to understand workspace-level conventions like `tsup` config shape, build scripts, and shared job patterns.

## Your outputs

A complete module directory containing:

1. `module.json`
2. `src/index.ts`
3. `src/schemas.ts`
4. `src/constants.ts`
5. `src/<action-name>.ts`
6. `jobs/<action-name>-minimal.job.case.json`
7. `tsconfig.json`
8. `tsup.config.ts`
9. `README.md`
10. `SKILL.md` when the repo uses agent-facing module guides

## How to work

### Step 1: Read the dispatchkit documentation

Before writing anything, read all package docs listed above. Understand:

- the `defineModule` / `defineAction` contract
- the `ActionContext` surface and what `ctx.http`, `ctx.artifacts`, `ctx.credential`, and `ctx.runtime` provide
- the `ActionResult` contract and when to use `response` vs `exports`
- schema conventions
- the intent-to-wire design pattern
- the recommended TypeScript file layout

### Step 2: Read existing workspace modules

If other modules exist in the workspace, read them to understand:

- how `tsup.config.ts` is structured
- how `tsconfig.json` is configured
- how build scripts are named
- how job files reference `http`, `dependencies`, and `credentials`
- code density and comment style

Match workspace conventions where they exist.

### Step 3: Read the design document

For each action, understand:

- the wire endpoint
- required vs optional wire fields
- the proposed public intent contract
- normalization and default rules
- the wire builder mapping table
- whether the action needs credentials, exports, or both

### Step 4: Plan the module

Before writing files, decide:

- module name
- version
- shared constants
- shared schema building blocks
- whether any actions need credential schemas
- the full action list and its natural ordering in `index.ts`

### Step 5: Implement

Work in this order to avoid forward-reference issues.

#### 5a. `constants.ts`

- Define the base API path as a named constant
- Derive per-action endpoint paths from it
- Add enum arrays and typed lookup maps when needed
- Export types needed by schemas or handlers

#### 5b. `schemas.ts`

- Define reusable sub-schemas first
- Define per-action payload schemas
- Define per-action export schemas when needed
- Define credential schemas when needed
- Export inferred types

Schema rules:

- required strings: `z.string().min(1)`
- required positive integers: `z.number().int().positive()`
- required non-negative integers: `z.number().int().nonnegative()`
- optional fields with handler-applied defaults: `.optional()`
- enum fields: `z.enum(MY_VALUES)`
- arrays that require at least one entry: `z.array(...).min(1)`

#### 5c. Handler files

Each handler should:

1. apply defaults and normalization
2. build the wire payload
3. log activity with `ctx.artifacts.appendActivity(...)`
4. make the HTTP request
5. validate the response with `ctx.http.requireOk(...)`
6. return an `ActionResult` with `detail`, `response`, and `exports` when needed

For actions with credentials:

- read `ctx.credential`
- fail clearly if the job did not bind a credential profile

#### 5d. `src/index.ts`

- Import `defineAction` and `defineModule`
- Import all handlers and schemas
- Default-export `defineModule({ name, version, actions: { ... } })`
- Wire each action with `defineAction({ description, schema, handler })`
- Add `exportsSchema` and `credentialSchema` when applicable

#### 5e. `module.json`

```json
{
  "name": "<module-name>",
  "version": "0.1.0",
  "entry": "dist/index.mjs"
}
```

Validate against `schemas/module.json.schema.json`.

#### 5f. `tsup.config.ts`

If the workspace has existing modules, copy their `tsup` pattern and adjust paths.

Otherwise use the default from `MODULE_AUTHORING.md`.

#### 5g. `tsconfig.json`

Match the workspace pattern when it exists. Otherwise use the default from `MODULE_AUTHORING.md`.

#### 5h. Job files

Create one minimal job per action under `jobs/`.

Rules:

- naming: `<action-name>-minimal.job.case.json`
- copy `http`, `dependencies`, and `credentials` patterns from existing workspace jobs
- include `metadata.notes`
- keep payloads minimal but valid
- follow the root `SKILL.md` discovery and validation loop before handing the jobs back

#### 5i. `README.md`

Document:

- current action surface
- authoring shape
- runtime assumptions
- supported endpoints
- behavioral notes

#### 5j. `SKILL.md`

If the repo uses module-level agent guides, create one that covers:

- each action
- payload fields
- exports
- prerequisites
- cross-action notes

### Step 6: Wire workspace integration

If the workspace root `package.json` has build scripts for other modules:

- add `build:<module-name>`
- add `module:validate:<module-name>`

### Step 7: Verify

After all files are written:

If the workspace has module-specific npm scripts:

1. run `npm run build:<module-name>`
2. run `npm run typecheck`
3. run `npm run lint`
4. run `npm run module:validate:<module-name>`

If the workspace does not:

1. run `tsup`
2. run `dispatch module validate --path .` for a standalone module repo, or `dispatch module validate --path ./modules/<module-name>` in a workspace

Fix any errors before finishing.

## Things to avoid

- Do not bundle multiple modules into one
- Do not add dependencies beyond `dispatchkit` and `zod` without explicit instruction
- Do not add test files unless asked
- Do not invent actions beyond the design document
- Do not add speculative abstractions
- Do not accept secrets in action payloads; use credential schemas
- Do not create cross-module job files inside a module directory
