# Plan: `dispatch run` — Single Action Execution

## Context

The dispatch CLI currently requires a job case file (JSON with `scenario.steps`) to execute any action. This is heavy for the primary use case: an AI agent (or GUI) wants to call one action, see the result, and move on. `dispatch run` acts like Postman — point at an action, pass inputs, get output. It is also phase 1 of a future GUI: the action's Zod schema defines "form fields", `dispatch run` is the execution backend.

---

## Command Interface

```
dispatch run <module.action> \
  --input status=PREMATCH \
  --input items='[{"id":3743}]' \
  --base-url https://example.com \
  --header x-brand=example \
  --credential token=API_TOKEN
```

---

## JSON Output Contract

`dispatch run` follows the same machine-output envelope contract as `dispatch job run`. Agents already depend on `cliVersion`, `runId`, `runDir`, and `next[]` in the envelope.

### Success (`--json`)

```json
{
  "cliVersion": "0.0.1",
  "action": "jsonplaceholder.list-posts",
  "status": "SUCCESS",
  "runId": "20260325-091245-action-run-abc1",
  "runDir": "~/.dispatch/run-output/20260325-091245-action-run-abc1",
  "response": { ... },
  "exports": { ... },
  "detail": "Listed 3 posts",
  "next": [
    {
      "command": "dispatch job readable --run-id 20260325-091245-action-run-abc1",
      "description": "full request/response trace"
    }
  ]
}
```

Fields `response`, `exports`, `detail` come from `ActionResult`. Fields `cliVersion`, `status`, `runId`, `runDir`, `next` match the envelope contract.

### Failure (`--json`)

Uses the standard `jsonErrorEnvelope()`:
```json
{
  "status": "error",
  "code": "RUNTIME_ERROR",
  "retryable": false,
  "message": "...",
  "details": { "runId": "...", "runDir": "..." },
  "next": [
    {
      "command": "dispatch job readable --run-id ...",
      "description": "full request/response trace"
    }
  ]
}
```

### Next actions for `dispatch run`

New function `nextActionsForActionRun()` in `src/job/next-actions.ts`:

| Outcome | Next actions |
|---------|-------------|
| SUCCESS | `dispatch job readable --run-id {runId}` — view trace |
| FAILURE | `dispatch job readable --run-id {runId}` — view trace |

Kept minimal — a single action in both cases since there's no assert/replay flow for standalone runs.

---

## Input Coercion Model

`--input` flags are flat `key=value` pairs. Coercion operates on **top-level schema properties only**:

- Scalar top-level fields (`string`, `number`, `boolean`) are coerced from the string value.
- Complex top-level fields (`array`, `object`) must be passed as JSON strings: `--input items='[1,2,3]'`.
- Nested addressing (e.g. `--input foo.bar=1`) is **not supported** — the `.` is treated as part of the key name, which Zod will reject if the schema doesn't declare it.

This is an intentional simplification. The future GUI phase will have field-level structured input via the Zod schema; the CLI is for quick scripted calls where JSON-in-a-flag is acceptable.

---

## Run Artifacts

`dispatch run` is **not a job run** — it has no job case, no multi-step orchestration, no interpolation. But it produces run artifacts that integrate with existing tooling (`dispatch job list`, `dispatch job latest`, `dispatch job readable`, `dispatch job inspect`).

| File | Written by | When | Purpose |
|------|-----------|------|---------|
| `meta.json` | `run.ts` (explicit `writeJson`) | Before handler call | Run identity |
| `module_resolution.json` | `run.ts` (explicit `writeJson`) | Before handler call | Module audit |
| `summary.json` | `run.ts` (explicit `writeJson`) | After handler returns | Makes run visible to `dispatch job latest` / `dispatch job list` |
| `activity.log` | `RunArtifacts` (via `ctx.artifacts.appendActivity()`) | During execution | Human timeline |
| `http_calls.jsonl` | `HttpTransportImpl` (automatic) | During execution | HTTP trace |
| `calls/*.json` | `HttpTransportImpl` (automatic) | During execution | Request/response bodies |

**Not written** (job-specific, not applicable):
- `job.case.input.json` — no job case
- `job.case.resolved.json` — no interpolation
- `step-results.json` — single step, result is in CLI output

`meta.json` shape:
```json
{
  "cliVersion": "0.0.1",
  "action": "jsonplaceholder.list-posts",
  "runId": "20260325-091245-action-run-abc1",
  "startedAt": "2026-03-25T09:12:45.000Z"
}
```

`summary.json` shape (compatible with `RunSummaryRecord` consumed by `dispatch job latest`/`dispatch job list`):
```json
{
  "runId": "20260325-091245-action-run-abc1",
  "runDir": "~/.dispatch/run-output/20260325-091245-action-run-abc1",
  "jobType": "action-run:jsonplaceholder.list-posts",
  "startedAt": "2026-03-25T09:12:45.000Z",
  "status": "SUCCESS"
}
```

`jobType` is set to `action-run:<actionKey>` so listing output distinguishes action runs from job runs while remaining a valid string for existing tooling (all `RunSummaryRecord` fields are optional strings).

`module_resolution.json` shape: same as job runs — `generatedAt`, `warnings`, `conflicts`, `loadedModules`, plus a single-element `steps` array.

---

## Module Discovery

Job commands pass `searchFrom: [path.dirname(casePath)]` to `loadModuleRegistry()` so workspace-local modules resolve when invoked from outside the repo root. `dispatch run` has no case file path to anchor from.

Strategy: call `loadModuleRegistry()` with no `searchFrom` override. It defaults to `[process.cwd(), ROOT_DIR]`, which covers:
- Running from the workspace root (standard agent/developer workflow)
- User-installed modules in `~/.dispatch/modules/`
- Builtin modules (always loaded)

**Known limitation:** `dispatch run mymod.action` invoked from outside the workspace will **not** find repo-local modules, even though `dispatch job run --case /abs/path/to/case.json` would (because it anchors discovery to the case file's directory). This is an intentional phase-1 simplification — there is no case file to anchor from. Workarounds:
- `cd` into the workspace before running
- Install the module to `~/.dispatch/modules/` (user layer)

If this becomes a friction point, a future `--workspace <dir>` flag can be added to pass as `searchFrom`.

---

## Files to Create/Modify

### 1. `src/execution/schema-coerce.ts` (NEW)

Schema-driven coercion: takes flat `Record<string, string>` from `--input` and the action's Zod schema, returns a typed payload.

```ts
export function coerceInputsFromSchema(
  rawInputs: Record<string, string>,
  schema: z.ZodSchema
): { payload: Record<string, unknown>; issues: string[] }
```

**Flow:**
1. Convert schema to JSON Schema via `schemaToJsonSchema()` from `src/modules/schema-contracts.ts`
2. For each input key, resolve the effective type of the **top-level** property from JSON Schema `.properties`
3. Coerce based on resolved type:
   - `"string"` → keep as-is
   - `"number"` / `"integer"` → `Number(value)`, reject if `NaN`
   - `"boolean"` → `"true"` / `"false"` literal match
   - `"array"` or `"object"` → `JSON.parse(value)`, report parse errors
   - unknown/missing property → try `JSON.parse`, fallback to string (let Zod catch unknown keys)
4. Collect all coercion issues but continue (don't fail on first error)

**Type resolution helper** — `resolveEffectiveType(node)`:

JSON Schema from `z.toJSONSchema()` isn't always a flat `{ type: "string" }`. Handle:
- Direct `.type` field → return it
- `.enum` array present → infer `"string"` (or `"number"` if all values are numeric)
- `.anyOf` / `.oneOf` → filter out `{ not: {} }` (Zod's encoding of optional), return the type of the remaining variant. If multiple real variants remain, return `"unknown"` (let JSON.parse + fallback handle it)
- `.const` → infer from the value's JS type
- No type info → `"unknown"`

### 2. `src/commands/run.ts` (NEW)

New command handler.

```ts
export function registerRunCommand(
  program: Command,
  deps: { cliVersion: string },
): void
```

**Command definition:**
- `dispatch run <action>` — positional arg for `module.action`
- `--input <key=value>` — repeatable
- `--base-url <url>` — HTTP base URL
- `--header <key=value>` — repeatable, HTTP headers
- `--credential <field=ENV_VAR>` — repeatable, direct env-var credential mapping

`collectRepeatedOption` is inlined (3-line function, not worth extracting from `job.ts`):
```ts
function collectRepeatedOption(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}
```

**Handler flow:**

```
 1. Parse global opts (--json, --verbose, --color)
 2. loadModuleRegistry() → resolve action, fail fast if not found
 3. parseRawInputs(inputFlags) → Record<string, string>
 4. coerceInputsFromSchema(rawInputs, action.schema) → typed payload
 5. loadActionDefaults() → defaultsMap
 6. applyActionDefaults(actionKey, coercedPayload, defaultsMap) → merged payload
 7. action.schema.safeParse(merged) → validate, fail with issues if invalid
 8. Resolve credentials (if action has credentialSchema):
    a. Parse --credential pairs into { field: envVarName }
    b. Read env vars, fail if missing
    c. Validate against credentialSchema.safeParse()
    d. If action requires credentials and none passed → fail with helpful message
    e. If --credential passed but action has no credentialSchema → warn and ignore
 9. Create RunArtifacts('action-run')
10. Write meta.json: { cliVersion, action: actionKey, runId, startedAt }
11. Write module_resolution.json: { generatedAt, warnings, conflicts, loadedModules, steps: [single entry] }
12. Create HttpTransportImpl(artifacts, { baseUrl, defaultHeaders, poolRegistry: getDefaultHttpPoolRegistry() })
13. Create RuntimeContext via defaultRuntime(cliVersion)
14. Synthesize JobStep: { id: 'run', action: actionKey, payload: mergedPayload }
15. Build ActionContext:
    {
      http,
      artifacts,
      runtime,
      step,
      credential,
      resolve: registry.resolve.bind(registry),
    }
16. Call handler in try/catch:
    - success → write summary.json (status: SUCCESS), build envelope, compute next actions, render
    - throw → write summary.json (status: FAILED), wrap in cliErrorFromCode(), include runId/runDir in details, compute next actions, render via jsonErrorEnvelope()
17. Render result:
    - --json: full envelope (see JSON Output Contract above)
    - human: brief summary line + JSON response body
```

**Key reuse points:**
- `parseRawInputs()` from `src/job/inputs.ts` (newly exported)
- `applyActionDefaults()` + `loadActionDefaults()` from `src/execution/action-defaults.ts`
- `loadModuleRegistry()` from `src/modules/index.ts`
- `buildResolutionRow()` from `src/modules/conflicts.ts`
- `defaultRuntime()` from `src/data/run-data.ts`
- `RunArtifacts` from `src/artifacts/run-artifacts.ts`
- `HttpTransportImpl` from `src/transport/http.ts`
- `getDefaultHttpPoolRegistry()` from `src/services/http-pool.ts`
- `writeJson()` from `src/utils/fs-json.ts`
- `nowIso()` from `src/core/time.ts`
- `cliErrorFromCode()`, `jsonErrorEnvelope()`, `exitCodeForCliError()` from `src/core/errors.ts`
- `createRenderer`, `isColorEnabled`, `paint` from `src/output/renderer.ts`

### 3. `src/job/inputs.ts` (MODIFY)

Export `parseRawInputs`:

```diff
-function parseRawInputs(rawInputs: string[]): ...
+export function parseRawInputs(rawInputs: string[]): ...
```

Single keyword change. No other modifications.

### 4. `src/job/next-actions.ts` (MODIFY)

Add `nextActionsForActionRun`:

```ts
export function nextActionsForActionRun(input: {
  runId: string;
}): NextAction[] {
  return renderNextActions(
    [
      {
        command: 'dispatch job readable --run-id {runId}',
        description: 'full request/response trace',
      },
    ],
    { runId: input.runId },
  );
}
```

Follows the existing pattern of `nextActionsForJobRun`, `nextActionsForJobAssert`, `nextActionsForRunMany`.

### 5. `src/cli.ts` (MODIFY)

Wire up the new command:

```diff
+import { registerRunCommand } from './commands/run.js';
 ...
 registerJobCommands(program, { cliVersion: CLI_VERSION });
+registerRunCommand(program, { cliVersion: CLI_VERSION });
 registerModuleCommands(program, { cliVersion: CLI_VERSION });
```

---

## Credential Handling

Jobs use named profiles (`credentials.myProfile.fromEnv`). Standalone runs simplify:

```
dispatch run api.create-user \
  --credential token=API_TOKEN \
  --credential secret=API_SECRET
```

Maps to `{ token: process.env.API_TOKEN, secret: process.env.API_SECRET }`, validated against `action.credentialSchema`.

| Scenario | Behavior |
|----------|----------|
| Action has `credentialSchema`, `--credential` provided | Resolve env vars, validate, pass as `ctx.credential` |
| Action has `credentialSchema`, no `--credential` | Fail with message showing required fields |
| No `credentialSchema`, `--credential` provided | Warn and ignore |
| No `credentialSchema`, no `--credential` | Normal — no credential needed |

---

## What We Skip

- No interpolation (`${step.X}` — single step, no references)
- No capture
- No scenario/steps wrapping
- No job-level validation (no job file)
- No scheduling (`atRelative`/`atAbsolute`)
- No nested input addressing (`--input foo.bar=1` is not supported)
- No `--workspace` flag (CWD-based module discovery is sufficient for phase 1; see Module Discovery section)
- No outside-workspace module resolution (unlike job commands which anchor from case file path)

---

## Implementation Order

1. Export `parseRawInputs` from `src/job/inputs.ts`
2. Add `nextActionsForActionRun` to `src/job/next-actions.ts`
3. Create `src/execution/schema-coerce.ts` with `coerceInputsFromSchema()` + `resolveEffectiveType()`
4. Create `src/commands/run.ts` with `registerRunCommand()`
5. Wire up in `src/cli.ts`
6. Tests

---

## Verification

1. **Unit test `coerceInputsFromSchema()`** — cover:
   - Simple types: string, number, boolean
   - Enum schemas (Zod `z.enum()`)
   - Optional fields (`z.string().optional()` — `anyOf` unwrapping)
   - Array and object values via JSON.parse (top-level only)
   - Coercion failure cases (NaN, bad boolean, invalid JSON)
   - Unknown keys (should pass through, let Zod reject)

2. **Unit test `resolveEffectiveType()`** — cover:
   - Direct `{ type: "string" }`
   - `{ enum: ["A", "B"] }` → string
   - `{ anyOf: [{ type: "string" }, { not: {} }] }` → string (optional unwrapping)
   - `{ anyOf: [{ type: "string" }, { type: "number" }] }` → unknown (ambiguous)
   - No type info → unknown

3. **Integration test `dispatch run`** against a test module:
   ```
   dispatch run jsonplaceholder.list-posts --input userId=1 --input limit=3 --json
   ```
   Verify the JSON envelope includes `cliVersion`, `status`, `runId`, `runDir`, `next[]`, `response`.

4. **Artifact verification** — after a run, check that `meta.json`, `module_resolution.json`, and `summary.json` exist in the run directory with expected fields. Verify `dispatch job list` shows the action run with `jobType` = `action-run:<actionKey>`.

5. **Credential test** — action with `credentialSchema`, verify env var resolution and validation.

6. **Error cases:**
   - Unknown action → NOT_FOUND with `next: []`
   - Missing required fields → USAGE_ERROR with Zod issues
   - Coercion failures → USAGE_ERROR with details
   - Missing `--base-url` when handler makes HTTP call → clear error
   - Missing required credentials → USAGE_ERROR listing required fields
   - Handler throws → RUNTIME_ERROR or TRANSIENT_ERROR (inferred from message), includes `runId`/`runDir` in details and `next[]`

7. **JSON contract test** — verify `--json` output shape matches the documented envelope (has `cliVersion`, `status`, `runId`, `runDir`, `next`).

8. **Regression** — run existing test suite to confirm no breakage.
