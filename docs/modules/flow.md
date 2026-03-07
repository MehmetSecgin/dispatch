# Module: flow

Generic orchestration primitives.

## Actions

- `flow.sleep`
  - Pause execution for a deterministic duration.
- `flow.poll`
  - Repeatedly invoke another namespaced action until JSONPath conditions match or limits are reached.

## `flow.poll` payload

- `action` (required): target action key (`module.action`)
- `payload` (optional): target payload
- `intervalMs` (default `1000`): `250..5000`
- `maxDurationMs` (default `45000`): `1000..180000`
- `maxAttempts` (optional): `1..120`
- `minSuccessAttempts` (default `1`)
- `continueOnActionError` (default `true`)
- `conditions` (required): condition group tree
- `store` (optional): `{ runtimeKey: jsonPath }`

## Example

```json
{
  "schemaVersion": 1,
  "jobType": "poll-example",
  "scenario": {
    "steps": [
      {
        "id": "wait",
        "action": "flow.poll",
        "payload": {
          "action": "probe.get",
          "payload": { "id": "${run.targetId}" },
          "intervalMs": 1000,
          "maxDurationMs": 15000,
          "conditions": {
            "mode": "ALL",
            "rules": [
              { "path": "$.ready", "op": "eq", "value": true }
            ]
          },
          "store": {
            "resourceId": "$.id"
          }
        }
      }
    ]
  }
}
```
