#!/usr/bin/env node
// a2atraffic.com — refuse to publish when the emitted page and the records disagree.
//
// This reads the EMITTED index.html, not the template and not the records it was
// built from. A generator that is asked whether its own output is correct will
// always say yes; the point of this file is to be a second reader.
//
//   node launch-gate.mjs
//
// Exit 0 = publishable. Exit 1 = do not push.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const R = (p) => join(ROOT, p);
const readJSON = (p) => JSON.parse(readFileSync(R(p), "utf8"));

const surface = readJSON("records/surface.json");
const protocol = readJSON("records/protocol.json");
const gap = readJSON("records/gap-matrix.json");
const witness = readJSON("records/witness.json");

if (!existsSync(R("index.html"))) {
  console.error("\x1b[31mREFUSED\x1b[0m index.html does not exist. Run: node build-site.mjs");
  process.exit(1);
}
const html = readFileSync(R("index.html"), "utf8");

const failures = [];
const passes = [];
const check = (name, cond, detail) => {
  if (cond) passes.push(name);
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
};

// ── 1. no unfilled regions, no template leakage ────────────────────────────
const emptyRegion = html.match(/<!-- GEN:([a-z-]+) --><!-- \/GEN:\1 -->/);
check(
  "every GEN region is filled",
  !emptyRegion,
  emptyRegion ? `"${emptyRegion[1]}" is empty` : "",
);
check("no {{placeholder}} survived", !/\{\{[A-Z_]+\}\}/.test(html));

// ── 1b. quoted regions ─────────────────────────────────────────────────────
// The retraction list reproduces, verbatim, claims this site no longer makes —
// DOCTRINE.md rule 5 requires retracting by name in the place it was published.
// Those quotes would trip every banned-claim pattern below, so they are marked
// data-quoted and stripped before the scan. Stripping without checking would
// be a hole big enough to hide anything in, so the marked regions are asserted
// present and asserted to contain what the record says they contain.
const quotedRegions = [...html.matchAll(/<(\w+)[^>]*\sdata-quoted="([a-z]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
const quotedNames = quotedRegions.map((m) => m[2]);
check("the retraction region exists", quotedNames.includes("retraction"));
check("the limits region exists", quotedNames.includes("limit"));

const retraction = quotedRegions.find((m) => m[2] === "retraction");
if (retraction) {
  check(
    `all ${surface.removed_2026_08_17.length} retracted claims are quoted on the page`,
    surface.removed_2026_08_17.length ===
      (retraction[3].match(/<li>/g) || []).length,
  );
  // The three most expensive ones must be named, not summarised away.
  for (const must of ["99.97", "agent.json", "12,400"]) {
    check(`the retraction names "${must}"`, retraction[3].includes(must));
  }
}

// Everything below scans the page WITHOUT the quoted regions.
const scan = quotedRegions.reduce((acc, m) => acc.replace(m[0], ""), html);

// ── 2. banned claim classes ────────────────────────────────────────────────
// Each of these was actually served from this domain until 2026-08-17.
// They are not banned because they are ugly; they are banned because they were
// false, and the failure mode of a rebuilt page is quietly growing them back.
const BANNED = [
  [/99\.9\d/, "a fabricated uptime figure (the original was 99.97)"],
  [/\buptime\b/i, "the word uptime — this surface has no runtime to have uptime"],
  [/\/\.well-known\/agent\.json(?!<)/, "the pre-1.0 discovery path used as if current"],
  [/100\+\s*Partners/i, "the unsourced partner count"],
  [/MONITORING LIVE/i, "the live-monitoring badge over a decorative canvas"],
  [/No code changes required/i, "vaporware present tense"],
  [/from deploy to insight/i, "vaporware present tense"],
  [/Every agent in the \[&\] portfolio/i, "an unwitnessed universal"],
  [/\bMessages\s*\/\s*sec\b/i, "a rate this surface cannot measure"],
  [/\bAvg Latency\b/i, "a latency this surface cannot measure"],
  [/new Date\(\)/, "a wall-clock read in the emitted page — dates come from records"],
  [/href="#"/, "a dead link"],
];
for (const [re, why] of BANNED) {
  const hit = scan.match(re);
  check(`banned: ${why}`, !hit, hit ? `found "${hit[0]}"` : "");
}
// The superseded path may appear ONCE, inside the "NOT this" comparison block.
const supersededCount = (scan.match(/\/\.well-known\/agent\.json/g) || []).length;
check(
  "the pre-1.0 path appears only in the do-not-use example",
  supersededCount <= 1,
  `appears ${supersededCount} times`,
);

// ── 3. derived values match the records ────────────────────────────────────
const a2aRow = gap.protocols.find((p) => p.id === "a2a");
check(
  `A2A version ${protocol.latest_version} is on the page`,
  html.includes(`>${protocol.latest_version}<`),
);
check(
  `governance coverage ${a2aRow.coverage} is on the page`,
  html.includes(a2aRow.coverage),
);
check(
  `witnessed count ${witness.messages_witnessed} is on the page`,
  html.includes(`>${witness.messages_witnessed}</span>`),
);
check(
  `verified_at ${surface.verified_at} is stamped`,
  html.includes(surface.verified_at),
);
check(
  `the current discovery path ${protocol.discovery.well_known_path} is on the page`,
  html.includes(protocol.discovery.well_known_path),
);
for (const s of protocol.task_states) {
  check(`task state ${s.id} rendered`, html.includes(s.id));
}
for (const d of gap.dimensions) {
  check(`dimension ${d.id} rendered`, html.includes(`>${d.id}</span>`));
}

// ── 3b. the crosswalk ──────────────────────────────────────────────────────
// The join between the paper and the invariant table is the one section whose
// arrows are argued rather than measured, so it carries the heaviest checks:
// every count derived, every referenced cell actually on the page, and the
// judgement label present and unhedged.
const invariants = readJSON("records/invariants.json");
const cellByNum = new Map();
for (const g of invariants.groups) for (const c of g.cells) cellByNum.set(c.num, c);

check(
  `the invariant total ${invariants.total} is on the page`,
  scan.includes(String(invariants.total)),
);
for (const k of invariants.status_order) {
  const n = invariants.by_status[k] || 0;
  check(
    `invariant count "${k}" = ${n} is rendered`,
    new RegExp(`>${n}</span><span class="ledger-lab">${k}<`).test(scan),
  );
}
for (const d of gap.dimensions) {
  if (!d.crosswalk) {
    check(`dimension ${d.id} has a crosswalk`, false);
    continue;
  }
  check(`${d.id} crosswalk claim is on the page`, scan.includes(d.crosswalk.claim.slice(0, 60)));
  for (const n of d.crosswalk.cells) {
    const c = cellByNum.get(n);
    check(
      `${d.id} → invariant ${n} (${c ? c.label : "MISSING FROM RECORD"}) rendered with its status`,
      !!c && scan.includes(c.label),
    );
  }
}
check(
  "the crosswalk is labelled a judgement, with an owner",
  /judgement, not a measurement/i.test(scan) && scan.includes(gap.crosswalk_note.statement.slice(0, 50)),
);
check(
  "the invariant table is credited and linked",
  scan.includes(invariants.canonical_url) && scan.includes(invariants.title),
);
// The vendored record must be traceable to a source, or it is hand-typed data
// wearing a record's clothes.
check(
  "invariants.json carries a source hash",
  /^[0-9a-f]{64}$/.test(invariants.source_sha256 || ""),
);

// ── 4. the witness discipline ──────────────────────────────────────────────
// If nothing has been witnessed, no capability may read as shipped and the
// canvas must be labelled.
if (witness.messages_witnessed === 0 && witness.receipts.length === 0) {
  check(
    "the hero labels the animation a simulation",
    /Simulation\s*·\s*not live traffic/i.test(html),
  );
  check(
    "no capability card claims to be implemented",
    !/data-rung="(implemented|live_deployed)"/.test(html),
  );
  const proposed = (html.match(/data-rung="proposed"/g) || []).length;
  check(
    "every capability card carries a proposed chip",
    proposed >= 6,
    `found ${proposed}, expected at least 6`,
  );
}

// ── 5. the agent-card refusal is consistent with what is on disk ───────────
const cardOnDisk = existsSync(R(".well-known/agent-card.json"));
check(
  "serve_agent_card matches the filesystem",
  cardOnDisk === surface.serve_agent_card,
  cardOnDisk
    ? "a card is on disk but the record says it is not served"
    : "the record says a card is served but none is on disk",
);
if (!surface.serve_agent_card) {
  const host = surface.hosting || {};
  // The page must state the MEASURED status of the discovery path. It promised
  // a 404 once; the host answers 200, and a page that promises an absence it
  // cannot deliver is the same defect class it was rebuilt to remove.
  // Both measurements must survive. Once the fix landed it was tempting to show
  // only the 404 — but the before-state is the retraction, and dropping it turns
  // a correction into a page that was simply always right.
  for (const k of ["before", "after"]) {
    const m = host[k];
    check(
      `the page shows the ${k} measurement (${m.status})`,
      scan.includes(`${m.status} ${m.content_type}`),
      `expected "${m.status} ${m.content_type}" on the page`,
    );
    check(`the ${k} measurement is dated`, scan.includes(m.when));
  }
  check(
    "the fix status on the page matches the record",
    scan.includes(host.fix_status),
  );
  check(
    "a fix recorded as measured is not still described as a prediction",
    host.fix_status !== "measured" || !/attempted fix[\s\S]{0,120}unverified/i.test(scan),
  );
  check("404.html is emitted", existsSync(R("404.html")));
  // The finding is stated whether open or closed. A fix is only checkable
  // against the fault it repaired, so closing it must not delete it.
  check(
    "the portfolio-wide finding is stated",
    scan.includes(host.portfolio_wide_measured.slice(0, 40)),
  );
  check(
    "the portfolio-wide history survives the fix",
    !host.portfolio_wide_history || scan.includes(host.portfolio_wide_history.slice(0, 40)),
  );
  check(
    "a closed finding is not still described as open",
    host.portfolio_wide || !/on the others it is still open/i.test(scan),
  );
}

// ── 6. the shared nav ──────────────────────────────────────────────────────
check("<amp-nav> is embedded", html.includes(`<amp-nav property="${surface.nav_property}"`));
check("amp-nav.js is vendored", existsSync(R("amp-nav.js")));
check("network.js is emitted", existsSync(R("network.js")));
check("inspector.js is emitted", existsSync(R("inspector.js")));

// ── 7. the honesty of the citation ─────────────────────────────────────────
check(
  "the gap paper is labelled a preprint on the page",
  /preprint/i.test(html),
);
check(
  "the page does not call the preprint peer-reviewed",
  // The phrase is allowed only when negated. This review's own retraction
  // records calling this exact paper peer-reviewed without checking.
  !/(?<!not )(?<!non-)peer[- ]reviewed/i.test(scan),
);

// ── report ─────────────────────────────────────────────────────────────────
console.log(`\x1b[2m${passes.length} checks passed\x1b[0m`);
if (failures.length) {
  console.error(`\n\x1b[31mREFUSED — ${failures.length} check(s) failed:\x1b[0m`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nDo not publish. Fix the record or the template, rebuild, re-run.`);
  process.exit(1);
}
console.log(`\x1b[32mPUBLISHABLE\x1b[0m index.html agrees with records/ on all ${passes.length} checks.`);
console.log(
  `  rung ${surface.surface_rung} · witnessed ${witness.messages_witnessed} · verified ${surface.verified_at}`,
);
