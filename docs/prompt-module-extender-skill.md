# Module Extender Skill

Reusable prompt recipe for agents extending an existing dispatch module.

Your job is to add new actions to an existing dispatch module, working from a discovery document that describes the API endpoint and a proposed public intent contract.

## Your inputs

1. **A discovery document** — describes the wire endpoint, field inventory, service behavior, proposed public contract, normalization rules, and wire builder rules.
2. **The dispatch documentation** — read these repo-local files first, or their installed package equivalents when working outside this repo:
   - `dist/index.d.ts` when available — typed API with behavioral documentation
   - `MODULE_AUTHORING.md` — file structure, handler patterns, schema conventions
   - `CONVENTIONS.md` — design principles for intent-shaped actions
   - `schemas/module.json.schema.json` — `module.json` validation schema
   - `SKILL.md` — operator-facing job-authoring expectations and built-in module discovery
3. **The existing module source** — when adding an action to an existing module, read all current source files to understand established patterns, naming conventions, and shared infrastructure.

## Your outputs

For each action you implement, produce:

1. **Schema additions** in `schemas.ts` — Zod schema for the payload, inferred type export
2. **Constants additions** in `constants.ts` — endpoint path, any new lookup maps or shared values
3. **Handler file** — a new `<action-name>.ts` file with the handler function
4. **Index wiring** — updated `index.ts` that imports and registers the new action via `defineAction`
5. **Example job file** — a minimal `.job.case.json` under `jobs/`
6. **README update** — add the new action to the module's `README.md`
7. **SKILL.md update** — add the new action to the module's `SKILL.md` agent guide, only if `SKILL.md` exists in the module

## How to work

### Step 1: Read the existing module

Before writing anything, read every source file in the module. Understand:

- how schemas are structured
- how constants are organized
- how handlers are written
- how `index.ts` wires actions
- how existing job files are structured
- whether `SKILL.md` exists and how it documents the action surface

Match these patterns exactly. Do not introduce new conventions.

### Step 2: Read the discovery document

Understand:

- the wire endpoint (method, path, request/response shape)
- which fields are required vs optional at the wire level
- the proposed public intent contract
- the normalization and default rules
- the wire builder mapping table

### Step 3: Implement

Follow these rules.

**Schemas**

- Add the new payload schema to `schemas.ts`
- Follow the existing naming pattern
- Export the inferred type
- Use the same validation patterns as existing schemas
- If the discovery doc says a field is required in the public contract, make it required in the schema
- If the discovery doc says a field has a default, make it optional in the schema

**Constants**

- Add the endpoint path to `constants.ts`
- Add any new lookup maps, enum values, or shared constants
- Follow existing naming and export patterns

**Handler**

- Create a new file named after the action
- Import types from `dispatchkit` (`ActionContext`, `ActionResult`)
- Import constants and types from local files
- Build the wire payload from the public input following the discovery doc
- Apply defaults and normalization as specified
- Log activity with `ctx.artifacts.appendActivity(...)` following the existing convention
- Use `ctx.http.<method>(...)` and `ctx.http.requireOk(...)`
- Return an `ActionResult` with appropriate `detail`
- If the action generates values that later steps need, return them under `exports`
- Keep the handler focused; extract a helper if the translation is complex

**Index wiring**

- Add the import for the new handler and schema
- Add the new action to the `actions` record in `defineModule`
- Follow the existing description style
- Add `exportsSchema` if the action declares exports
- Add `credentialSchema` if the action requires credentials

**Job file**

- Create a minimal example job under `jobs/`
- Follow the naming pattern of existing jobs
- Include `schemaVersion`, `jobType`, `http`, `dependencies`, `scenario`, and `metadata` when the module's existing jobs do
- Copy the `http` and `dependencies` patterns from existing module jobs exactly
- Use the minimal required payload from the public contract
- Add `metadata.notes` explaining what the job demonstrates and any prerequisites
- Follow the root `SKILL.md` discovery and validation loop before handing the job back

**README**

- Add the new action to the action surface list
- Add the endpoint to the supported endpoints list
- Add relevant behavioral notes

**SKILL.md** (only if the file exists in the module)

- Add a new action section following the existing format
- Include the payload table, export contract, and any prerequisites or behavioral notes specific to the action

### Step 4: Verify

After implementation:

If the workspace has module-specific npm scripts:

- Run `npm run build:<module-name>`
- Run `npm run typecheck`
- Run `npm run lint`
- Run `npm run module:validate:<module-name>`

If the workspace does not use module-specific npm scripts:

- Run `tsup --config modules/<module-name>/tsup.config.ts` when applicable
- Run `dispatch module validate --path ./modules/<module-name>`

Fix errors before finishing.

## Things to avoid

- Do not change existing action implementations unless the discovery doc requires it
- Do not refactor existing code just to accommodate the new action
- Do not add new dependencies
- Do not change the module name or metadata
- Do not bump the module version unless repo conventions require it
- Do not modify existing job files
- Do not add test files unless the task explicitly asks for them
- Do not add comment-heavy code if the module does not already use that style
