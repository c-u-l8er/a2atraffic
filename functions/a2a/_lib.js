// Shared machinery for the A2A HTTP+JSON interface at /a2a/json.
//
// Underscore-prefixed, so the Pages router does not expose it as a route.
//
// EVERY protocol shape in this file was derived on 2026-09-05 from two primary
// sources, never from a blog post or an SDK:
//   - a2aproject/A2A@main/specification/a2a.proto  (field names, REQUIRED via
//     google.api.field_behavior, the google.api.http path annotations)
//   - https://a2a-protocol.org/latest/specification/  (§5.4 error mappings and
//     the worked request/response examples in §6)
//
// One thing measured there disagrees with records/protocol.json, verified
// 2026-08-17, and it is recorded in that record under drift_2026_09_05 rather
// than reconciled here: ListTasks pagination is pageSize / pageToken /
// nextPageToken, not cursor / limit / nextCursor. "cursor" occurs nowhere in
// the proto, and §6.5's worked example shows pageSize / nextPageToken /
// totalSize. A record is changed by a dated re-measurement, not by an
// implementation that happens to disagree with it.
//
// A SECOND disagreement was claimed here and WAS WRONG — this comment said the
// binding carried errors as RFC 9457 problem+json and that the record had it
// backwards. §11.6, the HTTP binding's own error section, is normative and says
// the opposite: errors are the google.rpc.Status JSON representation, under an
// `error` key, with Content-Type application/a2a+json, and an A2A-specific error
// MUST carry a google.rpc.ErrorInfo in details[] with reason in UPPER_SNAKE_CASE
// and domain a2a-protocol.org. That is exactly what the record said. The
// problem+json in §6.4 is a single version-negotiation example and generalising
// from it was the error. This file implements §11.6.

export const A2A_VERSION = "1.0";
export const CT_A2A = "application/a2a+json";
// Errors use the same media type as success responses (§11.6 example).

// §5.4 maps every A2A error to a gRPC status and an HTTP status; §11.6 requires
// the gRPC status NAME in error.status and a google.rpc.ErrorInfo in details[]
// whose `reason` is the error in UPPER_SNAKE_CASE — the example there confirms
// TaskNotFoundError -> TASK_NOT_FOUND, which is the rule the rest follow.
const ERRORS = {
  TaskNotFoundError: [404, "NOT_FOUND", "TASK_NOT_FOUND"],
  TaskNotCancelableError: [400, "FAILED_PRECONDITION", "TASK_NOT_CANCELABLE"],
  PushNotificationNotSupportedError: [400, "FAILED_PRECONDITION", "PUSH_NOTIFICATION_NOT_SUPPORTED"],
  UnsupportedOperationError: [400, "FAILED_PRECONDITION", "UNSUPPORTED_OPERATION"],
  ContentTypeNotSupportedError: [400, "INVALID_ARGUMENT", "CONTENT_TYPE_NOT_SUPPORTED"],
  InvalidAgentResponseError: [500, "INTERNAL", "INVALID_AGENT_RESPONSE"],
  ExtendedAgentCardNotConfiguredError: [400, "FAILED_PRECONDITION", "EXTENDED_AGENT_CARD_NOT_CONFIGURED"],
  ExtensionSupportRequiredError: [400, "FAILED_PRECONDITION", "EXTENSION_SUPPORT_REQUIRED"],
  VersionNotSupportedError: [400, "FAILED_PRECONDITION", "VERSION_NOT_SUPPORTED"],
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, a2a-version, authorization",
  "access-control-max-age": "86400",
};

export function json(body, { status = 200, contentType = CT_A2A } = {}) {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": `${contentType}; charset=utf-8`, "cache-control": "no-store", ...CORS },
  });
}

// google.rpc.Status JSON, per §11.6. `metadata` is google.rpc.ErrorInfo's
// map<string, string>, so every value is stringified rather than nested.
export function a2aError(name, message, metadata = {}) {
  const [status, grpc, reason] = ERRORS[name] || [500, "INTERNAL", "INTERNAL"];
  return json(
    {
      error: {
        code: status,
        status: grpc,
        message,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason,
            domain: "a2a-protocol.org",
            metadata: Object.fromEntries(
              Object.entries({ a2aError: name, ...metadata }).map(([k, v]) => [
                k,
                typeof v === "string" ? v : JSON.stringify(v),
              ]),
            ),
          },
        ],
      },
    },
    { status },
  );
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

// The agent reads the SAME published records the homepage is generated from,
// over this origin's own asset store — the exact bytes anyone can curl at
// /records/*.json. It has no second copy of the facts and therefore cannot
// disagree with the page.
export async function record(env, request, name) {
  const url = new URL(`/records/${name}.json`, request.url);
  const res = env && env.ASSETS && env.ASSETS.fetch
    ? await env.ASSETS.fetch(new Request(url, { headers: { accept: "application/json" } }))
    : await fetch(url);
  if (!res.ok) throw new Error(`record ${name} unavailable (${res.status})`);
  return res.json();
}

export function checkVersion(request) {
  const v = request.headers.get("a2a-version");
  if (v && v !== A2A_VERSION) {
    return a2aError(
      "VersionNotSupportedError",
      `The requested A2A protocol version ${v} is not supported by this agent.`,
      { supportedVersions: [A2A_VERSION] },
    );
  }
  return null;
}

export function checkContentType(request) {
  const ct = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== CT_A2A && ct !== "application/json") {
    return a2aError(
      "ContentTypeNotSupportedError",
      `Request media type ${ct} is not supported. Send ${CT_A2A} (application/json is also accepted).`,
    );
  }
  return null;
}

export function textOf(message) {
  // v1.0 Part is a oneof discriminated by MEMBER PRESENCE, not by a `kind`
  // discriminator (proto: oneof content { text, raw, url, data }). Reading
  // part.kind here would be the v0.3 shape.
  return (message.parts || [])
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function agentMessage(parts, { contextId } = {}) {
  return {
    message: {
      messageId: crypto.randomUUID(),
      role: "ROLE_AGENT",
      parts,
      ...(contextId ? { contextId } : {}),
    },
  };
}

export function dataPart(value) {
  return { data: value, mediaType: "application/json" };
}

export function textPart(s) {
  return { text: s, mediaType: "text/plain" };
}
