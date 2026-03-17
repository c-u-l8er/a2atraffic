# A2A Traffic Architecture (as an OpenSentience Agent)

A2A Traffic is the portfolio’s **event routing agent**: a local-first, permissioned pub/sub bus that moves events between OpenSentience Agents in a way that is **auditable**, **deduped**, and **safe-by-default**.

This document defines:
- Component boundaries (what Core owns vs what A2A owns)
- Delivery semantics (guarantees, retries, ordering)
- Audit stance and event envelope requirements
- Integration points with the `.fleetprompt/` resource surface

> Canonical cross-portfolio standards:
> - `project_spec/standards/signals-and-directives.md`
> - `project_spec/standards/security-guardrails.md`
> - `project_spec/standards/tool-calling-and-execution.md`
> - Tool naming: `<agent_id>/<tool_name>` (namespaced)
> - Pub/sub permissions are bus-agnostic: `event:publish:<pattern>`, `event:subscribe:<pattern>`

---

## 1) Component boundaries

### 1.1 OpenSentience Core owns

Core is the **policy enforcement and audit authority**. Core must:

- **Launch/manage** the A2A Traffic agent process (install/enable/run/stop)
- **Enforce permissions** at the routing boundary (ToolRouter)
  - caller must be allowed to invoke `com.a2atraffic.core/*` tools
  - publisher must have `event:publish:<topic-or-pattern>`
  - subscriber/handler must have `event:subscribe:<topic-or-pattern>`
- **Own the system-wide audit log**
  - record security-relevant events: publishes, deliveries, drops, failures
- **Provide UI/CLI visibility**
  - subscriptions, recent events, failures, delivery lag, etc.
- **Own identity**
  - stable `agent_id` identity for each connected agent process
  - attribution in audit records (publisher/subscriber identities)

Core must be able to index relevant configuration **without executing agent code** (repo-first `.fleetprompt/`).

### 1.2 A2A Traffic agent owns

A2A Traffic is responsible for the **routing plane**. It must:

- Maintain a routing index of:
  - topics/pattern subscriptions (and metadata like priority)
  - active subscribers (by agent id) and their connection health
- Validate the event envelope and enforce invariants (secret-free, JSON-safe)
- Apply dedupe and idempotency logic for publish and (optionally) delivery
- Perform matching and filtering (topic/pattern match + optional structured filters)
- Attempt delivery to subscribers, track per-subscriber outcomes
- Emit/forward audit-relevant facts (signals) and request any required directives for side effects (e.g., external webhook ingestion later)

A2A Traffic should not:
- Act as the source of truth for permissions approvals
- Persist secrets in events or logs
- Open inbound network listeners by default

---

## 2) Event model and required envelope

A2A Traffic routes **events**, treated as “signal-like facts” (immutable records of something that happened).

### 2.1 Required fields (normative)

Every published event **must** include:

- `topic` (string): routing key (supports pattern subscriptions)
- `message_id` (string): source-specific id if present, else a generated id
- `occurred_at` (timestamp): when the event occurred at the source
- `source` (string): stable publisher identity or source system label
- `payload` (object): JSON-safe, **secret-free**
- `dedupe_key` (string): used for idempotency/dedupe

For portfolio-wide traceability, events should also include:

- `correlation_id` (string): ties to an upstream user request / session / workflow
- `causation_id` (string, optional): ties to the immediate upstream event/tool call
- `subject_type` / `subject_id` (optional): domain object reference (e.g. `fleetprompt.execution`, `delegatic.mission`)

### 2.2 Payload rules

- Payload must be **JSON-safe** (no binary blobs; use references)
- **No secrets**:
  - must not include tokens, auth headers, cookies, API keys, passwords, private keys
  - A2A Traffic should apply best-effort redaction/denylists, but enforcement is a portfolio-wide invariant: callers must not send secrets
- Payload size limits should be enforced (open decision; recommend a conservative default such as 64KB–256KB) with clear errors.

---

## 3) Subscriptions, patterns, and filtering

### 3.1 Topic pattern semantics

A2A Traffic supports topic patterns for subscription routing.

Minimum viable semantics:
- Dot-separated topics (e.g. `deploy.prod.success`)
- Wildcards:
  - `*` matches a single segment (e.g. `deploy.*.success`)
  - `**` matches zero or more segments (optional; decide explicitly)

Pattern rules must be deterministic and documented so validation is possible without executing code.

### 3.2 Optional structured filters

Subscriptions may define structured filters applied after pattern match (e.g. `payload.environment in ["prod","staging"]`).

Rules:
- Filters must be purely declarative and safe to evaluate
- Filters must not execute code
- Filters should be validated at subscription registration time

---

## 4) Delivery semantics (normative)

### 4.1 Publish acknowledgement

On `publish`, A2A Traffic returns an acknowledgement that includes:

- whether the event was accepted
- whether it was a dedupe hit
- the canonical `event_id` (A2A-generated) and/or `dedupe_key`
- a lightweight delivery plan summary (e.g. matched subscriber count)

A2A publish acknowledgement **must not** imply that any subscriber has processed the event—only that the event has been accepted for routing.

### 4.2 Delivery guarantee

A2A Traffic should provide **at-least-once delivery** to subscribers, coupled with dedupe/idempotency.

Implications:
- Subscribers must be idempotent at the handler boundary
- A2A should include `dedupe_key` in every delivery attempt
- Duplicate deliveries can occur (e.g., retries, reconnects), but they must be detectable

### 4.3 Retry policy

For each subscriber delivery, A2A should implement:
- bounded retries with exponential backoff
- a terminal failure outcome after max attempts or max age

Terminal handling options (choose during implementation; recommended baseline):
- record terminal failure in audit log
- optionally move to a “dead letter” store/queue for inspection/replay

### 4.4 Ordering guarantees

Default stance:
- **No global ordering guarantee**.
- Provide **best-effort ordering per (topic, subscriber)** while a subscriber remains healthy and connected.

If strict ordering is required later, it should be:
- opt-in per subscription, and
- explicitly traded off against throughput and availability.

### 4.5 Backpressure and flow control

A2A must protect the system against slow subscribers:
- bounded per-subscriber queue
- bounded total inflight deliveries
- clear behavior when limits are exceeded (drop vs block vs spill to disk—explicit decision)

MVP recommendation:
- bounded in-memory queues
- reject/slow down publishers when queues are saturated (fail fast with clear error)
- log/audit backpressure events

---

## 5) Dedupe and idempotency

### 5.1 Dedupe scope

Dedupe is applied to prevent:
- replay storms from upstream sources
- accidental double-publishes from UI “double-click”
- retry duplication

Baseline:
- Dedupe on `(publisher_id, dedupe_key)` or `(source, dedupe_key)` for a configurable window.

### 5.2 Dedupe retention window

A2A must define a dedupe retention window (open decision; recommend hours to days depending on volume).
- Too small: duplicates leak through
- Too large: storage/lookup costs grow

Even if event retention is short, dedupe retention may need to be longer.

---

## 6) Audit stance and observability

Auditability is a portfolio invariant.

### 6.1 What must be auditable

At minimum, record the following as durable, queryable facts:

- Event accepted (publish)
  - publisher identity
  - topic, message_id, dedupe_key, correlation_id
  - payload hash (or redacted summary), not secrets
- Event dropped/rejected
  - reason (permission denied, invalid schema, too large, etc.)
- Delivery attempts per subscriber
  - subscriber identity
  - attempt count, timestamps, outcome
- Terminal failures
  - reason and retry exhaustion metadata

### 6.2 Signals vs directives

- Routing and logging are “internal effects” but still security-relevant; they should emit **signals** to the Core audit timeline.
- Any externally impactful behavior (future webhook ingestion listeners, cross-host bridges, etc.) must be explicit **directives** and must not run by default.

### 6.3 Metrics (recommended)

Expose operational counters/gauges (via Core observability surfaces):
- publishes accepted / rejected
- deliveries attempted / succeeded / failed
- queue depths and backpressure events
- dedupe hits
- p50/p95 publish latency and delivery latency

---

## 7) Integration surfaces

### 7.1 Tool surface (canonical namespaced IDs)

A2A Traffic is invoked via OpenSentience Core ToolRouter using namespaced tool identifiers, e.g.:

- `com.a2atraffic.core/a2a_publish`
- `com.a2atraffic.core/a2a_subscribe`
- `com.a2atraffic.core/a2a_unsubscribe`
- `com.a2atraffic.core/a2a_list_subscriptions`

Permission model:
- tool invocation permission (Core-level): `tool:invoke:com.a2atraffic.core/a2a_publish` (or equivalent Core policy)
- bus-agnostic event permissions:
  - `event:publish:<topic-or-pattern>`
  - `event:subscribe:<topic-or-pattern>`

### 7.2 `.fleetprompt/a2a/` resource surface

Projects may declare subscriptions/publications in repo-local `.fleetprompt/a2a/` resources so Core can index them safely.

A2A Traffic should integrate with these resources via Core:
- Core indexes `.fleetprompt/a2a/subscriptions.json`
- Core (or FleetPrompt) registers subscriptions as part of project enablement
- A2A Traffic treats subscription definitions as data; it does not execute code from them

---

## 8) Security posture

### 8.1 No inbound network listeners by default

A2A Traffic should not expose network endpoints by default. Any future inbound adapters (webhooks, bridges) must:
- verify signatures
- dedupe by provider event id
- emit durable, secret-free facts
- be guarded behind explicit directives and permissions

### 8.2 Secret-free durable records

A2A Traffic must treat:
- events
- delivery logs
- audit signals

as durable artifacts and therefore **must not contain secrets**.

### 8.3 Deny-by-default

If permissions are missing or ambiguous, routing should fail closed:
- publish denied without `event:publish:*` (appropriately scoped)
- delivery denied without `event:subscribe:*` for the subscriber

---

## 9) MVP boundaries and open decisions

### 9.1 MVP recommended scope

1. In-memory routing between agents running under OpenSentience Core
2. Durable audit log entries for publish + delivery attempts (Core-owned preferred)
3. Subscription management (register/list/unregister)
4. Basic dedupe window

### 9.2 Explicit open decisions

- Pattern semantics: support `**` or only `*`?
- Size limits: max payload size and max event rate per agent
- Backpressure behavior: reject publishers vs spill-to-disk
- Retention/replay policy:
  - audit-only retention vs replayable event store
  - compaction/TTL rules
- Delivery acknowledgement semantics:
  - do we ever provide “processed” acknowledgements (requires subscriber protocol and changes in meaning)

---

## 10) Acceptance criteria (architecture-level)

- Tools are namespaced as `<agent_id>/<tool_name>`
- Pub/sub permissions are bus-agnostic (`event:publish:*`, `event:subscribe:*`) and enforced
- Delivery is at-least-once with dedupe keys present on every delivery
- Audit timeline can answer:
  - who published what (topic, correlation)
  - who received it (subscriber)
  - whether it succeeded, retried, or failed terminally
- No secrets persist in events, logs, or signals
- No inbound network listeners are enabled by default