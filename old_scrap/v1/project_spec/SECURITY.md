# A2A Traffic — Security Spec

A2A Traffic is the portfolio’s event routing agent. This document defines its security posture, with emphasis on webhook ingestion, dedupe, signature verification, permission enforcement, and secret handling.

This spec is portfolio-aligned with:

- `Project[&]/project_spec/standards/security-guardrails.md`
- `Project[&]/project_spec/standards/signals-and-directives.md`
- `Project[&]/project_spec/standards/tool-calling-and-execution.md`
- `Project[&]/opensentience.org/project_spec/agent_marketplace.md`

## 0) Security invariants (non-negotiable)

1. **No secrets in durable artifacts**
   - Events, signals, directives, logs, and audit records must be secret-free.
   - If an inbound source contains secrets, they must be removed before persistence or fanout.

2. **Side effects require explicit intent**
   - A2A Traffic itself should be side-effect-minimal.
   - Any downstream side effects triggered by events must be performed by subscribers using directive-backed execution (portfolio standard).

3. **Permissioned pub/sub**
   - Publish and subscribe are gated by explicit, bus-agnostic permissions:
     - `event:publish:<topic-or-pattern>`
     - `event:subscribe:<topic-or-pattern>`
   - A2A must not deliver events to a subscriber that lacks `event:subscribe:*` for the matched topic/pattern.

4. **Idempotency and dedupe are required**
   - External sources can redeliver; A2A must prevent fanout duplication using stable dedupe keys.

5. **Local-first by default**
   - A2A should not expose network listeners by default.
   - Any ingress (webhooks) is an explicit opt-in integration with strong validation.

## 1) Threat model (what we assume attackers will try)

### 1.1 External event spoofing
- Attacker sends forged webhook requests to inject events that trigger workflows.

**Mitigation:** signature verification + allowlisted endpoints + strict schema validation + dedupe + rate limits.

### 1.2 Replay attacks
- Attacker replays valid past webhook payloads to re-trigger behavior.

**Mitigation:** dedupe keyed by provider event id (or derived canonical hash), bounded retention, and timestamp tolerances where applicable.

### 1.3 Payload-based secret exfiltration
- Inbound payload includes secrets; those secrets get persisted to audit logs or forwarded to other agents.

**Mitigation:** strict redaction/denylisting + “persist-safe” envelope rules + refusal to persist unknown secret-like fields (best-effort).

### 1.4 Confused deputy / cross-agent privilege escalation
- A low-privileged agent publishes to high-impact topics, or subscribes to sensitive topics, indirectly gaining powers.

**Mitigation:** enforce `event:publish:*` and `event:subscribe:*` permissions at publish and delivery time; record enforcement outcomes in audit log (without secrets).

### 1.5 Denial of service / cost explosion
- Flooding inbound events causes fanout overload.

**Mitigation:** ingress rate limiting, payload size bounds, bounded fanout policies, and backpressure behavior.

## 2) Data classification and secret handling

### 2.1 Event envelope must be secret-free
A2A operates on an event envelope with at least:

- `topic` (string)
- `message_id` (string; provider-specific where applicable)
- `occurred_at` (timestamp)
- `source` (string)
- `payload` (object; secret-free)
- `dedupe_key` (string; stable)

Rule: `payload` must be safe to persist. If it is not safe, A2A must sanitize it or reject it.

### 2.2 Secret detection/redaction (best-effort, defense-in-depth)
A2A must remove or redact values under keys commonly used for secrets, at minimum:

- `api_key`, `apikey`, `token`, `access_token`, `refresh_token`
- `authorization`, `cookie`, `set-cookie`
- `secret`, `password`, `passwd`, `private_key`, `client_secret`
- `signature` (may be present in some providers; do not persist)
- provider-specific headers/fields that are known secrets

Redaction strategy:
- Prefer removing the key entirely from the persisted payload.
- If removing would break schema expectations, replace with `"[REDACTED]"`.

### 2.3 Do not persist raw webhook requests
A2A must not durably store:
- raw headers (often contain auth/cookies/signatures)
- raw bodies (may contain PII/secrets)
- full request URLs if they embed secrets

If debugging is needed:
- store a hashed request fingerprint (e.g., SHA-256 of canonical bytes) and minimal, non-sensitive metadata.

## 3) Permission enforcement

### 3.1 Publish authorization
On publish (whether from an agent tool call or webhook ingestion), A2A must enforce:

- Publisher identity is known (agent id or integration id).
- Publisher has `event:publish:<topic-or-pattern>` permission matching the topic.

If the publish is rejected:
- do not emit/deliver the event
- record an audit entry with:
  - publisher id
  - topic
  - reason (e.g., missing permission)
  - correlation identifiers if available
  - no payload content beyond minimal safe metadata

### 3.2 Subscribe authorization
On subscription creation and/or delivery, A2A must enforce:

- Subscriber has `event:subscribe:<topic-or-pattern>` permission matching the subscription pattern.
- Subscriptions should be allowlisted per-agent (Core policy may also enforce).

Delivery-time re-check is required because:
- permissions can change after subscription creation
- “time of check vs time of use” must be safe

### 3.3 Namespaced tool identifiers (routing)
Externally visible tool identifiers are namespaced via Core ToolRouter as:

- `com.a2atraffic.core/a2a_publish`
- `com.a2atraffic.core/a2a_subscribe`
- `com.a2atraffic.core/a2a_unsubscribe`
- `com.a2atraffic.core/a2a_list_subscriptions`

Core remains the policy enforcement point for tool invocation, but A2A must also enforce its own authorization rules (defense-in-depth).

## 4) Webhook ingestion security (opt-in integration)

Webhook ingestion is optional. If enabled, A2A must implement the following baseline requirements.

### 4.1 Endpoint hardening
- Bind to `127.0.0.1` by default; do not bind to `0.0.0.0` unless explicitly configured and acknowledged as higher risk.
- Prefer a reverse proxy / tunnel under explicit operator control if internet exposure is required.
- Support a per-provider ingress allowlist:
  - enabled providers only
  - fixed endpoint paths per provider
  - optional IP allowlists (not sufficient alone)

### 4.2 Request size and content-type bounds
- Set a maximum request body size (explicit value to be chosen; must exist).
- Require expected `Content-Type` per provider (e.g., `application/json`).
- Reject malformed JSON early.
- Reject payloads with unexpected structure if schema validation is available.

### 4.3 Signature verification (required)
Each webhook provider must have a verification module that:

1. Extracts provider signature fields (headers and/or body fields).
2. Reconstructs the signed payload exactly as required by the provider spec.
3. Computes and compares signatures using constant-time comparison.
4. Enforces timestamp windows / nonce rules if the provider supports them.
5. Never logs secrets, signature headers, or raw payload.

Secrets for verification (shared signing secret, public keys, etc.) must be stored in a dedicated secret store and referenced by id/config, never hardcoded.

If signature verification fails:
- return an appropriate failure response
- do not emit events
- audit the failure with safe metadata only (provider, endpoint, reason, request fingerprint)

### 4.4 Dedupe for webhook ingestion (required)
A2A must dedupe webhook events using a stable dedupe key, derived as:

- preferred: provider event id (e.g., `message_id`) + provider name
- fallback: stable hash of canonical payload fields + occurred_at bucket + provider name

The dedupe key must be computed after signature verification (to avoid attacker-controlled dedupe collisions).

When a duplicate is detected:
- do not re-deliver to subscribers
- respond success to the provider if appropriate (to stop retries)
- record a dedupe hit in audit log (no payload)

### 4.5 Normalization and sanitization pipeline (required)
Webhook ingestion must follow this pipeline:

1. Parse + validate request size/content-type
2. Verify signature (reject if invalid)
3. Normalize into A2A event envelope (`topic`, `message_id`, `occurred_at`, `source`, `payload`, `dedupe_key`)
4. Sanitize payload (secret/PII redaction rules)
5. Persist the event to durable audit log (secret-free)
6. Route/deliver to authorized subscribers

No step may persist raw inbound bytes.

## 5) Audit logging (security relevant)

A2A must emit durable, queryable audit records for:

- publish attempts (allowed/denied)
- subscription creation/removal
- delivery attempts (allowed/denied)
- webhook verification failures/successes (metadata only)
- dedupe hits
- routing/fanout counts (aggregate, safe)

Audit record fields should include (where applicable):
- `correlation_id` (from caller/Core if available)
- `causation_id` (upstream message/tool call id if available)
- `subject_type` / `subject_id` (e.g., `a2a.event`, `a2a.subscription`)
- `publisher_id` / `subscriber_id`
- `topic` / matched pattern
- `result` (`allowed` / `denied` / `duplicate` / `failed`)
- safe error codes (no raw payload)

## 6) Rate limiting and abuse controls

A2A must implement bounded behavior:

- Ingress rate limiting per provider endpoint (if webhooks enabled)
- Publish rate limiting per publisher (agent/integration)
- Fanout safety:
  - cap maximum deliveries per published event (configurable)
  - cap maximum subscriptions per agent/project (configurable)
- Payload limits:
  - max payload size
  - max nested depth (to prevent parser attacks)

When limits are exceeded:
- reject or defer processing
- audit the event with safe metadata

## 7) Failure modes and safe defaults

- If authorization cannot be determined, default to **deny**.
- If signature verification cannot run (missing secret config), default to **reject ingress**.
- If payload sanitization fails, default to **reject** or **strip to minimal safe payload** (choose one behavior and document it in implementation).
- If storage for audit log is unavailable:
  - do not silently drop security-relevant events
  - prefer failing closed for external ingress; for internal agent publish, either fail closed or degrade explicitly (must be a documented policy)

## 8) Test requirements (security-specific)

Minimum tests required for A2A Traffic:

1. **Signature verification**
   - valid signature accepted
   - invalid signature rejected
   - timestamp window enforced (if provider supports)
   - constant-time compare is used (implementation detail testable indirectly)

2. **Dedupe**
   - same webhook redelivered results in single routed delivery
   - dedupe is scoped correctly (provider + id)
   - dedupe key is stable across retries

3. **Secret handling**
   - known secret keys are removed/redacted before persistence
   - raw headers/bodies are not persisted

4. **Permission enforcement**
   - publish denied without `event:publish:*`
   - subscribe/delivery denied without `event:subscribe:*`
   - delivery-time permission re-check blocks revoked permissions

5. **Abuse controls**
   - request body size limit enforced
   - rate limits enforced
   - fanout cap enforced

## 9) Open decisions (explicit)

These must be decided before implementing public integrations:

- Which providers/webhook formats to support first (e.g., GitHub, Stripe, generic HMAC JSON).
- Concrete retention/compaction policy for the durable event/audit log.
- Whether A2A supports replay as a first-class feature or leaves replay to Core audit tooling.
- Whether webhook ingress is allowed beyond localhost in MVP, and under what operator controls.