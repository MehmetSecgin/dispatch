# HTTP Auth and Session Behavior

`ctx.http` now supports simple cookie-backed auth flows automatically.

It also supports explicit child clients via `ctx.http.withDefaults(...)` for shared base
URLs and headers inside a run.

## What module authors should assume

- Cookies are captured from `Set-Cookie` response headers.
- Matching cookies are sent on later requests in the same job run.
- Cookie state is scoped to the current run only.
- Cookies are not persisted across runs.
- Modules should not store session cookies in `memory`.

This means an auth module can be simple:

1. `admin.login` posts credentials.
2. The server returns session cookies.
3. Later actions such as `admin.me` or `admin.create-user` reuse that session automatically.

No module-level cookie jar or manual cookie plumbing is needed.

For stable request config that is shared across multiple calls, derive a scoped client
explicitly:

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

This keeps auth/session continuity automatic while keeping shared request config explicit.

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
- If a workflow needs durable credentials later, that should be a separate explicit auth/profile feature, not `memory`.
