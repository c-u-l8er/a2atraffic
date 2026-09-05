import { readFileSync } from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// ONE entry point, because Cloudflare has one: the catch-all at
// functions/a2a/json/[[path]].js matches /a2a/json AND everything under it. The
// first version of this harness dispatched the base URL to a separate module,
// which is why it did not catch that module being shadowed in production. A test
// harness that routes differently from the platform tests a different program.
const { onRequest: handler } = await import(`${ROOT}/functions/a2a/json/[[path]].js`);

const env = { ASSETS: { fetch: async (req) => {
  const p = new URL(req.url).pathname;
  try { return new Response(readFileSync(ROOT + p), { headers: { "content-type": "application/json" } }); }
  catch { return new Response("nope", { status: 404 }); }
}}};

const call = async (method, path, body, headers = {}) => {
  const url = `https://a2atraffic.com${path}`;
  const req = new Request(url, { method, headers: { ...(body ? { "content-type": "application/a2a+json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const segs = path.split("?")[0].replace(/^\/a2a\/json\/?/, "").split("/").filter(Boolean);
  const res = await handler({ request: req, env, params: { path: segs } });
  const txt = await res.text();
  return { status: res.status, ct: res.headers.get("content-type"), body: txt };
};

const msg = (t) => ({ message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: t }] } });
let fails = 0;
const t = async (label, fn) => { try { await fn(); console.log("  ok  ", label); } catch (e) { fails++; console.log("  FAIL", label, "->", e.message); } };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

console.log("A2A endpoint, local exercise\n");

await t("the base URL reaches the descriptor through the catch-all", async () => {
  const r = await call("GET", "/a2a/json");
  eq(r.status, 200, "status"); if (!r.ct.startsWith("application/json")) throw new Error(r.ct);
  const j = JSON.parse(r.body); eq(j.implemented.length, 4, "implemented");
});

await t("SendMessage / gap-matrix by dimension word", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("what can A2A not express about membership?"));
  eq(r.status, 200, "status"); if (!r.ct.startsWith("application/a2a+json")) throw new Error(r.ct);
  const j = JSON.parse(r.body);
  eq(j.message.role, "ROLE_AGENT", "role");
  const d = j.message.parts.find((p) => p.data).data;
  eq(d.skill, "gap-matrix", "skill"); eq(d.matched, "G1", "dimension");
  if (!d.source.paper.status_note.includes("NOT peer-reviewed")) throw new Error("preprint caveat missing");
});

await t("SendMessage / gap-matrix by protocol name", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("score MCP against the governance taxonomy"));
  const d = JSON.parse(r.body).message.parts.find((p) => p.data).data;
  eq(d.skill, "gap-matrix", "skill"); eq(d.protocol.coverage, "1/12", "coverage");
});

await t("SendMessage / protocol-reference discovery", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("what is the well-known path for an Agent Card?"));
  const d = JSON.parse(r.body).message.parts.find((p) => p.data).data;
  eq(d.skill, "protocol-reference", "skill"); eq(d.matched, "discovery", "topic");
  eq(d.discovery.well_known_path, "/.well-known/agent-card.json", "path");
});

await t("SendMessage / protocol-reference migration", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("what replaced preferredTransport in v1.0?"));
  const d = JSON.parse(r.body).message.parts.find((p) => p.data).data;
  eq(d.matched, "migration", "topic");
});

await t("unmatched request refuses instead of guessing", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("zzzz qqqq"));
  eq(r.status, 200, "status");
  const d = JSON.parse(r.body).message.parts.find((p) => p.data).data;
  eq(d.matched, null, "matched"); if (!d.topics.length) throw new Error("no topics listed");
});

await t("a v0.3-shaped text Part is still READ (it carries `text`)", async () => {
  // Deliberately permissive. {kind:"text", text:"hi"} is the v0.3 shape, but the
  // member this agent reads is present, so refusing it would be pedantry rather
  // than correctness. The v1.0 rule that matters is that presence discriminates.
  const r = await call("POST", "/a2a/json/message:send", { message: { messageId: "m", role: "ROLE_USER", parts: [{ kind: "text", text: "what bindings exist?" }] } });
  eq(r.status, 200, "status");
});

await t("a Part with no text member is refused, naming the v0.3 shape", async () => {
  const r = await call("POST", "/a2a/json/message:send", { message: { messageId: "m", role: "ROLE_USER", parts: [{ kind: "file", file: { uri: "x" } }] } });
  eq(r.status, 400, "status");
  if (!JSON.parse(r.body).detail.includes("v0.3")) throw new Error("no v0.3 hint");
});

await t("missing messageId is a 400 problem+json", async () => {
  const r = await call("POST", "/a2a/json/message:send", { message: { role: "ROLE_USER", parts: [{ text: "hi" }] } });
  eq(r.status, 400, "status"); if (!r.ct.startsWith("application/problem+json")) throw new Error(r.ct);
  eq(JSON.parse(r.body).a2aError, "ContentTypeNotSupportedError", "error");
});

await t("ListTasks is an empty page, not an error", async () => {
  const r = await call("GET", "/a2a/json/tasks");
  eq(r.status, 200, "status");
  eq(JSON.parse(r.body), { tasks: [], nextPageToken: "", pageSize: 50, totalSize: 0 }, "body");
});

await t("pageSize is clamped to the spec's 1..100", async () => {
  eq(JSON.parse((await call("GET", "/a2a/json/tasks?pageSize=999")).body).pageSize, 100, "clamp hi");
  eq(JSON.parse((await call("GET", "/a2a/json/tasks?pageSize=0")).body).pageSize, 1, "clamp lo");
});

await t("GetTask is TaskNotFoundError 404", async () => {
  const r = await call("GET", "/a2a/json/tasks/abc-123");
  eq(r.status, 404, "status"); eq(JSON.parse(r.body).a2aError, "TaskNotFoundError", "error");
  eq(JSON.parse(r.body).type, "https://a2a-protocol.org/errors/task-not-found", "type");
});

await t("CancelTask is TaskNotFoundError", async () => {
  const r = await call("POST", "/a2a/json/tasks/abc:cancel");
  eq(r.status, 404, "status"); eq(JSON.parse(r.body).a2aError, "TaskNotFoundError", "error");
});

await t("streaming refuses because the card says false", async () => {
  const r = await call("POST", "/a2a/json/message:stream", msg("hi"));
  eq(r.status, 400, "status"); eq(JSON.parse(r.body).a2aError, "UnsupportedOperationError", "error");
});

await t("push config refuses with its own error name", async () => {
  const r = await call("POST", "/a2a/json/tasks/x/pushNotificationConfigs", {});
  eq(JSON.parse(r.body).a2aError, "PushNotificationNotSupportedError", "error");
});

await t("extendedAgentCard refuses with its own error name", async () => {
  const r = await call("GET", "/a2a/json/extendedAgentCard");
  eq(JSON.parse(r.body).a2aError, "ExtendedAgentCardNotConfiguredError", "error");
});

await t("A2A-Version negotiation", async () => {
  const r = await call("POST", "/a2a/json/message:send", msg("version"), { "a2a-version": "0.5" });
  eq(r.status, 400, "status"); eq(JSON.parse(r.body).a2aError, "VersionNotSupportedError", "error");
  eq(JSON.parse(r.body).supportedVersions, ["1.0"], "supportedVersions");
  eq((await call("POST", "/a2a/json/message:send", msg("version"), { "a2a-version": "1.0" })).status, 200, "1.0 accepted");
});

await t("contextId is echoed when the client sets one", async () => {
  const req = { message: { messageId: "m", contextId: "ctx-9", role: "ROLE_USER", parts: [{ text: "bindings" }] } };
  const r = await call("POST", "/a2a/json/message:send", req);
  eq(JSON.parse(r.body).message.contextId, "ctx-9", "contextId");
});

await t("unknown method under the interface refuses", async () => {
  const r = await call("GET", "/a2a/json/nope");
  eq(r.status, 400, "status"); eq(JSON.parse(r.body).a2aError, "UnsupportedOperationError", "error");
});

// The card advertises examples[] per skill. An example that routes to the OTHER
// skill is the card promising something the agent does not do — the same defect
// class as a card at a discovery path with nothing behind it. This is what
// caught "What replaced preferredTransport in v1.0?" being answered by the
// bindings topic instead of the migration topic.
await t("every examples[] in the Agent Card routes to the skill that declares it", async () => {
  const card = JSON.parse(readFileSync(`${ROOT}/records/agent-card.draft.json`, "utf8"));
  let n = 0;
  for (const skill of card.skills) {
    for (const ex of skill.examples || []) {
      const r = await call("POST", "/a2a/json/message:send", msg(ex));
      if (r.status !== 200) throw new Error(`${skill.id} / "${ex}" -> HTTP ${r.status}`);
      const d = JSON.parse(r.body).message.parts.find((x) => x.data).data;
      if (d.skill !== skill.id) throw new Error(`"${ex}" is declared under ${skill.id} but routed to ${d.skill}`);
      if (d.matched === null) throw new Error(`"${ex}" is declared under ${skill.id} but matched no topic`);
      n++;
    }
  }
  if (n === 0) throw new Error("no examples found in the card");
  console.log(`        (${n} declared examples, all routed to their own skill)`);
});

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
