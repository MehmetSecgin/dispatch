# Job Validation and Interpolation References

## Status

- Type: framework limitation
- Priority: high
- Affects: static validation of cross-module jobs

## Problem

Static job validation currently rejects full interpolation expressions in typed
non-string payload fields, even when runtime interpolation preserves the final
type.

Example failure shape:

```json
{
  "payload": {
    "itemId": "${step.lookup.response.eventId}"
  }
}
```

Typical validation error:

```text
payload.itemId: expected number, received string
```

## Why This Matters

- Cross-module workflows often translate one action's output into another
  action's typed payload.
- Full-expression interpolation can preserve runtime types, but static
  validation runs before that interpolation is applied.
- The result is a false-negative validation failure on otherwise valid jobs.

## Acceptable Fix Directions

1. Teach static validation to defer or relax schema checks for full `${...}`
   interpolation expressions.
2. Extend the validation layer so typed fields can explicitly accept
   interpolation references while remaining strict for literal values.

## Out of Scope

- Do not treat this as a job-authoring mistake in docs or eval scoring.
- Do not require module authors to widen schemas as the default workaround.
