// The two skills the Agent Card declares, and nothing else.
//
// THIS AGENT DOES NOT INTERPRET NATURAL LANGUAGE. It matches keywords against a
// fixed table and answers out of records/*.json. That is a real limitation and
// every unmatched request says so in its own body rather than guessing. There is
// no model here, no inference, and no capacity for the answer to drift from what
// the homepage prints — both read the same record.

import { dataPart, textPart } from "./_lib.js";

const has = (t, ...words) => words.some((w) => t.includes(w));

// ── skill: protocol-reference ──────────────────────────────────────────────
// Verified facts about A2A v1.0, out of records/protocol.json.

// ORDER IS LOAD-BEARING: first match wins. `migration` must be tested before
// `bindings`, because "preferredTransport" contains "transport" and would
// otherwise be answered with the list of protocol bindings. That exact string is
// one of the examples[] this skill advertises in the Agent Card — "What replaced
// preferredTransport in v1.0?" — so the wrong order makes the card advertise a
// question the agent answers wrongly. Caught by test/a2a.mjs, not by reading.
const PROTOCOL_TOPICS = [
  {
    id: "discovery",
    match: (t) => has(t, "well-known", "well known", "discovery", "agent-card.json", "card path", "where is the card"),
    pick: (p) => ({ topic: "discovery", discovery: p.discovery }),
    say: (p) => `The Agent Card is published at ${p.discovery.well_known_path} (${p.discovery.rfc}). The pre-1.0 path ${p.discovery.superseded_path} is superseded.`,
  },
  {
    id: "migration",
    match: (t) => has(t, "migrat", "v0.3", "0.3", "changed", "change", "delta", "preferredtransport", "upgrade", "breaking"),
    pick: (p) => ({ topic: "migration", changes_v03_to_v10: p.changes_v03_to_v10 }),
    say: (p) => `${p.changes_v03_to_v10.length} recorded changes from v0.3 to v${p.latest_version}, across: ${p.changes_v03_to_v10.map((c) => c.area).join(", ")}.`,
  },

  {
    id: "bindings",
    match: (t) => has(t, "binding", "transport", "grpc", "json-rpc", "jsonrpc", "http+json", "rest"),
    pick: (p) => ({ topic: "bindings", bindings: p.bindings }),
    say: (p) => `A2A ${p.latest_version} defines ${p.bindings.length} protocol bindings: ${p.bindings.map((b) => b.id).join(", ")}.`,
  },
  {
    id: "task_states",
    match: (t) => has(t, "state", "states", "lifecycle", "terminal", "working", "submitted"),
    pick: (p) => ({ topic: "task_states", task_states: p.task_states }),
    say: (p) => {
      const by = (k) => p.task_states.filter((s) => s.kind === k).length;
      return `${p.task_states.length} task states: ${by("open")} open, ${by("interrupted")} interrupted, ${by("terminal")} terminal, ${by("unknown")} unknown.`;
    },
  },
  {
    id: "methods",
    match: (t) => has(t, "method", "methods", "rpc", "sendmessage", "gettask", "listtasks", "operation"),
    pick: (p) => ({ topic: "methods", methods: p.methods }),
    say: (p) => `${p.methods.length} methods, v1.0 names with their v0.3 equivalents: ${p.methods.map((m) => m.v1).join(", ")}.`,
  },  {
    id: "agent_card_fields",
    match: (t) => has(t, "required", "field", "fields", "schema", "shape", "what goes in a card"),
    pick: (p) => ({
      topic: "agent_card_fields",
      required: p.agent_card_required_fields,
      optional: p.agent_card_optional_fields,
      note: p._agent_card_fields_comment,
    }),
    say: (p) => `An AgentCard has ${p.agent_card_required_fields.length} required fields (${p.agent_card_required_fields.join(", ")}) and ${p.agent_card_optional_fields.length} optional.`,
  },
  {
    id: "version",
    match: (t) => has(t, "version", "latest", "current"),
    pick: (p) => ({ topic: "version", latest_version: p.latest_version, verified_at: p.verified_at }),
    say: (p) => `The current A2A version is ${p.latest_version}, read from ${p.verified_against} on ${p.verified_at}.`,
  },
];

export function protocolReference(text, p) {
  const t = text.toLowerCase();
  const topic = PROTOCOL_TOPICS.find((x) => x.match(t));
  const cite = {
    record: "/records/protocol.json",
    verified_at: p.verified_at,
    verified_against: p.verified_against,
    spec: p.sources.spec,
    proto: p.sources.proto,
  };

  if (!topic) {
    return {
      matched: false,
      parts: [
        textPart(
          `Skill "protocol-reference" matched no topic in that request. It answers on: ${PROTOCOL_TOPICS.map((x) => x.id).join(", ")}. This agent matches keywords; it does not interpret language.`,
        ),
        dataPart({ skill: "protocol-reference", matched: null, topics: PROTOCOL_TOPICS.map((x) => x.id), source: cite }),
      ],
    };
  }

  return {
    matched: true,
    parts: [
      textPart(topic.say(p)),
      dataPart({ skill: "protocol-reference", matched: topic.id, ...topic.pick(p), source: cite }),
    ],
  };
}

// ── skill: gap-matrix ──────────────────────────────────────────────────────
// The six-dimension governance assessment, out of records/gap-matrix.json.

const DIM_WORDS = {
  G1: ["g1", "membership", "admission", "join", "removal", "invit"],
  G2: ["g2", "deliberat", "discussion", "debate"],
  G3: ["g3", "voting", "vote", "ballot", "quorum"],
  G4: ["g4", "dissent", "minority", "objection"],
  G5: ["g5", "escalat", "human in the loop", "human-in-the-loop"],
  G6: ["g6", "audit", "replay", "provenance", "log"],
};

export function gapMatrix(text, g) {
  const t = text.toLowerCase();
  const cite = {
    record: "/records/gap-matrix.json",
    verified_at: g.verified_at,
    paper: {
      title: g.paper.title,
      authors: g.paper.authors,
      arxiv: g.paper.arxiv,
      url: g.paper.url,
      status: g.paper.status,
      status_note: g.paper.status_note,
    },
    scoring: g.scoring_note,
  };

  const proto = g.protocols.find(
    (p) => t.includes(p.id) || t.includes(p.label.toLowerCase().split(" ")[0]),
  );
  const dimId = Object.keys(DIM_WORDS).find((k) => DIM_WORDS[k].some((w) => t.includes(w)));

  if (dimId) {
    const d = g.dimensions.find((x) => x.id === dimId);
    const scores = g.protocols.map((p) => ({ protocol: p.label, score: p.scores[dimId] }));
    return {
      matched: true,
      parts: [
        textPart(
          `${d.id} ${d.name}: A2A scores "${d.a2a}". What it transports: ${d.a2a_transports} What it cannot express: ${d.a2a_cannot}`,
        ),
        dataPart({ skill: "gap-matrix", matched: d.id, dimension: d, scores_across_protocols: scores, source: cite }),
      ],
    };
  }

  if (proto) {
    return {
      matched: true,
      parts: [
        textPart(
          `${proto.label} scores ${proto.coverage} on the six-dimension governance taxonomy. Per dimension: ${Object.entries(proto.scores).map(([k, v]) => `${k} ${v}`).join(", ")}. ${g.paper.status_note}`,
        ),
        dataPart({ skill: "gap-matrix", matched: proto.id, protocol: proto, source: cite }),
      ],
    };
  }

  // No protocol and no dimension named: return the whole matrix. This is a real
  // answer, not a fallback — "what does the matrix say" is the common question.
  return {
    matched: true,
    parts: [
      textPart(
        `${g.paper.headline} Coverage by protocol: ${g.protocols.map((p) => `${p.label} ${p.coverage}`).join(", ")}. ${g.scoring_note} Source: ${g.paper.title} (arXiv ${g.paper.arxiv}) — ${g.paper.status_note}`,
      ),
      dataPart({
        skill: "gap-matrix",
        matched: "matrix",
        dimensions: g.dimensions.map((d) => ({ id: d.id, name: d.name, definition: d.definition, a2a: d.a2a })),
        protocols: g.protocols,
        version_drift: g.version_drift,
        source: cite,
      }),
    ],
  };
}

// ── routing between the two ────────────────────────────────────────────────

export function route(text) {
  const t = text.toLowerCase();
  const gapish =
    has(t, "govern", "gap", "matrix", "score", "coverage", "taxonomy", "cannot express", "membership", "deliberat", "voting", "dissent", "escalat", "audit") ||
    Object.values(DIM_WORDS).some((ws) => ws.some((w) => t.includes(w)));
  return gapish ? "gap-matrix" : "protocol-reference";
}
