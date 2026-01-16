# A2A Traffic Interfaces (as an OpenSentience Agent)

This document defines the stable **interface surface** for A2A Traffic when running as an OpenSentience Agent.

It specifies:

- canonical tool identifiers (namespaced as `<agent_id>/<tool_name>`)
- request/response schemas (JSON-ish, JSON Schema-like)
- emitted signals (facts)
- requested directives (intent)
- error contracts

This is designed to align with portfolio standards:

- `Project[&]/project_spec/standards/signals-and-directives.md`
- `Project[&]/project_spec/standards/tool-calling-and-execution.md`
- Bus-agnostic pub/sub permissions via `event:*` scopes

---

## 0) Naming + identifiers

### 0.1 Canonical tool IDs

OpenSentience Core exposes tools globally as:

- `<agent_id>/<tool_name>`

For A2A Traffic, assume:

- `agent_id = "com.a2atraffic.core"`

So the canonical tool IDs are:

- `com.a2atraffic.core/a2a_publish`
- `com.a2atraffic.core/a2a_subscribe`
- `com.a2atraffic.core/a2a_unsubscribe`
- `com.a2atraffic.core/a2a_list_subscriptions`

### 0.2 Topic vs pattern

A2A Traffic supports topic matching using either:

- exact topics (e.g. `deploy.prod.success`)
- wildcard/pattern topics (e.g. `deploy.*.success`)

**Pattern grammar (MVP):**
- segments are dot-separated: `segment.segment.segment`
- `*` matches exactly one segment
- `>` (optional future) matches remaining segments; not required for MVP

If `>` is not implemented in MVP, reject it as invalid pattern.

### 0.3 Correlation fields

Signals emitted by A2A Traffic should include portfolio-standard linking fields where available:

- `correlation_id` (tie to upstream user request/mission/execution)
- `causation_id` (tie to the immediate cause, e.g., a directive or tool call)
- `subject_type` / `subject_id` (e.g. `a2a.event`, `a2a.subscription`)

---

## 1) Tools (Core-routed API)

All tool inputs/outputs MUST be secret-free.

### 1.1 `com.a2atraffic.core/a2a_publish`

Publish an event to a topic for routing to subscribers.

#### Input
```json
{
  "topic": "string",                 // required; may be exact or pattern-like but is treated as a concrete topic label
  "payload": { },                    // required; JSON object; secret-free
  "dedupe_key": "string?",           // optional; recommended when source can redeliver
  "occurred_at": "string?",          // optional; RFC3339 timestamp; defaults to now
  "source": "string?",               // optional; producer identifier (agent_id or external source tag)
  "message_id": "string?"            // optional; upstream source event id (if any)
}
```

#### Output
```json
{
  "event_id": "string",              // stable id assigned by A2A Traffic
  "topic": "string",
  "occurred_at": "string",           // RFC3339
  "dedupe_applied": true,            // whether this publish was treated as duplicate
  "delivery": {
    "matched_subscriptions": 3,      // count matched (post-filter)
    "accepted_for_delivery": 3       // count enqueued/handed-off for delivery attempt
  }
}
```

#### Permission requirements (enforced by Core and/or A2A)
- Publisher must have: `event:publish:<topic-or-pattern>`
  - Recommended check: exact topic permission OR a covering pattern permission, depending on your permission matcher.

#### Semantics
- **At-least-once** acceptance: A2A should accept and attempt delivery; downstream delivery may be retried.
- Dedupe:
  - If `dedupe_key` is present and already seen within the dedupe window, treat as duplicate and return `dedupe_applied = true`.
  - A deduped publish should still return a stable `event_id` (either the original event id or a deterministic id for the dedupe_key).

---

### 1.2 `com.a2atraffic.core/a2a_subscribe`

Register a subscription for the calling agent.

#### Input
```json
{
  "pattern": "string",               // required; topic pattern
  "handler": "string",               // required; agent-local handler name OR tool name (see below)
  "filters": { },                    // optional; object with simple predicates (MVP: exact-match only)
  "priority": "low|normal|high?"     // optional; default normal
}
```

#### Output
```json
{
  "subscription_id": "string",
  "pattern": "string",
  "status": "active"
}
```

#### Permission requirements
- Subscriber must have: `event:subscribe:<pattern>`

#### Handler resolution
A2A Traffic needs a way to deliver events to the subscriber. Two acceptable MVP modes:

1) **Handler is an agent-local callback name** (implementation-defined), and the subscriber agent exposes a single “deliver event” entrypoint to Core.
2) **Handler is a canonical tool name** on the subscriber agent (recommended for clarity), e.g.:
   - subscriber tool: `com.some.agent/on_a2a_event`
   - handler field holds `on_a2a_event` and A2A resolves it for that agent.

This spec treats `handler` as an opaque string but RECOMMENDS using a subscriber tool handler pattern.

---

### 1.3 `com.a2atraffic.core/a2a_unsubscribe`

Remove an existing subscription owned by the calling agent.

#### Input
```json
{
  "subscription_id": "string"
}
```

#### Output
```json
{
  "subscription_id": "string",
  "status": "removed"
}
```

#### Permission requirements
- No additional permissions beyond being the owner of the subscription (authorization check).
- If you choose to allow admins to remove others’ subscriptions, gate via a Core permission (out of scope here).

---

### 1.4 `com.a2atraffic.core/a2a_list_subscriptions`

List subscriptions for the calling agent.

#### Input
```json
{ }
```

#### Output
```json
{
  "subscriptions": [
    {
      "subscription_id": "string",
      "pattern": "string",
      "handler": "string",
      "filters": { },
      "priority": "low|normal|high",
      "created_at": "string"         // RFC3339
    }
  ]
}
```

---

## 2) Signals (facts) emitted by A2A Traffic

Signals are immutable facts, durable, replayable, and secret-free.

### 2.1 `a2a.event.published`
Emitted when an event is accepted (including deduped acceptance).

Payload fields (recommended):
- `event_id`
- `topic`
- `occurred_at`
- `source` (if provided)
- `message_id` (if provided)
- `dedupe_key` (if provided)
- `dedupe_applied` (boolean)
- `correlation_id` / `causation_id` (if known)
- `subject_type = "a2a.event"`, `subject_id = event_id`

### 2.2 `a2a.event.delivery.attempted`
Emitted per delivery attempt to a subscriber.

Fields:
- `event_id`
- `subscription_id`
- `subscriber_agent_id`
- `attempt` (integer >= 1)
- `status` (`enqueued | delivered | failed`)
- `error` (safe, structured, no secrets) if failed
- `correlation_id` / `causation_id` (if known)
- `subject_type = "a2a.delivery"`, `subject_id` (delivery attempt id)

### 2.3 `a2a.subscription.created`
Fields:
- `subscription_id`
- `subscriber_agent_id`
- `pattern`
- `handler`
- `filters` (if any)
- `priority`
- `created_at`
- `subject_type = "a2a.subscription"`, `subject_id = subscription_id`

### 2.4 `a2a.subscription.removed`
Fields:
- `subscription_id`
- `subscriber_agent_id`
- `removed_at`
- `subject_type = "a2a.subscription"`, `subject_id = subscription_id`

---

## 3) Directives (intent) requested by A2A Traffic

A2A Traffic is primarily a router, but there are two classes of actions that should be directive-backed (durable intent, retryable, auditable):

### 3.1 `a2a.delivery.perform` (recommended)
Requested when A2A needs to invoke a subscriber handler in a way that:
- might be retried
- should be audited as an explicit intent boundary

Directive payload:
- `event_id`
- `subscription_id`
- `subscriber_agent_id`
- `handler`
- `payload_ref` or `payload` (must be secret-free; prefer reference if payload is large)
- `attempt`
- `correlation_id` / `causation_id`

Note: If your Core already models all tool invocations as audited actions, you may treat the delivery as a tool call without an extra directive. If so, still emit `a2a.event.delivery.attempted` signals.

### 3.2 `a2a.webhook.ingest` (future)
If/when A2A offers external webhook ingestion, the ingestion and any downstream processing MUST be directive-backed per portfolio security guardrails:
- verify signature
- dedupe
- emit signal
- enqueue directive

---

## 4) Error contract (tools)

All tools should return structured errors with:

- a stable `code` (machine readable)
- a human-readable `message` (safe; no secrets)
- optional `details` (safe; no secrets)

### 4.1 Standard error shape
```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": { }
  }
}
```

### 4.2 Error codes

- `a2a.invalid_topic`
  - topic is empty, too long, contains invalid characters, etc.
- `a2a.invalid_pattern`
  - subscription pattern fails grammar validation
- `a2a.invalid_payload`
  - payload is not an object, too large, or contains disallowed keys (best-effort secret key denylist)
- `a2a.permission_denied`
  - caller lacks `event:publish:*` or `event:subscribe:*` scope for the requested topic/pattern
- `a2a.subscription_not_found`
  - unsubscribe target does not exist
- `a2a.subscription_not_owned`
  - caller attempted to remove a subscription it does not own
- `a2a.dedupe_conflict`
  - dedupe_key exists but conflicts with incompatible event attributes (if you enforce such constraints)
- `a2a.internal_error`
  - unexpected failure (do not leak internal details)

---

## 5) Size limits and safety defaults (recommended)

These defaults should be enforced consistently across tools:

- `topic` max length: 256
- `pattern` max length: 256
- `payload` max encoded size: 64 KB (MVP; adjust as needed)
- reject (or aggressively redact) known secret-ish keys anywhere in payload:
  - `api_key`, `apikey`, `token`, `authorization`, `cookie`, `set-cookie`, `password`, `secret`, `private_key`
- deny-by-default for unknown patterns/topics unless explicitly permitted

---

## 6) Compatibility and versioning

- Tool contracts in this document are **v1**.
- If you need to evolve schemas, prefer additive fields over breaking changes.
- Breaking changes require a new tool name or a versioned tool id suffix (e.g., `a2a_publish_v2`) unless Core supports schema version negotiation.

---
