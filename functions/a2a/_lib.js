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
// Two things measured there DISAGREE with records/protocol.json, which was
// verified 2026-08-17. Both are recorded in records/protocol.json under
// drift_2026_09_05 rather than silently corrected here, because a record is
// changed by a dated re-measurement and not by an implementation that happens
// to disagree with it:
//   1. ListTasks pagination is pageSize / pageToken / nextPageToken. The record
//      says cursor / limit / nextCursor. "cursor" appears nowhere in the proto.
//   2. The HTTP+JSON binding carries errors as RFC 9457 application/problem+json
//      (spec §6.4 shows one). The record says errors moved AWAY from problem+json
//      to google.rpc.Status. google.rpc.Status is the gRPC binding's shape.
// This file implements what the sources say, because that is what a client will
// send and expect.

export const A2A_VERSION = "1.0";
export const CT_A2A = "application/a2a+json";
export const CT_PROBLEM = "application/problem+json";

// a2a-protocol.org/latest/specification/ §5.4, the HTTP column. The `type` URI
// slug is INFERRED from the single worked example in §6.4
// (VersionNotSupportedError -> .../errors/version-not-supported); the spec does
// not tabulate the slugs. Marked as inference, not measurement.
const ERRORS = {
  TaskNotFoundError: [404, "task-not-found", "Task Not Found"],
  TaskNotCancelableError: [400, "task-not-cancelable", "Task Not Cancelable"],
  PushNotificationNotSupportedError: [400, "push-notification-not-supported", "Push Notification Not Supported"],
  UnsupportedOperationError: [400, "unsupported-operation", "Unsupported Operation"],
  ContentTypeNotSupportedError: [400, "content-type-not-supported", "Content Type Not Supported"],
  InvalidAgentResponseError: [500, "invalid-agent-response", "Invalid Agent Response"],
  ExtendedAgentCardNotConfiguredError: [400, "extended-agent-card-not-configured", "Extended Agent Card Not Configured"],
  ExtensionSupportRequiredError: [400, "extension-support-required", "Extension Support Required"],
  VersionNotSupportedError: [400, "version-not-supported", "Version Not Supported"],
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

// RFC 9457 problem detail. `extra` carries the spec's non-standard members,
// e.g. supportedVersions on a version error (§6.4).
export function problem(name, detail, extra = {}) {
  const [status, slug, title] = ERRORS[name] || [500, "internal", "Internal Error"];
  return json(
    { type: `https://a2a-protocol.org/errors/${slug}`, title, status, detail, a2aError: name, ...extra },
    { status, contentType: CT_PROBLEM },
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
    return problem(
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
    return problem(
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
