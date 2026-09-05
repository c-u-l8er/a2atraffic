// The interface base URL itself, GET /a2a/json.
//
// MEASURED 2026-09-05: this cannot be its own route. A Pages catch-all at
// functions/a2a/json/[[path]].js also matches the PARENT path /a2a/json, with an
// empty segment list, and shadows a sibling functions/a2a/json.js completely —
// the sibling deployed and was never reached, and /a2a/json answered the
// catch-all's "no such method" 400. So this is an underscore module the
// catch-all calls when it sees no segments, not a route of its own.
//
// This is NOT an A2A method. The HTTP+JSON binding defines no operation at the
// base URL; every method hangs off it (POST /message:send, GET /tasks, ...).
// A client that finds this endpoint through the Agent Card never fetches this
// path. It exists because a human who reads the card will paste the URL into a
// browser, and an empty 404 there teaches them nothing.
//
// It answers application/json, deliberately NOT application/a2a+json, so that
// nothing here can be mistaken for a protocol response.

import { json, A2A_VERSION } from "./_lib.js";

export function baseDescriptor(request) {
  const base = new URL("/a2a/json", request.url).toString();

  return json(
    {
      not_a_method:
        "The A2A HTTP+JSON binding defines no operation at an interface base URL. This is a human-readable description of the interface, not a protocol response.",
      interface: { url: base, protocolBinding: "HTTP+JSON", protocolVersion: A2A_VERSION },
      agent_card: new URL("/.well-known/agent-card.json", request.url).toString(),
      implemented: [
        { method: "SendMessage", http: `POST ${base}/message:send` },
        { method: "ListTasks", http: `GET ${base}/tasks` },
        { method: "GetTask", http: `GET ${base}/tasks/{id}` },
        { method: "CancelTask", http: `POST ${base}/tasks/{id}:cancel` },
      ],
      refused_and_why: [
        { method: "SendStreamingMessage", http: `POST ${base}/message:stream`, error: "UnsupportedOperationError", because: "capabilities.streaming is false" },
        { method: "SubscribeToTask", http: `GET ${base}/tasks/{id}:subscribe`, error: "UnsupportedOperationError", because: "capabilities.streaming is false" },
        { method: "CreateTaskPushNotificationConfig", http: `POST ${base}/tasks/{id}/pushNotificationConfigs`, error: "PushNotificationNotSupportedError", because: "capabilities.pushNotifications is false" },
        { method: "GetExtendedAgentCard", http: `GET ${base}/extendedAgentCard`, error: "ExtendedAgentCardNotConfiguredError", because: "capabilities.extendedAgentCard is false" },
      ],
      skills: ["gap-matrix", "protocol-reference"],
      limits: [
        "No state. Nothing is stored between requests, so this agent creates no Tasks: SendMessage answers with a Message. ListTasks is empty because the list is empty; GetTask is TaskNotFoundError because no id has ever been issued.",
        "No model. Requests are routed to a skill by keyword match, not by language understanding. An unmatched request says so and lists what it can answer.",
        "No signature. The Agent Card carries no signatures[], so nothing here is cryptographically bound to this domain.",
        "Answers are read at request time from /records/*.json — the same published records the homepage is generated from.",
      ],
      example: `curl -sS -X POST ${base}/message:send -H 'content-type: application/a2a+json' -d '{"message":{"messageId":"1","role":"ROLE_USER","parts":[{"text":"what can A2A not express about membership?"}]}}'`,
    },
    { contentType: "application/json" },
  );
}
