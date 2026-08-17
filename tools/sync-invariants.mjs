#!/usr/bin/env node
// Vendor the Periodic Table of Agent Invariants into records/invariants.json.
//
//   node tools/sync-invariants.mjs [path-to-invariants.html]
//
// Canonical lives in another repository (ProjectAmp2/opensentience.org/invariants.html),
// which is not present at deploy time — so the data is extracted once, vendored, and
// stamped with the sha256 of the source it came from. Re-run this when canonical moves;
// it prints a diff of the counts so a silent drift is visible.
//
// This script is the ONLY thing allowed to write records/invariants.json. Hand-editing
// that file would make the site's invariant counts hand-typed again, which is the exact
// defect the rest of this build exists to prevent.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "records/invariants.json");

const DEFAULT_SRC =
  "/home/travis/ProjectAmp2/opensentience.org/invariants.html";
const src = process.argv[2] || DEFAULT_SRC;

if (!existsSync(src)) {
  console.error(`\x1b[31mrefused:\x1b[0m canonical not found at ${src}`);
  console.error(`Pass the path: node tools/sync-invariants.mjs <invariants.html>`);
  process.exit(1);
}

const html = readFileSync(src, "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");

// Groups carry a roman label, a name and an OS-protocol meta line.
const GROUP_RE =
  /label:\s*"([IVX]+)",\s*\n\s*name:\s*"([^"]+)",\s*\n\s*meta:\s*"([^"]+)"/g;
// Cells vary: `glyph: true` appears only on the four governance symbols, and the
// prettier-wrapped `tagline` sometimes breaks to its own line. One monolithic
// pattern silently dropped 7 of 43 cells, so instead: find each cell's start,
// slice to the next one, and pull fields individually.
const CELL_START = /num:\s*"(\d+)"/g;
const field = (seg, key) => {
  const m = seg.match(new RegExp(`${key}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\"/g, '"') : null;
};

const bounds = [...html.matchAll(GROUP_RE)].map((m) => ({
  at: m.index,
  roman: m[1],
  name: m[2],
  meta: m[3],
}));
if (!bounds.length) {
  console.error("\x1b[31mrefused:\x1b[0m no groups matched. The source shape changed — fix the regex, do not hand-write the record.");
  process.exit(1);
}

const groups = bounds.map((g, i) => {
  const seg = html.slice(g.at, i + 1 < bounds.length ? bounds[i + 1].at : html.length);
  const starts = [...seg.matchAll(CELL_START)].map((m) => m.index);
  const cells = starts.map((at, k) => {
    const cell = seg.slice(at, k + 1 < starts.length ? starts[k + 1] : seg.length);
    return {
      num: field(cell, "num"),
      symbol: field(cell, "symbol") || null,
      label: field(cell, "label"),
      status: field(cell, "status"),
      title: field(cell, "title"),
      tagline: field(cell, "tagline"),
    };
  });
  return { roman: g.roman, name: g.name, meta: g.meta, cells };
});

const all = groups.flatMap((g) => g.cells);
const byStatus = all.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});

// Cross-check: count raw `status:` occurrences in the source. If the structured
// extraction misses cells (a field order changed, a new optional key appeared),
// these disagree and the sync refuses rather than vendoring a short table.
const rawStatuses = (html.match(/status:\s*"(proved|shipped|named|sketched|missing)"/g) || []).length;
if (rawStatuses !== all.length) {
  console.error(
    `\x1b[31mrefused:\x1b[0m extracted ${all.length} cells but the source contains ${rawStatuses} status fields. ` +
      `The extraction is dropping cells — fix CELL_RE.`,
  );
  process.exit(1);
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;

const record = {
  schema: "a2atraffic-invariants-v1",
  _comment:
    "VENDORED, NOT AUTHORED. Extracted from the canonical Periodic Table of Agent Invariants by tools/sync-invariants.mjs. Do not hand-edit — re-run the sync. The counts this site prints are derived from this file, never typed.",
  title: "The Periodic Table of Agent Invariants",
  version: "v0.5",
  publisher: "OpenSentience / Ampersand Box Design",
  canonical_url: "https://opensentience.org/invariants.html",
  canonical_path: src,
  source_sha256: sha256,
  extracted_by: "tools/sync-invariants.mjs",
  total: all.length,
  by_status: byStatus,
  status_order: ["proved", "shipped", "named", "sketched", "missing"],
  groups,
};

writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");

const fmt = (o) =>
  record.status_order.map((k) => `${k} ${o[k] || 0}`).join("  ");
console.log(`\x1b[32mvendored\x1b[0m records/invariants.json`);
console.log(`  ${groups.length} groups · ${all.length} cells`);
console.log(`  ${fmt(byStatus)}`);
console.log(`  sha256 ${sha256.slice(0, 16)}…`);
if (prev) {
  if (prev.source_sha256 === sha256) console.log(`  source unchanged since last sync`);
  else {
    console.log(`\x1b[33m  source CHANGED\x1b[0m — previous: ${fmt(prev.by_status)} (${prev.total} cells)`);
  }
}
