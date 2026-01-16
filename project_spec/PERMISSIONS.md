# A2A Traffic — Permissions Model (Portfolio-aligned)

This document defines the permissions model for **A2A Traffic**, the portfolio’s event routing agent.

It is aligned with portfolio standards:

- `Project[&]/project_spec/standards/signals-and-directives.md`
- `Project[&]/project_spec/standards/security-guardrails.md`
- `Project[&]/project_spec/standards/tool-calling-and-execution.md`
- `Project[&]/opensentience.org/project_spec/agent_marketplace.md`
- `Project[&]/opensentience.org/project_spec/portfolio-integration.md`

## 0) Key decisions (normative)

1. **Bus-agnostic event permissions**
   - The portfolio uses `event:*` permission scopes, regardless of which event bus implementation is used.
   - A2A Traffic is the default in-portfolio bus implementation, and enforces `event:*` scopes.

2. **Namespaced tool identifiers**
   - Canonical routed tool identifiers are namespaced as `<agent_id>/<tool_name>`.
   - For A2A Traffic, examples use `com.a2atraffic.core/...`.

3. **Core is the policy enforcement authority**
   - OpenSentience Core is the ultimate enforcement point for agent permissions.
   - A2A Traffic must still enforce topic-level publish/subscribe rules internally as a defense-in-depth layer.

## 1) Permission taxonomy used by A2A Traffic

### 1.1 Publish / subscribe

A2A Traffic uses bus-agnostic permissions of the form:

- `event:publish:<pattern>`
- `event:subscribe:<pattern>`

Where `<pattern>` is a topic/pattern string using the portfolio’s event pattern convention.

**Pattern convention (MVP):**
- Dot-delimited segments, e.g. `deploy.prod.success`
- Wildcard `*` matches a single segment, e.g. `deploy.*.success`
- A pattern without wildcards matches exactly

> Note: If later you adopt a different matcher (glob/regex), keep `event:*` stable and treat the matcher as an implementation detail. The manifest and approvals should still use `event:*`.

### 1.2 Optional event permissions (future)

Not required for MVP, but reserved if you need finer control:

- `event:admin` — manage subscriptions/routers beyond the caller’s own identity
- `event:inspect` — query historical event logs beyond the caller’s own publish/deliver history
- `event:dlq:read` / `event:dlq:requeue` — dead-letter queue operations

## 2) Required permissions per tool

Canonical tool IDs (Core-routed):

- `com.a2atraffic.core/a2a_publish`
- `com.a2atraffic.core/a2a_subscribe`
- `com.a2atraffic.core/a2a_unsubscribe`
- `com.a2atraffic.core/a2a_list_subscriptions`

### 2.1 `com.a2atraffic.core/a2a_publish`

Input: `{ topic: string, payload: object, dedupe_key?: string }`

Requires:

- `event:publish:<topic>` OR an approved permission whose pattern matches the topic
  - Example: publishing `deploy.prod.success` is allowed by `event:publish:deploy.*.success`

Notes:
- A2A Traffic must treat missing or empty `topic` as invalid input (schema validation).
- `payload` must be secret-free (validated/redacted per portfolio standards).

### 2.2 `com.a2atraffic.core/a2a_subscribe`

Input: `{ topic: string }` (topic may be exact or a pattern, depending on matcher support)

Requires:

- `event:subscribe:<topic>` OR an approved permission whose pattern matches the requested subscription

Notes:
- For safety, MVP should prefer *exact topic subscriptions* unless you explicitly support patterns at subscription time.
- Even if you support pattern subscriptions, enforcement must still check that the approved subscription permission covers that pattern.

### 2.3 `com.a2atraffic.core/a2a_unsubscribe`

Input: `{ topic: string }`

Requires:

- `event:subscribe:<topic>` (same permission used to create/hold the subscription), or `event:admin` (future)

### 2.4 `com.a2atraffic.core/a2a_list_subscriptions`

Input: `{}`

Requires:

- No special permission if the tool only lists the caller’s own subscriptions, OR
- `event:inspect` if listing cross-agent subscriptions is supported (future)

MVP recommendation:
- List only the calling agent’s subscriptions without requiring extra permissions.

## 3) Enforcement layers (who checks what)

### 3.1 OpenSentience Core enforcement (mandatory)

Core must enforce, before routing any tool call to A2A Traffic:

1. **Agent is enabled** (permissions approved)
2. **Requested operation is within approved permissions**
   - For `a2a_publish`: check `event:publish:*` coverage
   - For `a2a_subscribe`: check `event:subscribe:*` coverage
3. **Audit logging**
   - Record tool invocation (namespaced tool id, caller, outcome)
   - Redact secrets from any logged inputs/outputs (best-effort)

Core is the authoritative gate: if Core denies, the call never reaches A2A Traffic.

### 3.2 A2A Traffic internal enforcement (defense in depth)

A2A Traffic must re-check, using caller identity provided by Core:

- The caller is allowed to publish to `topic`
- The caller is allowed to subscribe/unsubscribe from `topic` or pattern

This protects against:
- misconfiguration/bugs in Core routing
- future non-Core invocations (if any adapters exist later)

### 3.3 Subscription-time vs delivery-time checks

A2A Traffic should enforce both:

- **Subscription-time authorization:** prevent creating subscriptions the agent is not allowed to hold.
- **Delivery-time authorization:** ensure a subscriber is still permitted to receive events matching the delivered topic.
  - Rationale: permissions can be revoked after a subscription is created; delivery-time checks prevent “permission drift”.

## 4) Permission matching rules (normative)

### 4.1 Matching publish permissions

To publish `topic = T`, an agent must have at least one approved permission:

- `event:publish:P` such that `P` matches `T` using the portfolio pattern matcher.

### 4.2 Matching subscribe permissions

To subscribe to `pattern/topic = S`, an agent must have at least one approved permission:

- `event:subscribe:P` such that `P` covers `S` under matcher rules.

MVP recommendation (least ambiguity):
- Allow subscribing only to exact topics (no wildcards) unless you explicitly implement safe pattern subscription.
- If pattern subscription is allowed, require explicit approval for the pattern (not just a broader “subscribe:*” unless you intentionally allow it).

## 5) Guidance for manifests (`opensentience.agent.json`)

Agents that intend to use A2A Traffic should request bus-agnostic `event:*` permissions in their manifests, e.g.:

- `event:publish:build.*.complete`
- `event:subscribe:deploy.*.success`

Agents should avoid requesting overly broad patterns like `event:publish:*` unless absolutely required.

## 6) Interaction with `.fleetprompt/a2a/subscriptions.json` (integration convention)

When a project declares `.fleetprompt/a2a/subscriptions.json`, it expresses *intended subscriptions/publications*.

Rules:

1. Declared subscriptions/publications do not grant permissions by themselves.
2. OpenSentience Core may validate that:
   - declared patterns are syntactically valid
   - the owning agent’s approved permissions cover the declared patterns
3. If validation fails, Core should:
   - refuse to enable the integration or mark it “degraded”
   - emit an audit event indicating the mismatch (secret-free)

## 7) Audit and secrecy requirements (security-relevant)

- No secrets in:
  - event payloads
  - event metadata
  - durable logs
  - tool inputs/outputs persisted in audit

- A2A Traffic must:
  - support `dedupe_key` (idempotency) for publishes where upstream might redeliver
  - emit/record durable audit facts for:
    - publish accepted/rejected (reason)
    - delivery attempted/succeeded/failed (with correlation fields)

## 8) Open questions (explicit)

1. **Pattern language:** keep `*` segment wildcard only, or support richer globs/regex?
2. **History access:** do we allow querying prior events, and if so, what `event:inspect` scopes exist?
3. **Delivery semantics:** at-least-once with dedupe is recommended; finalize ack/retry/DLQ policy in `EXECUTION_MODEL.md`.
4. **Cross-agent subscription management:** do we need `event:admin` for managing subscriptions on behalf of other agents?