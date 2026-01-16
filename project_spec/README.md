# A2A Traffic — Component Project Spec

A2A Traffic is the portfolio’s **event routing agent**: a permissioned, auditable pub/sub bus for moving events between OpenSentience Agents (and optionally external sources later).

## Read this spec in order

1. `ARCHITECTURE.md` — component boundaries + delivery guarantees
2. `INTERFACES.md` — tools + signals + directives + error contracts
3. `EXECUTION_MODEL.md` — dedupe, retries, acks, DLQ, retention hooks
4. `RESOURCE_SURFACES.md` — repo-local `.fleetprompt/a2a/` formats (`subscriptions.json`, `publications.json`)
5. `PERMISSIONS.md` — bus-agnostic event permission model (`event:*`)
6. `SECURITY.md` — webhook ingestion posture (opt-in), signature verification, secret handling
7. `TEST_PLAN.md` — required test coverage (dedupe, permissions, retries, audit integrity)

## Role in the portfolio

A2A Traffic exists to make event-driven workflows safe and operable:
- **Auditable:** publish + delivery attempts show up in the unified timeline
- **Deduped:** stable `dedupe_key` prevents replay storms and duplicate fanout
- **Permissioned:** bus-agnostic scopes control who can publish/subscribe

## Key decisions (portfolio-aligned)

- **Canonical tool identifiers are namespaced** as `<agent_id>/<tool_name>` via Core routing.
- **Pub/sub permissions are bus-agnostic:**
  - `event:publish:<topic-or-pattern>`
  - `event:subscribe:<topic-or-pattern>`
- **Repo-first resources:** project configuration lives in repo-local `.fleetprompt/` (Core may cache derived indexes under `~/.opensentience/`).

## MVP slice

1. Subscription management (register/list/unregister)
2. Durable audit log for event publish + delivery attempts (secret-free)
3. At-least-once delivery with retries + bounded failure handling
