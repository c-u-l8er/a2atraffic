# A2A Traffic — Component Project Spec

A2A Traffic is the portfolio’s **event routing agent**.

It exists to move events/messages between agents (and optionally external sources) in a way that is:

- auditable
- deduped
- permissioned

## Responsibilities

- Topic-based publish/subscribe between agents
- Durable signal emission for inbound events
- Optional webhook ingestion adapters (future)

## Event model

Treat delivered events as signal-like facts.

Recommended fields:

- `topic` (string)
- `message_id` (string; source-specific)
- `occurred_at` (timestamp)
- `source` (string)
- `payload` (object; secret-free)
- `dedupe_key` (string)

## Tools (as OpenSentience Agent)

- `a2a_publish({"topic": string, "payload": object, "dedupe_key"?: string})`
- `a2a_subscribe({"topic": string})`
- `a2a_unsubscribe({"topic": string})`
- `a2a_list_subscriptions({})`

## Security

- Enforce per-agent allowlists for publish/subscribe topics.
- Dedupe and signature verification required for external webhooks.
- No secrets in payloads.

## MVP slice

1. In-memory routing between agents running under OpenSentience Core
2. Durable log of published events (audit)
3. Subscription management
