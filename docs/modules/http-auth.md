# HTTP Auth and Session Behavior

`ctx.http` now supports simple cookie-backed auth flows automatically.

Jobs can declare shared base URLs and default headers with the top-level `http` block,
and handlers can still derive explicit child clients via `ctx.http.withDefaults(...)`
when they need narrower defaults inside a run.

Jobs can also bind env-backed credential profiles so auth actions do not need plaintext
usernames/passwords in job payloads.

## What module authors should assume

- Cookies are captured from `Set-Cookie` response headers.
- Matching cookies are sent on later requests in the same job run.
- Cookie state is scoped to the current run only.
- Cookies are not persisted across runs.
- Modules should not store session cookies in `memory`.

This means an auth module can be simple:

1. `admin.login` receives a resolved credential object from `ctx.credential`.
2. The server returns session cookies.
3. Later actions such as `admin.me` or `admin.create-user` reuse that session automatically.

No module-level cookie jar or manual cookie plumbing is needed.

Example:

```json
{
  "credentials": {
    "adminQa": {
      "fromEnv": {
        "username": "DISPATCH_ADMIN_USERNAME",
        "password": "DISPATCH_ADMIN_PASSWORD"
      }
    }
  },
  "scenario": {
    "steps": [
      {
        "id": "login",
        "action": "admin.login",
        "credential": "adminQa",
        "payload": {}
      }
    ]
  }
}
```

And the action contract:

```js
defineAction({
  description: 'Log in to the admin surface.',
  schema: z.object({}),
  credentialSchema: z.object({
    username: z.string(),
    password: z.string(),
  }),
  handler: async (ctx) => {
    const credential = ctx.credential;
    // ...
  },
});
```

For stable request config that is shared across the whole run, declare it in the job:

```json
{
  "http": {
    "baseUrl": "https://api.example.com",
    "defaultHeaders": {
      "x-client": "dispatch"
    }
  }
}
```

If your module intentionally relies on job-level HTTP config, make the requirement explicit:

```json
{
  "dependencies": {
    "http": {
      "required": ["baseUrl", "defaultHeaders.x-client"]
    }
  }
}
```

That keeps transport ownership at the job level while making missing config fail as a preflight error instead of a later request-time surprise.

For stable request config that is shared across multiple calls inside one handler/helper,
derive a scoped client explicitly:

```js
const api = ctx.http.withDefaults({
  baseUrl: payload.baseUrl,
  defaultHeaders: {
    authorization: `Bearer ${payload.token}`,
    'x-client': 'dispatch',
  },
});

const me = await api.get('/me');
```

This keeps auth/session continuity automatic while keeping shared request config explicit
at both the job and handler levels.

If a login or setup action also generates a same-run workflow value that later steps need,
return it under `exports` so the job can reference `step.<id>.exports.*` without inventing
response fields or persisting secrets in `memory`.

## What belongs in a module

Modules should define auth intent, not transport session mechanics.

Good examples:

- `admin.login`
- `admin.logout`
- `admin.me`
- `admin.create-user`

Avoid:

- reading raw `Set-Cookie` headers in module code
- saving cookies into `memory`
- reading ad hoc env vars directly inside handlers when a credential profile would do
- building manual `Cookie` headers unless there is a very specific non-session need
- rebuilding the same base URL and shared headers by hand for every request when a scoped
  `ctx.http.withDefaults(...)` client would do

## Scope and limits

The transport handles the common session-cookie case:

- host/domain matching
- path matching
- `secure` cookies only over `https`
- expiry handling

This is intentionally run-scoped session support, not a full long-lived auth profile system.

## Security notes

- Cookie values are redacted from curl previews and transport call logs.
- Request/response body artifact behavior is unchanged.
- Credential values are resolved at runtime from env-backed profiles and are not part of job payloads.
- If a workflow needs durable credentials later, that should be a separate explicit auth/profile feature, not `memory`.
