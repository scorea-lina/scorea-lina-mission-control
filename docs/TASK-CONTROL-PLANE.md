# Task Control Plane (Mission Control)

Mission Control exposes a minimal, API-key-protected control plane for task status updates.

## Auth

All endpoints require:

- Header: `x-api-key: <API_KEY>`

The server reads `API_KEY` from environment.

## Runtime store

Task control-plane state is mirrored to:

- `~/.openclaw/mission-control/tasks.json`

Writes are atomic (tmp + rename; best-effort fsync).

## Endpoints

### List tasks

```bash
curl -sS -H "x-api-key: dev-local" \
  https://astras-mac-mini.tail7d85b8.ts.net/api/tasks | head
```

### Read one task

```bash
curl -sS -H "x-api-key: dev-local" \
  https://astras-mac-mini.tail7d85b8.ts.net/api/tasks/3 | head
```

### Update status (idempotent)

```bash
curl -sS -H "x-api-key: dev-local" -H "content-type: application/json" \
  -X PATCH -d {status:in_progress} \
  https://astras-mac-mini.tail7d85b8.ts.net/api/tasks/3 | head
```

Allowed statuses:
- `assigned`
- `in_progress`
- `in_review`
- `ready`
- `done`

### Export/snapshot

```bash
curl -sS -H "x-api-key: dev-local" \
  https://astras-mac-mini.tail7d85b8.ts.net/api/tasks/export | head
```

Returns JSON and also writes a timestamped snapshot alongside `tasks.json`.
