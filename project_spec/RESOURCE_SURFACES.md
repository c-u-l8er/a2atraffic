# A2A Traffic Resource Surfaces (`.fleetprompt/a2a/`)

This document specifies the **repo-local**, safe-to-index resource formats that A2A Traffic consumes (directly or via OpenSentience Core indexing) to configure event subscriptions and publication schemas.

This spec is designed to align with portfolio standards:

- **Repo-first resources**: `.fleetprompt/` in the project is the source of truth.
- **Safe indexing**: resources are parseable without executing code.
- **Bus-agnostic permissions**: `event:publish:<pattern>` / `event:subscribe:<pattern>`.
- **No secrets** in durable artifacts (resources, signals, directives, logs).
- **Idempotency and dedupe** are first-class.

---

## 0) Scope and non-goals

### In scope
- File layout under `.fleetprompt/a2a/`
- Subscription declarations (patterns, handlers, filters, priorities)
- Publication declarations (event name + schema expectations)
- Validation rules (what A2A/Core must reject)
- Security and safety requirements for indexing

### Out of scope (for this doc)
- Runtime protocol details between Core and A2A agent
- Concrete delivery semantics (ack/retry/DLQ); those belong in A2A `EXECUTION_MODEL.md`
- External webhook ingestion adapter formats (future)

---

## 1) Directory layout

A2A Traffic configuration lives under:

- `.fleetprompt/a2a/`

Recommended structure:

- `.fleetprompt/a2a/subscriptions.json` (required if using subscriptions)
- `.fleetprompt/a2a/publications.json` (optional; strongly recommended)
- `.fleetprompt/a2a/README.md` (optional human notes)

If a project does not include `.fleetprompt/a2a/`, A2A Traffic treats it as “no project-specific event config”.

---

## 2) `subscriptions.json`

### 2.1 Purpose

`subscriptions.json` declares **what events a project wants to receive** and **how to route them to handlers**.

A2A Traffic uses this to:
- register (or verify) subscriptions for a given project context
- validate that subscriptions are syntactically safe and permission-checkable
- optionally expose subscriptions in Core UI for review/audit

### 2.2 Canonical location

- `.fleetprompt/a2a/subscriptions.json`

### 2.3 Schema (v1)

Top-level:

- `version` (integer, required): must be `1`
- `subscriptions` (array, required)

Each `subscription` object:

- `pattern` (string, required)
  - Topic/pattern string used for matching events (see Section 2.4).
- `handler` (string, required)
  - A stable handler identifier. Interpretation is owned by the *subscriber agent/workflow layer* (e.g., FleetPrompt workflow handler or an agent tool handler).
- `priority` (string, optional)
  - One of: `"low" | "normal" | "high"`. Default: `"normal"`.
- `filters` (object, optional)
  - A JSON object of filter constraints applied to event metadata and/or payload (see Section 2.5).
- `enabled` (boolean, optional)
  - Default: `true`.
- `description` (string, optional)
  - Human-readable note.

#### Example

```Project[&]/a2atraffic.com/project_spec/RESOURCE_SURFACES.md#L70-114
{
  "version": 1,
  "subscriptions": [
    {
      "pattern": "deploy.*.success",
      "handler": "fleetprompt:workflow:on_deploy_success",
      "priority": "high",
      "filters": {
        "metadata.environment": ["production", "staging"]
      },
      "description": "Kick off post-deploy checks when deploy succeeds."
    },
    {
      "pattern": "customer.*.created",
      "handler": "agent:com.example.crm/on_new_customer",
      "priority": "normal",
      "enabled": true
    }
  ]
}
```

### 2.4 Pattern rules

A2A Traffic patterns are **topic-like strings** with dot-separated segments:

- Example topic: `deploy.prod.success`
- Example pattern: `deploy.*.success`

Rules:
- Segments are separated by `.` (dot).
- `*` matches exactly one segment.
- No whitespace allowed.
- No empty segments (i.e., `a..b` invalid).
- Patterns are case-sensitive by default (recommended).

**Validation requirement:** A2A Traffic (or Core during indexing) must reject patterns that:
- contain path traversal-like sequences (`../`, `..`, `\`)
- contain wildcard constructs other than `*` (until explicitly supported)
- exceed a reasonable max length (recommended: 256 chars)
- exceed a reasonable max segment count (recommended: 32)

### 2.5 Filter rules

Filters provide additional constraints beyond pattern matching.

Filters are an object mapping **field paths** to **constraints**:

- Field path keys SHOULD be one of:
  - `metadata.<key>` (e.g., `metadata.environment`)
  - `payload.<key>` (e.g., `payload.customer_id`)
- Values may be:
  - an array of allowed primitive values: `[string|number|boolean|null]`
  - a single allowed primitive value

MVP filter operators:
- equality / membership only (no regex, no code execution)

**Validation requirement:** reject filters that:
- use keys not starting with `metadata.` or `payload.` (unless explicitly supported later)
- contain nested objects as constraints (to avoid complexity and injection)
- exceed size limits (recommended: max 50 keys)

---

## 3) `publications.json`

### 3.1 Purpose

`publications.json` declares **what events a project publishes** and provides an **expected schema** for the payload.

A2A Traffic uses this to:
- validate outgoing publishes (best-effort; may be enforced by the publisher agent, Core, and/or A2A)
- document event contracts for consumers
- support Core UI discovery of event types

### 3.2 Canonical location

- `.fleetprompt/a2a/publications.json`

### 3.3 Schema (v1)

Top-level:

- `version` (integer, required): must be `1`
- `publications` (array, required)

Each `publication` object:

- `event` (string, required)
  - Event/topic name the project may publish (can include dots).
- `schema` (object, required)
  - A JSON-schema-like declaration (subset; see Section 3.4).
- `description` (string, optional)
- `dedupe` (object, optional)
  - `recommended_fields` (array of strings, optional)
    - Field paths that publishers should consider when constructing a `dedupe_key`.

#### Example

```Project[&]/a2atraffic.com/project_spec/RESOURCE_SURFACES.md#L160-209
{
  "version": 1,
  "publications": [
    {
      "event": "analysis.report.complete",
      "description": "Emitted when the analytics report is generated.",
      "schema": {
        "type": "object",
        "required": ["report_id", "timestamp", "metrics"],
        "properties": {
          "report_id": { "type": "string" },
          "timestamp": { "type": "string", "format": "date-time" },
          "metrics": { "type": "object" }
        },
        "additionalProperties": true
      },
      "dedupe": {
        "recommended_fields": ["payload.report_id", "payload.timestamp"]
      }
    }
  ]
}
```

### 3.4 Schema subset (MVP)

To keep indexing simple and safe, `schema` supports a restricted subset inspired by JSON Schema:

Allowed keys:
- `type`: `"object"` (required)
- `required`: array of strings (optional)
- `properties`: object mapping property names to property schemas (optional)
- `additionalProperties`: boolean (optional; default `true`)
- property schema keys (allowed):
  - `type`: `"string" | "number" | "integer" | "boolean" | "object" | "array" | "null"`
  - `format`: `"date-time"` (only for strings, optional)
  - `items`: schema (only for arrays, optional)

**Explicitly disallowed (MVP):**
- `$ref`, `oneOf`, `anyOf`, `allOf`, `pattern`, `format` beyond `"date-time"`, custom validators, code hooks.

---

## 4) Relationship to permissions (bus-agnostic)

Event permissions are bus-agnostic and must be enforceable at routing time:

- Subscribe requires: `event:subscribe:<pattern>`
- Publish requires: `event:publish:<event-or-pattern>`

A2A Traffic implements topics/patterns; Core is the policy authority and should enforce permissions before routing/tool invocation where possible. A2A must also enforce defensively (deny-by-default) in case of misconfiguration.

---

## 5) Relationship to handlers

The `handler` string is intentionally **opaque** to A2A Traffic. It is a routing hint for the subscriber side.

Recommended handler namespaces (convention):
- `fleetprompt:workflow:<workflow_id>`
- `agent:<agent_id>/<tool_or_handler_name>`

**Validation requirement:** handler must be:
- non-empty
- <= 256 chars
- no whitespace
- no path traversal characters (`../`, `\`)

---

## 6) Safe indexing requirements

OpenSentience Core and/or A2A Traffic must be able to:
- parse these files deterministically
- validate against this spec without executing code
- reject invalid configs with actionable error messages

Indexers must not:
- perform network calls
- resolve references to remote schemas
- execute handlers

---

## 7) Security requirements

- **No secrets**: these JSON files must not contain tokens, API keys, auth headers, cookies, or credentials.
- **Payloads are secret-free**: publication schemas must describe secret-free payloads; any secret references must be indirect (e.g., secret id stored elsewhere).
- **Dedupe keys**: where applicable, publishing agents should provide a stable `dedupe_key` to prevent replay/cost amplification.
- **Deny-by-default**: if permissions or patterns are ambiguous, reject or quarantine rather than “best guess”.

---

## 8) Validation checklist (MVP)

A config is valid if:

### Subscriptions
- `subscriptions.json` exists and parses as JSON (if present)
- `version == 1`
- `subscriptions` is a non-null array
- each subscription:
  - has valid `pattern` per Section 2.4
  - has valid `handler`
  - `priority` is one of `low|normal|high` if present
  - `filters` keys start with `metadata.` or `payload.` if present
  - `enabled` is boolean if present

### Publications
- `publications.json` exists and parses as JSON (if present)
- `version == 1`
- `publications` is a non-null array
- each publication:
  - `event` is a valid topic string (same rules as pattern but without `*`, recommended)
  - `schema.type == "object"`
  - schema uses only allowed keys per Section 3.4

---

## 9) Future extensions (non-breaking direction)

Potential additions that should be version-gated:
- richer pattern syntax (`**` multi-segment wildcards)
- richer filters (comparison operators, time windows)
- signed external ingress adapters (webhooks) under `.fleetprompt/a2a/webhooks.json`
- explicit retention policy declarations (replay windows, compaction rules)
- schema registry integration (still local-first, no network during indexing)

When extending:
- bump `version`
- keep v1 parsing stable
- maintain safe-indexing invariants