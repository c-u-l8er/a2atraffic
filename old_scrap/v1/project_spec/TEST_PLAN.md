# A2A Traffic — Test Plan

This test plan defines the minimum test coverage for **A2A Traffic**, the portfolio’s event routing agent.

Primary focus:
- dedupe + idempotency
- permission enforcement (bus-agnostic `event:*`)
- retries / failure handling
- audit integrity (durable, secret-free records)

This plan is written to align with portfolio standards:
- Signals vs Directives (facts vs intent)
- No secrets in durable artifacts
- Safe-by-default + explicit permissions
- Namespaced tool identifiers (`<agent_id>/<tool_name>`)

---

## 0) Terminology / assumptions

### Canonical tool IDs (namespaced)
A2A Traffic is exposed via OpenSentience Core ToolRouter as:

- `com.a2atraffic.core/a2a_publish`
- `com.a2atraffic.core/a2a_subscribe`
- `com.a2atraffic.core/a2a_unsubscribe`
- `com.a2atraffic.core/a2a_list_subscriptions`

### Event envelope (minimum)
Every published event should be representable as an immutable, JSON-safe, secret-free record with at least:
- `topic` (string)
- `message_id` (string; source-specific; optional but strongly recommended)
- `occurred_at` (timestamp)
- `source` (string)
- `payload` (object; secret-free)
- `dedupe_key` (string; optional)

Where available, include portfolio-wide audit linking fields:
- `correlation_id` (string; ties to upstream request / mission)
- `causation_id` (string; optional; parent event / directive)

### Delivery + ack semantics (define for tests)
This plan assumes **at-least-once delivery** with dedupe support, and a clear distinction between:
- *accepted*: publish request persisted / acknowledged by A2A
- *delivered*: event dispatched to a subscriber handler endpoint (tool call / internal delivery)
- *processed*: subscriber handler returned success (if A2A observes handler result)

If your implementation uses different semantics, update the expectations below and keep the tests.

---

## 1) Unit tests — envelope, validation, redaction

### 1.1 Envelope validation
- Reject publish requests with:
  - missing `topic`
  - non-object `payload`
  - payloads exceeding size limits (if any are defined)
  - invalid timestamps (if client-supplied `occurred_at` is allowed)
- Accept publish requests with:
  - `dedupe_key` omitted (A2A can generate one if desired, but must remain stable in audit)
  - `message_id` omitted (but warn; dedupe relies more on `dedupe_key`)

### 1.2 Secret-free payload enforcement (redaction / blocking)
A2A must not persist secrets in any durable record (audit log, event log, delivery results).

Test cases:
- Payload contains obvious secret keys (case-insensitive):
  - `api_key`, `token`, `authorization`, `cookie`, `set-cookie`, `password`, `secret`, `private_key`
- Expected behavior (pick one and assert consistently):
  1) **Reject** publish with a structured error describing forbidden keys, or
  2) **Redact** forbidden keys before persistence and delivery, preserving a redaction marker.

Also ensure:
- Redaction is applied to nested keys, not only top-level fields.
- Redaction is applied in logs and error messages as well.

### 1.3 Topic/pattern validation
If topic wildcards/patterns are supported:
- Validate allowed pattern syntax (documented in A2A spec or shared standard).
- Reject ambiguous / potentially expensive patterns (e.g., catastrophic regex) if regex is used.

---

## 2) Unit tests — dedupe and idempotency

### 2.1 Publish dedupe by `dedupe_key`
Scenario:
1. Publish event E with `topic=T`, `dedupe_key=K`, `payload=P`.
2. Publish identical event again (same `dedupe_key=K`, same `topic=T`).
Expected:
- Second call returns an idempotent response:
  - does not create a new durable event record, OR
  - creates a record but marks it as a duplicate and does not re-deliver.
- Audit log shows:
  - first publish accepted
  - second publish deduped (explicitly marked), not silently dropped

### 2.2 Publish dedupe by provider `message_id` (optional)
If `message_id` is supported as a first-class dedupe mechanism:
- Two publishes with the same `(source, message_id)` should dedupe even if `dedupe_key` differs.
- If both are present and conflict, define precedence and test it.

### 2.3 Subscriber-side dedupe (delivery retry safety)
When A2A retries delivery (or subscriber restarts), ensure:
- The delivered envelope includes a stable dedupe identifier (`dedupe_key` and/or `message_id`).
- Re-delivery is consistent and does not mutate the envelope.
- Subscriber handler results are idempotently recorded (see §4).

---

## 3) Integration tests — permissions and policy enforcement

A2A uses bus-agnostic permission scopes:
- `event:publish:<topic-or-pattern>`
- `event:subscribe:<topic-or-pattern>`

### 3.1 Publish permission enforcement
Setup:
- Agent A has permissions: `event:publish:deploy.*`
- Agent A attempts to publish:
  - `deploy.build.complete` (allowed)
  - `billing.invoice.paid` (denied)
Expected:
- Allowed topic: accepted and persisted + routed.
- Denied topic: rejected with structured error; no durable event record should be written.

### 3.2 Subscribe permission enforcement
Setup:
- Agent B has permissions: `event:subscribe:deploy.*`
- Agent B attempts to subscribe to:
  - `deploy.*` (allowed)
  - `*` or `billing.*` (denied unless explicitly granted)
Expected:
- A2A refuses subscription creation when permission is missing.

### 3.3 Dual-sided enforcement (publisher + subscriber)
Scenario:
- Publisher has permission to publish `topic=T`.
- Subscriber does *not* have permission to subscribe/receive `topic=T`.
Expected:
- Publish succeeds (accepted + persisted).
- Delivery to that subscriber is blocked and recorded as a permission-denied delivery outcome.
- No silent drops: audit timeline should show the block.

### 3.4 Subscription tampering / escalation attempts
Test that subscription creation cannot be used to expand privileges:
- If a subscriber requests a broad pattern, A2A must compute required permissions from that pattern and deny without them.
- If filters are supported (environment, priority, etc.), filters must not bypass permission checks.

---

## 4) Integration tests — routing, retries, and failure handling

### 4.1 Basic routing fanout
Setup:
- Subscribers S1 and S2 are subscribed to patterns matching `topic=T`.
Scenario:
- Publish event to `topic=T`.
Expected:
- Event is delivered to both subscribers.
- Delivery results are recorded per subscriber.
- Publisher receives an ack that is stable and includes:
  - event identifier
  - dedupe information
  - delivery summary (optional, but must be auditable somewhere)

### 4.2 Subscriber handler failure (retry path)
Setup:
- Subscriber handler fails (e.g., returns error) for first N attempts, then succeeds.
Expected:
- A2A retries according to configured backoff policy.
- Each attempt is recorded (attempt count, timestamps, outcome).
- After success, attempts stop and final state becomes terminal success.

### 4.3 Subscriber unreachable / timeout
Setup:
- Subscriber does not respond or times out.
Expected:
- A2A records timeout outcome.
- Retries occur according to policy.
- After max retries, delivery is marked terminal failure and (if supported) routed to a DLQ equivalent.

### 4.4 Retry dedupe safety
Scenario:
- During retry window, the publisher republishes the same event (same `dedupe_key`).
Expected:
- Republishing does not cause a second independent retry schedule.
- The system should converge on a single delivery workflow per deduped event.

### 4.5 Ordering expectations (if any)
If ordering is claimed:
- Publish E1 then E2 to the same topic, ensure subscribers observe ordering.
If ordering is not guaranteed:
- Explicitly assert that tests do not rely on ordering.

---

## 5) Audit integrity tests

### 5.1 Durable event log invariants
For each accepted publish:
- An immutable event record exists.
- Record includes:
  - `topic`, `occurred_at`, `source`, `dedupe_key` (or stable id), `payload` (redacted/validated)
  - linking fields when provided: `correlation_id`, `causation_id`
- Records are JSON-safe and secret-free.

### 5.2 Delivery outcome records
For each attempted delivery:
- A delivery record exists containing:
  - event id (or dedupe key)
  - subscriber id
  - attempt number
  - started_at / finished_at
  - outcome: `delivered | processed | failed | timeout | permission_denied | canceled` (exact enum can vary)
  - structured error (secret-free) when failed

### 5.3 Dedupe audit visibility
When a publish is deduped:
- The fact of dedupe must be visible in audit (explicit event/action), not only inferred.

### 5.4 Redaction in audit and logs
- Ensure any payload redaction/blocking behavior is reflected consistently:
  - persisted event log
  - delivery records
  - runtime logs
  - tool responses/errors
No location is allowed to leak original secret values.

---

## 6) Concurrency and load tests (minimum viable)

### 6.1 Concurrent publishes with identical `dedupe_key`
Scenario:
- 100 concurrent `a2a_publish` calls with same `dedupe_key` and `topic`.
Expected:
- Exactly one event record accepted as canonical.
- All callers receive a valid response (either “created” or “deduped”).
- No duplicate deliveries are produced.

### 6.2 Concurrent subscribe/unsubscribe churn
Scenario:
- Rapidly subscribe/unsubscribe to a topic while publishing.
Expected:
- No crashes.
- Subscription state is consistent (eventual consistency acceptable if defined).
- Audit records changes without leaking secrets.

---

## 7) Cancellation / shutdown behavior

### 7.1 Agent shutdown during delivery
Scenario:
- A2A process is terminated mid-delivery.
Expected:
- On restart, A2A resumes pending deliveries if designed to do so, OR marks them terminal and surfaces in audit.
- No event record corruption.
- No partial/duplicate audit entries that break invariants.

### 7.2 Subscriber cancellation (optional)
If subscriber handlers can be canceled:
- Cancel in-flight delivery attempts and assert correct terminal state + audit.

---

## 8) Backwards/forwards compatibility tests (protocol & schema)

### 8.1 Tool schema stability
- Validate that tool schemas are stable and versioned intentionally.
- Ensure Core can validate inputs consistently against declared schema.

### 8.2 Envelope extensibility
- Adding new optional fields to event envelope must not break routing/dedupe/audit.

---

## 9) Acceptance criteria (MVP)

MVP passes if:
1. Publish/subscribe permissions are enforced using `event:*` scopes.
2. Publish dedupe by `dedupe_key` works under concurrency and is auditable.
3. Delivery retries are deterministic, bounded, and produce durable attempt records.
4. Audit records for publish + delivery are secret-free and linkable via ids/correlation fields.
5. Failure modes (timeout, permission denied, handler error) are visible in audit without leaking sensitive data.