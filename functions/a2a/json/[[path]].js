// A2A v1.0 HTTP+JSON method surface for the interface declared in the Agent
// Card at /.well-known/agent-card.json:
//
//     supportedInterfaces[0] = { url: "https://a2atraffic.com/a2a/json",
//                                protocolBinding: "HTTP+JSON",
//                                protocolVersion: "1.0" }
//
// Paths are the google.api.http annotations on a2a.proto's A2AService, taken
// relative to that URL (a2a.proto:23-135). The /v1 prefix was dropped in 1.0.
//
// WHAT THIS AGENT IS. It answers two skills out of the same frozen records the
// homepage is generated from. It holds no state of any kind: a Pages Function
// has no storage bound to it here, and none is wanted. That is why SendMessage
// returns a Message and never a Task —
//
//   A Task is a RETRIEVABLE RESOURCE. Returning one is a promise that GetTask
//   will find it. Nothing is stored, so that promise would be false on the very
//   next request. SendMessageResponse is a oneof of Task or Message
//   (a2a.proto: SendMessageResponse.payload), and an agent that finishes its
//   work inside the request is entitled to the Message arm. So the task methods
//   below are not stubs that pretend — ListTasks returns an empty page because
//   the list IS empty, and GetTask returns TaskNotFoundError because no id has
//   ever existed. Those are true answers, not placeholders.
//
// capabilities.streaming and capabilities.pushNotifications are false in the
// card, so the streaming and push methods return the errors the spec requires
// for a capability the card does not declare (spec §3.3.4).

import { problem, json, preflight, checkVersion, checkContentType, textOf, agentMessage, record, A2A_VERSION } from "../_lib.js";
import { protocolReference, gapMatrix, route } from "../_skills.js";
import { baseDescriptor } from "../_base.js";

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (request.method === "OPTIONS") return preflight();

  const bad = checkVersion(request);
  if (bad) return bad;

  const segs = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
  const path = segs.join("/");
  const M = request.method;

  // The interface base URL. A catch-all matches its own parent with no segments,
  // so /a2a/json arrives here rather than at a sibling route; see _base.js.
  if (segs.length === 0) {
    if (M !== "GET") return methodNotAllowed(M, "GET", "a2a/json");
    return baseDescriptor(request);
  }

  // POST /message:send
  if (path === "message:send") {
    if (M !== "POST") return methodNotAllowed(M, "POST", path);
    const ctBad = checkContentType(request);
    if (ctBad) return ctBad;
    return sendMessage(request, env);
  }

  // POST /message:stream — capabilities.streaming is false
  if (path === "message:stream") {
    return problem(
      "UnsupportedOperationError",
      "This agent does not support streaming. capabilities.streaming is false in its Agent Card. Every answer it can give is complete inside a single SendMessage response, so there is nothing to stream.",
    );
  }

  // GET /extendedAgentCard — capabilities.extendedAgentCard is false
  if (path === "extendedAgentCard") {
    return problem(
      "ExtendedAgentCardNotConfiguredError",
      "No extended Agent Card is configured. capabilities.extendedAgentCard is false, and this agent has no authenticated surface to describe: everything it knows is already public at /records/.",
    );
  }

  // push notification configs — capabilities.pushNotifications is false
  if (segs.includes("pushNotificationConfigs")) {
    return problem(
      "PushNotificationNotSupportedError",
      "This agent does not support push notifications. capabilities.pushNotifications is false in its Agent Card, and it creates no tasks to notify about.",
    );
  }

  // GET /tasks — ListTasks
  if (path === "tasks") {
    if (M !== "GET") return methodNotAllowed(M, "GET", path);
    const url = new URL(request.url);
    const raw = parseInt(url.searchParams.get("pageSize") || "", 10);
    const pageSize = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 50;
    // Truthfully empty. This agent creates no tasks; see the header comment.
    return json({ tasks: [], nextPageToken: "", pageSize, totalSize: 0 });
  }

  // GET /tasks/{id}:subscribe — capabilities.streaming is false
  if (segs[0] === "tasks" && segs.length === 2 && segs[1].endsWith(":subscribe")) {
    return problem(
      "UnsupportedOperationError",
      "This agent does not support task subscription. capabilities.streaming is false and no task exists to subscribe to.",
    );
  }

  // POST /tasks/{id}:cancel — CancelTask
  if (segs[0] === "tasks" && segs.length === 2 && segs[1].endsWith(":cancel")) {
    const id = segs[1].slice(0, -":cancel".length);
    return problem(
      "TaskNotFoundError",
      `No task with id "${decodeURIComponent(id)}" exists. This agent creates no tasks — SendMessage answers with a Message, so there has never been a task to cancel.`,
    );
  }

  // GET /tasks/{id} — GetTask
  if (segs[0] === "tasks" && segs.length === 2) {
    if (M !== "GET") return methodNotAllowed(M, "GET", path);
    return problem(
      "TaskNotFoundError",
      `No task with id "${decodeURIComponent(segs[1])}" exists. This agent creates no tasks — SendMessage answers with a Message, so no id has ever been issued.`,
    );
  }

  return problem(
    "UnsupportedOperationError",
    `"/${path}" is not an A2A method on this interface. Implemented: POST /message:send, GET /tasks, GET /tasks/{id}, POST /tasks/{id}:cancel. Declared-and-refused: /message:stream, /tasks/{id}:subscribe, /tasks/{id}/pushNotificationConfigs, /extendedAgentCard.`,
  );
}

function methodNotAllowed(got, want, path) {
  return problem(
    "UnsupportedOperationError",
    `${got} is not allowed on /${path}. The A2A HTTP+JSON binding defines it as ${want}.`,
  );
}

async function sendMessage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return problem("ContentTypeNotSupportedError", "Request body is not valid JSON.");
  }

  const message = body && body.message;
  if (!message || typeof message !== "object") {
    return problem("ContentTypeNotSupportedError", "SendMessageRequest.message is REQUIRED (a2a.proto: field_behavior REQUIRED).");
  }
  if (!message.messageId) {
    return problem("ContentTypeNotSupportedError", "Message.messageId is REQUIRED and was absent.");
  }
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return problem("ContentTypeNotSupportedError", "Message.parts is REQUIRED and must contain at least one Part.");
  }
  if (message.role && message.role !== "ROLE_USER") {
    return problem(
      "ContentTypeNotSupportedError",
      `Message.role was "${message.role}". A client message must carry ROLE_USER; v1.0 replaced the bare "user" string with the ROLE_USER enum name.`,
    );
  }

  const text = textOf(message);
  if (!text) {
    return problem(
      "ContentTypeNotSupportedError",
      'No text Part was present. This agent reads only text parts. In v1.0 a Part is discriminated by member presence — send {"text": "..."} , not {"kind": "text", ...}, which is the v0.3 shape.',
    );
  }

  const skill = route(text);
  let answer;
  try {
    answer =
      skill === "gap-matrix"
        ? gapMatrix(text, await record(env, request, "gap-matrix"))
        : protocolReference(text, await record(env, request, "protocol"));
  } catch (e) {
    return problem("InvalidAgentResponseError", `The record backing skill "${skill}" could not be read: ${e.message}`);
  }

  return json(agentMessage(answer.parts, { contextId: message.contextId }));
}

export const _version = A2A_VERSION;
