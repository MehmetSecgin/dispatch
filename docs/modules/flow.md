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
  "jobType": "jsonplaceholder-poll",
  "http": {
    "baseUrl": "https://jsonplaceholder.typicode.com"
  },
  "scenario": {
    "steps": [
      {
        "id": "wait-for-post",
        "action": "flow.poll",
        "payload": {
          "action": "jsonplaceholder.get-post",
          "payload": { "id": 7 },
          "intervalMs": 500,
          "maxDurationMs": 5000,
          "maxAttempts": 3,
          "conditions": {
            "mode": "ALL",
            "rules": [
              { "path": "$.id", "op": "eq", "value": 7 },
              { "path": "$.title", "op": "exists" },
              { "path": "$.title", "op": "regex", "value": ".*magnam.*" }
            ]
          },
          "store": {
            "postTitle": "$.title",
            "postId": "$.id"
          }
        }
      }
    ]
  }
}
```
