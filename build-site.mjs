#!/usr/bin/env node
// a2atraffic.com — emit index.html from src/index.template.html + records/*.json
//
// Rule this file exists to enforce: NO NUMBER, RUNG OR PROTOCOL FACT MAY REACH
// THE PAGE THAT IS NOT DERIVED FROM A RECORD. If you find yourself typing a
// figure into the template, it belongs in records/ instead.
//
// There is deliberately no `new Date()` anywhere in this build. A wall-clock
// read at render time is a leak: it makes two builds of the same records differ,
// which is how a page starts claiming freshness it has not got. Dates come from
// records/surface.json:verified_at. (This defect was found in agentelic.com's
// build twice; do not reintroduce it here.)

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const R = (p) => join(ROOT, p);
const readJSON = (p) => JSON.parse(readFileSync(R(p), "utf8"));

const surface = readJSON("records/surface.json");
const protocol = readJSON("records/protocol.json");
const gap = readJSON("records/gap-matrix.json");
const witness = readJSON("records/witness.json");
const draftCard = readJSON("records/agent-card.draft.json");
const invariants = readJSON("records/invariants.json");

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const chip = (rung) =>
  `<span class="rung-chip" data-rung="${esc(rung)}">${esc(rung)}</span>`;

const link = (href, text) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

const fail = (msg) => {
  console.error(`\x1b[31mbuild refused:\x1b[0m ${msg}`);
  process.exit(1);
};

// ── preconditions ──────────────────────────────────────────────────────────
if (!/^\d{4}-\d{2}-\d{2}$/.test(surface.verified_at))
  fail("surface.verified_at must be an ISO date; it is the only clock this build has.");

for (const [name, rec] of Object.entries({ protocol, gap, witness })) {
  if (rec.verified_at !== surface.verified_at)
    fail(
      `records/${name}*.json verified_at (${rec.verified_at}) disagrees with surface.json (${surface.verified_at}). ` +
        `Re-derive the record or correct the date; do not paper over it.`,
    );
}

// The nav is vendored, not fetched. An unknown property key renders an empty
// bar rather than an error, so refuse rather than ship a silent blank.
const navPath = R("amp-nav.js");
if (!existsSync(navPath)) fail("amp-nav.js is not vendored. Copy the DEPLOYED revision; do not hand-edit it.");
const navSrc = readFileSync(navPath, "utf8");
const navKnowsKey = navSrc.includes(`${surface.nav_property}:`);
if (!navKnowsKey && !surface._nav_unknown_key_acknowledged)
  fail(
    `the vendored amp-nav.js does not know the property key "${surface.nav_property}". ` +
      `Measure what it actually renders, then record the finding in ` +
      `surface._nav_unknown_key_acknowledged. Do not vendor a newer nav to work around this — ` +
      `the vendored copy must match what the sibling domains serve.`,
  );
if (!navKnowsKey)
  console.log(
    `\x1b[33m  note:\x1b[0m vendored amp-nav does not know "${surface.nav_property}" — acknowledged in surface.json`,
  );

const YEAR = surface.verified_at.slice(0, 4);
const STAMP = `verified ${surface.verified_at} · records frozen`;

// ── GEN: ledger ────────────────────────────────────────────────────────────
const a2aRow = gap.protocols.find((p) => p.id === "a2a");
if (!a2aRow) fail("gap-matrix.json has no A2A row; the ledger cannot state a coverage score.");

const ledgerCells = [
  {
    val: protocol.latest_version,
    lab: "A2A spec version",
    src: `latest release · ${link(protocol.sources.spec, "the specification")}`,
  },
  {
    val: String(protocol.bindings.length),
    lab: "Protocol bindings",
    src: `officially supported · ${link(protocol.sources.proto, "a2a.proto:341")}`,
  },
  {
    val: String(protocol.task_states.length),
    lab: "Task states",
    src: `incl. UNSPECIFIED · ${link(protocol.sources.proto, "a2a.proto:187")}`,
  },
  {
    val: a2aRow.coverage,
    cls: "warn",
    lab: "Governance coverage",
    src: `${esc(a2aRow.label)} · ${link(gap.paper.url, "preprint " + gap.paper.arxiv)}`,
  },
  {
    val: String(witness.messages_witnessed),
    cls: "zero",
    lab: "Messages witnessed here",
    src: `<a href="#receipts">why zero →</a>`,
  },
];

const GEN = {};

GEN.ledger = `<div class="ledger-grid">
${ledgerCells
  .map(
    (c) => `                    <div class="ledger-cell">
                        <span class="ledger-val${c.cls ? " " + c.cls : ""}">${esc(c.val)}</span>
                        <span class="ledger-lab">${esc(c.lab)}</span>
                        <span class="src">${c.src}</span>
                    </div>`,
  )
  .join("\n")}
                </div>`;

GEN["ledger-stamp"] = esc(STAMP);
GEN["hero-witness"] = `<strong>${esc(String(witness.messages_witnessed))}</strong>`;

// ── GEN: gap matrix ────────────────────────────────────────────────────────
GEN.matrix = `<div class="matrix-wrap">
                <table class="matrix">
                    <caption class="src" style="text-align:left;padding:0.8rem 0.9rem;caption-side:bottom">${esc(gap.scoring_note)}</caption>
                    <thead>
                        <tr>
                            <th scope="col">Protocol</th>
${gap.dimensions
  .map(
    (d) =>
      `                            <th scope="col">${esc(d.id)}<span class="gname">${esc(d.name)}</span></th>`,
  )
  .join("\n")}
                            <th scope="col">Coverage</th>
                        </tr>
                    </thead>
                    <tbody>
${gap.protocols
  .map(
    (p) => `                        <tr${p.focus ? ' class="focus"' : ""}>
                            <th scope="row">${esc(p.label)}</th>
${gap.dimensions
  .map((d) => {
    const s = p.scores[d.id];
    return `                            <td><span class="cell" data-s="${esc(s)}">${esc(s)}</span></td>`;
  })
  .join("\n")}
                            <td class="cov">${esc(p.coverage)}</td>
                        </tr>`,
  )
  .join("\n")}
                    </tbody>
                </table>
            </div>`;

GEN["matrix-cite"] =
  `${link(gap.paper.url, gap.paper.title)} — ${esc(gap.paper.authors.join(", "))}, submitted ${esc(gap.paper.submitted)}, arXiv:${esc(gap.paper.arxiv)}. ` +
  `<strong style="color:var(--orange)">${esc(gap.paper.status_note.split(".")[0])}.</strong> ` +
  `Their finding, quoted: “${esc(gap.paper.headline)}” ` +
  `Scores are the paper's; this site has not re-scored the protocols.` +
  (gap.version_drift
    ? `<br><br><strong style="color:var(--orange)">Version drift, stated:</strong> ${esc(gap.version_drift.note)} ` +
      `${esc(gap.version_drift.why_the_row_still_stands)} ` +
      link(gap.version_drift.source, "The 2026-07-28 release notes.")
    : "");

GEN.dims = `<div class="dim-list">
${gap.dimensions
  .map(
    (d) => `                <div class="dim">
                    <div class="dim-head">
                        <span class="dim-id">${esc(d.id)}</span>
                        <span class="dim-name">${esc(d.name)}</span>
                        <span class="cell" data-s="${esc(d.a2a)}">A2A: ${esc(d.a2a)}</span>
                    </div>
                    <p class="dim-def">“${esc(d.definition)}”</p>
                    <div class="dim-rows">
                        <div class="dim-row transports">
                            <h4>What A2A transports</h4>
                            <p>${esc(d.a2a_transports)}</p>
                        </div>
                        <div class="dim-row cannot">
                            <h4>What it cannot express</h4>
                            <p>${esc(d.a2a_cannot)}</p>
                        </div>
                        <div class="dim-row here">
                            <h4>What a refusal looks like here ${chip(d.here.rung)}</h4>
                            <p>${esc(d.here.what)}<span class="detail">${esc(d.here.detail)}</span></p>
                        </div>
                    </div>
                </div>`,
  )
  .join("\n")}
            </div>`;

// ── GEN: the crosswalk ─────────────────────────────────────────────────────
// Joins the paper's six dimensions to the vendored invariant table. The cells
// are looked up by number at build time, so a cell that is renamed, restatused
// or removed upstream shows up here on the next sync instead of rotting.
const CELL_BY_NUM = new Map();
for (const g of invariants.groups)
  for (const c of g.cells) CELL_BY_NUM.set(c.num, { ...c, group: g });

for (const d of gap.dimensions) {
  if (!d.crosswalk) fail(`dimension ${d.id} has no crosswalk; the section cannot be generated with a hole in it.`);
  for (const n of d.crosswalk.cells)
    if (!CELL_BY_NUM.has(n))
      fail(
        `crosswalk for ${d.id} points at invariant cell "${n}", which is not in records/invariants.json. ` +
          `Re-run tools/sync-invariants.mjs, or fix the mapping — do not drop the arrow silently.`,
      );
}

// Statuses are counted from the vendored record, never typed.
const invByStatus = invariants.by_status;
const invCounted = invariants.status_order.reduce((n, k) => n + (invByStatus[k] || 0), 0);
if (invCounted !== invariants.total)
  fail(`invariants.json: by_status sums to ${invCounted} but total is ${invariants.total}.`);

const STATUS_RUNG = {
  proved: "live_local",
  shipped: "in_tree",
  named: "proposed",
  sketched: "proposed",
  missing: "blocked",
};

const cellChip = (c) =>
  `<span class="cell" data-s="${c.status === "proved" || c.status === "shipped" ? "full" : c.status === "missing" ? "absent" : "partial"}">${esc(c.status)}</span>`;

GEN["crosswalk-counts"] = invariants.status_order
  .map(
    (k) =>
      `<span class="ledger-cell" style="padding:0.9rem 1rem"><span class="ledger-val${k === "missing" ? " warn" : k === "proved" ? "" : " zero"}" style="font-size:1.5rem">${esc(String(invByStatus[k] || 0))}</span><span class="ledger-lab">${esc(k)}</span></span>`,
  )
  .join("\n                    ");

GEN["crosswalk-total"] = `${esc(String(invariants.total))}`;

// Derived, because the template had typed "four of the six" — the same class of
// hand-count that put "Three terminal" beside a list of four.
const provedAll = invariants.groups.flatMap((g) =>
  g.cells.filter((c) => c.status === "proved").map((c) => ({ ...c, group: g })),
);
const provedByGroup = provedAll.reduce(
  (a, c) => ((a[c.group.name] = (a[c.group.name] || 0) + 1), a),
  {},
);
const topGroup = Object.entries(provedByGroup).sort((a, b) => b[1] - a[1])[0];
const NUMWORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const word = (n) => NUMWORD[n] ?? String(n);
GEN["crosswalk-proved"] =
  `${esc(word(topGroup[1]))} of the ${esc(word(provedAll.length))} proved cells in the whole table are the one ${esc(topGroup[0].toLowerCase())} group`;
GEN["crosswalk-judgement"] = `${esc(gap.crosswalk_note.statement)} <em>${esc(gap.crosswalk_note.what_is_not_a_judgement)}</em>`;

GEN.crosswalk = `<div class="tbl-wrap">
                <table class="data">
                    <thead><tr>
                        <th scope="col">Dimension</th>
                        <th scope="col">A2A</th>
                        <th scope="col">Invariant cell</th>
                        <th scope="col">Status here</th>
                    </tr></thead>
                    <tbody>
${gap.dimensions
  .map((d) => {
    const cells = d.crosswalk.cells.map((n) => CELL_BY_NUM.get(n));
    const cellCol = cells.length
      ? cells
          .map(
            (c) =>
              `<span style="display:block"><code>${esc(c.symbol || c.num)}</code> ${esc(c.label)} <span class="src">· ${esc(c.group.roman)} ${esc(c.group.name)}</span></span>`,
          )
          .join("")
      : `<span class="src">no cell exists</span>`;
    const statusCol = cells.length
      ? cells.map((c) => `<span style="display:block">${cellChip(c)}</span>`).join("")
      : `<span class="cell" data-s="absent">none</span>`;
    return `                        <tr>
                            <th scope="row">${esc(d.id)} ${esc(d.name.toLowerCase())}</th>
                            <td><span class="cell" data-s="${esc(d.a2a)}">${esc(d.a2a)}</span></td>
                            <td>${cellCol}</td>
                            <td>${statusCol}</td>
                        </tr>
                        <tr>
                            <td colspan="4" style="padding-top:0;color:var(--text-secondary);font-size:0.86rem">${esc(d.crosswalk.claim)}</td>
                        </tr>`;
  })
  .join("\n")}
                    </tbody>
                </table>
            </div>`;

// ── GEN: protocol reference ────────────────────────────────────────────────
GEN["protocol-date"] = esc(protocol.verified_at);

GEN.discovery = `<pre class="code"><span class="cmt">// the standard path — RFC 8615</span>
<span class="fn">GET</span> https://{agent-server-domain}<span class="str">${esc(protocol.discovery.well_known_path)}</span>

<span class="cmt">// NOT this. ${esc(protocol.discovery.superseded_note)}</span>
<span class="fn">GET</span> https://{agent-server-domain}<span class="bad">${esc(protocol.discovery.superseded_path)}</span></pre>
                <div class="tbl-wrap" style="margin-top:1.4rem">
                    <table class="data">
                        <thead><tr><th scope="col">Mechanism</th><th scope="col">How it works</th></tr></thead>
                        <tbody>
${protocol.discovery.mechanisms
  .map(
    (m) =>
      `                            <tr><th scope="row">${esc(m.name)}</th><td>${esc(m.detail)}</td></tr>`,
  )
  .join("\n")}
                        </tbody>
                    </table>
                </div>`;

GEN.changes = `<div class="tbl-wrap">
                    <table class="data">
                        <thead><tr><th scope="col">Area</th><th scope="col">v0.3</th><th scope="col">v1.0</th></tr></thead>
                        <tbody>
${protocol.changes_v03_to_v10
  .map(
    (c) => `                            <tr>
                                <th scope="row">${esc(c.area)}</th>
                                <td class="was"><code>${esc(c.from)}</code></td>
                                <td><code>${esc(c.to)}</code><span class="why">${esc(c.why)}</span></td>
                            </tr>`,
  )
  .join("\n")}
                        </tbody>
                    </table>
                </div>`;

// Counted, never typed. The template said "Three terminal" while the record
// held four; a hand-typed count beside a generated list is how they drift.
const byKind = protocol.task_states.reduce((a, s) => ((a[s.kind] = (a[s.kind] || 0) + 1), a), {});
const kindPhrase = ["terminal", "interrupted", "open", "unknown"]
  .filter((k) => byKind[k])
  .map((k) => `${byKind[k]} ${k}`)
  .join(", ");
GEN["lifecycle-intro"] = `${esc(String(protocol.task_states.length))} states — ${esc(kindPhrase)}.`;

GEN.lifecycle = `<div class="life">
${protocol.task_states
  .map(
    (s) => `                    <div class="life-cell" data-kind="${esc(s.kind)}">
                        <span class="life-id">${esc(s.id)}</span>
                        <span class="life-kind">${esc(s.kind)}</span>
                        <span class="life-detail">${esc(s.detail)}</span>
                    </div>`,
  )
  .join("\n")}
                </div>`;

GEN.methods = `<div class="tbl-wrap">
                    <table class="data">
                        <thead><tr><th scope="col">v1.0</th><th scope="col">was (v0.3)</th><th scope="col">What it does</th></tr></thead>
                        <tbody>
${protocol.methods
  .map(
    (m) => `                            <tr>
                                <th scope="row"><code>${esc(m.v1)}</code></th>
                                <td class="was"><code>${esc(m.v03)}</code></td>
                                <td>${esc(m.detail)}</td>
                            </tr>`,
  )
  .join("\n")}
                        </tbody>
                    </table>
                </div>`;

GEN.bindings = `<div class="tbl-wrap">
                    <table class="data">
                        <thead><tr><th scope="col">protocolBinding</th><th scope="col">Name</th><th scope="col">Notes</th></tr></thead>
                        <tbody>
${protocol.bindings
  .map(
    (b) => `                            <tr>
                                <th scope="row"><code>${esc(b.id)}</code></th>
                                <td>${esc(b.label)}</td>
                                <td>${esc(b.detail)}</td>
                            </tr>`,
  )
  .join("\n")}
                        </tbody>
                    </table>
                </div>
                <p class="src" style="margin-top:0.9rem">${esc(protocol._bindings_comment.replace(/^a2a\.proto:\d+-\d+ — /, ""))}</p>`;

GEN.vsmcp = `<div class="cards">
                    <div class="card">
                        <div class="card-head"><h3>MCP</h3><span class="icon">⊞</span></div>
                        <p>${esc(protocol.vs_mcp.mcp)}</p>
                    </div>
                    <div class="card">
                        <div class="card-head"><h3>A2A</h3><span class="icon">⬡</span></div>
                        <p>${esc(protocol.vs_mcp.a2a)}</p>
                    </div>
                </div>
                <p class="section-desc" style="margin-top:1.2rem">${esc(protocol.vs_mcp.note)} ${esc(protocol.vs_mcp.quote)}</p>
                <h4 style="font-family:var(--mono);font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);font-weight:400;margin:2rem 0 0.8rem">MCP moved — ${esc(protocol.mcp_current.version)}</h4>
                <p class="section-desc" style="margin-bottom:1rem">${esc(protocol.mcp_current.naming)} It is billed as ${esc(protocol.mcp_current.billed_as)}.</p>
                <ul class="insp-notes" style="font-size:0.9rem;margin-bottom:1rem">
${protocol.mcp_current.changes.map((c) => `                    <li>${esc(c)}</li>`).join("\n")}
                </ul>
                <p class="section-desc" style="margin-bottom:1rem"><strong>${esc(protocol.mcp_current.what_it_does_not_add)}</strong> ${esc(protocol.mcp_current.why_that_matters_here)}</p>
                <p class="src">${link(protocol.mcp_current.source, "the 2026-07-28 specification announcement")} · The gap matrix above scores <strong>MCP v1.1</strong>, because that is what the paper assessed and the paper predates this release by 28 days. It has not been re-scored here. <a href="#gap">See the version-drift note.</a></p>`;

GEN.governance = `<p class="section-desc" style="margin-bottom:1rem">${esc(protocol.governance.origin)} It is maintained by a ${esc(protocol.governance.committee)} under the ${esc(protocol.governance.body)}.</p>
                <p class="section-desc" style="margin-bottom:1rem">${esc(protocol.governance.aaif_note)} ${chip(protocol.governance.aaif_rung)}</p>
                <p class="src">Technical Steering Committee: ${esc(protocol.governance.tsc_members.join(" · "))}</p>
                <p class="src" style="margin-top:1.2rem">Adoption, as reported by the ${esc(protocol.governance.body)} on ${esc(protocol.adoption.as_of)}: ${esc(protocol.adoption.organizations)} organizations, ${esc(protocol.adoption.github_stars)} GitHub stars, SDKs in ${esc(protocol.adoption.sdk_languages.join(", "))}. ${link(protocol.sources.adoption, "press release")}</p>
                <div class="partners">
                    <span class="src" style="width:100%;margin-bottom:0.3rem">Named in that release — the A2A ecosystem, not this site's customers:</span>
${protocol.governance.tsc_members
  .map((m) => `                    <span class="partner-tag">${esc(m)}</span>`)
  .join("\n")}
                    <span class="partner-tag">${esc(protocol.adoption.organizations)} organizations</span>
                </div>`;

// ── GEN: our card ──────────────────────────────────────────────────────────
const cardPublic = Object.fromEntries(
  Object.entries(draftCard).filter(([k]) => !k.startsWith("_")),
);
const cardJSON = JSON.stringify(cardPublic, null, 2);

const host = surface.hosting;
if (!host) fail("surface.hosting is absent; the 'our own card' section is written from a measurement and cannot be written without one.");

GEN.ourcard = `<p class="section-desc">
                A2A v1.0 requires <code class="inline">supportedInterfaces[]</code> on every
                Agent Card — there is no spec-valid way to say “discoverable but not
                serving”. This surface serves static files and answers no A2A task
                method. So a card at the discovery path would advertise an endpoint
                that refuses, which is the exact defect this page was rebuilt to remove.
            </p>
            <p class="section-desc">
                An earlier draft of this section said the discovery path returns
                <code class="inline">404</code>, and invited you to check. Then the
                inspector below — written for this page, pointed at this domain as its
                own first test — came back
                <code class="inline">HTTP ${esc(String(host.unmatched_path_status))}</code>.
                The claim was wrong before anyone else could check it. Here is what is
                actually true:
            </p>
            <pre class="code"><span class="cmt">// measured ${esc(surface.verified_at)} — a defect, not a design</span>
<span class="fn">curl</span> -sS -o /dev/null -w <span class="str">"%{http_code} %{content_type}\\n"</span> \\
     https://a2atraffic.com${esc(protocol.discovery.well_known_path)}
<span class="bad">${esc(String(host.unmatched_path_status))} ${esc(host.unmatched_path_content_type)}</span>   <span class="cmt">← ${esc(host.unmatched_path_body)}</span>

<span class="cmt">// and any invented path does the same</span>
<span class="fn">curl</span> ... https://a2atraffic.com/nonexistent-xyz
<span class="bad">${esc(String(host.unmatched_path_status))} ${esc(host.unmatched_path_content_type)}</span></pre>
            <p class="section-desc" style="margin-top:1.6rem">
                ${esc(host.why_it_matters_here)}
                ${host.portfolio_wide ? "And it is not this domain's alone — the same check against three sibling ComputeDriven domains returns the same thing, so this is a hosting-level fault across the portfolio and it is reported here as one." : ""}
                A <code class="inline">${esc(host.attempted_fix)}</code> ships with this build as
                the attempted fix. Whether it takes effect depends on routing
                configuration this build cannot read, so its status is
                <span class="rung-chip" data-rung="blocked">${esc(host.attempted_fix_status)}</span>
                and it must be re-measured against the deployed site before this page
                claims otherwise.
            </p>
            <p class="section-desc">
                The card that <em>would</em> be served is published as a draft, at a
                draft path, so it can be read and argued with without being promised
                to a client. Note <code class="inline">streaming: false</code> and
                <code class="inline">pushNotifications: false</code> — the previous
                version of this page printed both as <code class="inline">true</code>
                for an agent that did not exist. It carries no
                <code class="inline">signatures[]</code>, which is a real gap and is
                stated rather than hidden.
            </p>
            <pre class="code">${esc(cardJSON)}</pre>
            <p class="src" style="margin-top:0.9rem">
                <a href="/records/agent-card.draft.json">records/agent-card.draft.json</a> —
                emitted from that record, with its annotation keys stripped.
                Serving it at the discovery path is one flag in
                <a href="/records/surface.json">surface.json</a>
                (<code class="inline">serve_agent_card</code>, currently
                <code class="inline">${String(surface.serve_agent_card)}</code>),
                and it must not be flipped until an endpoint answers.
            </p>`;

// ── GEN: capability cards ──────────────────────────────────────────────────
const CAPABILITIES = [
  {
    icon: "◉",
    h: "Message tracing",
    p: "Follow one task across agent hops — client initiation, delegation, artifact, completion — as a single chain rather than four unrelated POSTs.",
  },
  {
    icon: "⬡",
    h: "Agent discovery map",
    p: "Topology built from Agent Cards: who has been discovered, what they declare, whether their card is signed, and what changed since it was last read.",
  },
  {
    icon: "△",
    h: "Task lifecycle analytics",
    p: "State transitions across the nine TASK_STATE values, including how often a task ends interrupted and never returns.",
  },
  {
    icon: "◇",
    h: "Artifact inspection",
    p: "The unified v1.0 Part — text, raw, url, data — read by member presence, with mediaType and filename surfaced.",
  },
  {
    icon: "⊞",
    h: "MCP and A2A in one timeline",
    p: "Tool calls beneath an agent and messages between agents on the same clock. Two protocols, one execution graph.",
  },
  {
    icon: "⏣",
    h: "Streaming monitor",
    p: "SSE streams for SendStreamingMessage: throughput, dropped connections, and the fact that v1.0 removed the final flag so closure is the signal.",
  },
];

GEN.capabilities = `<div class="cards">
${CAPABILITIES.map(
  (c) => `                <div class="card">
                    <div class="card-head">
                        <h3>${esc(c.h)}</h3>
                        <span class="icon">${c.icon}</span>
                    </div>
                    <p>${esc(c.p)}</p>
                    <p style="margin-top:0.9rem">${chip("proposed")}</p>
                </div>`,
).join("\n")}
            </div>`;

// ── GEN: receipts ──────────────────────────────────────────────────────────
if (witness.receipts.length !== 0)
  fail("witness.json has receipts but the emitted empty state is hardcoded. Teach this build to render them before adding one.");

GEN.receipts = `<div class="empty">
                    <span class="big">${esc(String(witness.messages_witnessed))}</span>
                    <span class="lab">A2A messages witnessed by this surface</span>
                    <p>${esc(witness.why_zero)}</p>
                    <p>${esc(witness.what_would_change_it)}</p>
                </div>
                <h3 style="font-size:1.05rem;margin:2.5rem 0 1rem">The shape a receipt will take</h3>
                <p class="section-desc" style="margin-bottom:1.2rem">Declared now, so the empty state is a schema and not a shrug.</p>
                <div class="tbl-wrap">
                    <table class="data">
                        <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
                        <tbody>
${Object.entries(witness.receipt_schema)
  .filter(([k]) => !k.startsWith("_"))
  .map(
    ([k, v]) =>
      `                            <tr><th scope="row"><code>${esc(k)}</code></th><td>${esc(v)}</td></tr>`,
  )
  .join("\n")}
                        </tbody>
                    </table>
                </div>`;

// ── GEN: status ────────────────────────────────────────────────────────────
GEN["status-chip"] = chip(surface.surface_rung);

GEN.status = `<div class="status-block">
                <div class="status-row">
                    <h4>What is claimed</h4>
                    <p>${esc(surface.status.statement)}</p>
                </div>
                <div class="status-row">
                    <h4>How that was checked</h4>
                    <p>${esc(surface.status.source)}</p>
                </div>
                <div class="status-row limit" data-quoted="limit">
                    <h4>What is NOT claimed</h4>
                    <p>${esc(surface.status.limit)}</p>
                </div>
                <div class="status-row">
                    <h4>Rung witness</h4>
                    <p>${esc(surface._rung_witness_comment)}</p>
                </div>
            </div>`;

GEN["removed-date"] = esc(surface.verified_at);
// data-quoted marks a region that deliberately reproduces claims this site no
// longer makes. launch-gate.mjs strips these before its banned-claim scan and
// then asserts they are still here — a retraction that quotes nothing is not a
// retraction (DOCTRINE.md rule 5), but an unmarked quote would read as a claim.
GEN.removed = `<ul class="insp-notes" style="font-size:0.9rem" data-quoted="retraction">
${surface.removed_2026_08_17
  .map((r) => `                <li>${esc(r)}</li>`)
  .join("\n")}
            </ul>`;

GEN.deferred = `<div class="tbl-wrap">
                <table class="data">
                    <thead><tr><th scope="col">Deferred</th><th scope="col">Blocked on</th></tr></thead>
                    <tbody>
${Object.entries(surface.deferred)
  .map(
    ([k, v]) =>
      `                        <tr><th scope="row"><code>${esc(k)}</code> ${chip("blocked")}</th><td>${esc(v)}</td></tr>`,
  )
  .join("\n")}
                    </tbody>
                </table>
            </div>`;

// ── GEN: footer ────────────────────────────────────────────────────────────
GEN.year = esc(YEAR);
GEN["footer-stamp"] = `${esc(STAMP)} · generated from <a href="/records/surface.json" style="color:inherit">records/</a>`;

// ── emit ───────────────────────────────────────────────────────────────────
let html = readFileSync(R("src/index.template.html"), "utf8");

const regions = [...html.matchAll(/<!-- GEN:([a-z-]+) -->/g)].map((m) => m[1]);
for (const name of regions) {
  if (!(name in GEN)) fail(`template has region "${name}" but the build produces nothing for it.`);
}
for (const name of Object.keys(GEN)) {
  if (!regions.includes(name)) fail(`build produces region "${name}" but the template has no slot for it.`);
}

for (const [name, body] of Object.entries(GEN)) {
  const re = new RegExp(`(<!-- GEN:${name} -->)[\\s\\S]*?(<!-- /GEN:${name} -->)`, "g");
  const before = html;
  html = html.replace(re, `$1${body}$2`);
  if (html === before) fail(`region "${name}" was not substituted; check the closing marker.`);
}

writeFileSync(R("index.html"), html);

// Scripts live in src/ and are copied to the web root the template references.
for (const asset of ["network.js", "inspector.js"]) {
  copyFileSync(R(`src/${asset}`), R(asset));
}

// 404.html — the attempted fix for surface.hosting. Cloudflare Pages serves a
// root 404.html with a genuine 404 status for unmatched requests, UNLESS the
// project has catch-all routing set, which is dashboard state this build cannot
// read. Shipping it costs nothing; claiming it worked before re-measuring would
// repeat the exact error this page now documents.
writeFileSync(
  R("404.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 — A2A Traffic</title>
<meta name="robots" content="noindex">
<style>
  :root { --cyan:#00d9ff; --pink:#ff3366; --bg:#06080d; --fg:#e8eaf0; --dim:#4a4f66; --sec:#8a8fa8; --border:#1a1f30; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--fg); font-family:"JetBrains Mono",ui-monospace,monospace;
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:2rem; line-height:1.7; }
  main { max-width:56ch; }
  .code { font-size:4.5rem; font-weight:700; letter-spacing:-0.03em; color:var(--pink); line-height:1; }
  h1 { font-size:1.1rem; font-weight:400; margin:1rem 0 1.5rem; color:var(--fg); }
  p { font-size:0.85rem; color:var(--sec); margin-bottom:1rem; }
  .note { font-size:0.76rem; color:var(--dim); border-left:2px solid var(--border); padding-left:1rem; margin:1.5rem 0; }
  a { color:var(--cyan); }
</style>
</head>
<body>
<main>
  <div class="code">404</div>
  <h1>No such path on a2atraffic.com.</h1>
  <p>If you were performing A2A well-known discovery, this domain publishes no
     Agent Card at <code>${esc(protocol.discovery.well_known_path)}</code> — it answers
     no A2A task method, so a card there would advertise an endpoint that refuses.</p>
  <div class="note">
    If you are reading this page, the fix worked. As of ${esc(surface.verified_at)} this
    domain answered <strong>HTTP ${esc(String(host.unmatched_path_status))}</strong> with its
    homepage for every unmatched path, which is the defect this file exists to correct.
    That measurement is recorded in
    <a href="/records/surface.json">records/surface.json</a> and the homepage states it.
  </div>
  <p><a href="/">← a2atraffic.com</a> · <a href="/#protocol">A2A v1.0 reference</a> · <a href="/#gap">the gap matrix</a></p>
</main>
</body>
</html>
`,
);
if (surface.serve_agent_card) {
  mkdirSync(R(".well-known"), { recursive: true });
  writeFileSync(R(".well-known/agent-card.json"), JSON.stringify(cardPublic, null, 2) + "\n");
  console.log("  .well-known/agent-card.json  EMITTED (serve_agent_card: true)");
} else if (existsSync(R(".well-known/agent-card.json"))) {
  fail(
    ".well-known/agent-card.json exists on disk but surface.serve_agent_card is false. " +
      "The page publishes a refusal that says that path 404s; delete the file or flip the flag.",
  );
}

const bytes = Buffer.byteLength(html, "utf8");
console.log(`\x1b[32mbuilt\x1b[0m index.html  ${bytes.toLocaleString()} bytes  ${regions.length} regions`);
console.log(`  rung ${surface.surface_rung} · witnessed ${witness.messages_witnessed} · A2A ${protocol.latest_version} · coverage ${a2aRow.coverage}`);
console.log(`  verified_at ${surface.verified_at} (no wall clock was read)`);
