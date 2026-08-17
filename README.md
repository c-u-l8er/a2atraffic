# a2atraffic.com

The A2A protocol observatory: what the Agent2Agent protocol specifies, what it structurally
cannot express, and what this surface has actually witnessed — which is nothing, stated plainly.

**`index.html` is generated. Do not edit it.** Edit `records/*.json` or
`src/index.template.html`, then rebuild.

```bash
node build-site.mjs && node launch-gate.mjs
```

`build-site.mjs` refuses to emit when the records disagree with each other.
`launch-gate.mjs` re-reads the *emitted* page and refuses to publish when it disagrees with the
records — a generator asked to check its own output will always say yes, so the gate is a second
reader. **Do not push on a red gate.**

## Layout

| Path | What it is |
|---|---|
| `records/surface.json` | The frozen record. Rung, status, limits, the hosting measurement, what was removed. |
| `records/protocol.json` | A2A v1.0 facts, each with the primary source it was derived from. |
| `records/gap-matrix.json` | The six-dimension governance assessment. Scores are the paper's. |
| `records/witness.json` | What this surface has observed. Currently zero. |
| `records/invariants.json` | **Vendored, not authored.** The Periodic Table of Agent Invariants, extracted from canonical and stamped with the source sha256. |
| `records/agent-card.draft.json` | The card that *would* be served. A draft, at a draft path, on purpose. |
| `src/index.template.html` | The page, with `<!-- GEN:x -->` regions the build fills. |
| `src/network.js` · `src/inspector.js` | Copied to the web root by the build. |
| `index.html` · `404.html` · `network.js` · `inspector.js` | **Generated.** |
| `amp-nav.js` | Vendored shared nav. Do not hand-edit. |
| `tools/sync-invariants.mjs` | The only thing allowed to write `records/invariants.json`. Re-run when canonical moves. |
| `PLAN.md` | Why the page is shaped this way, and what is blocked. |

## Four rules this repo enforces mechanically

1. **No number on the page that is not derived from a record.** If you are typing a figure into
   the template, it belongs in `records/`. The template once said "Three terminal" beside a
   generated list of four; the count is now computed.
2. **A judgement is labelled as one, with an owner.** The crosswalk maps the paper's six
   dimensions onto invariant cells. That mapping is argued, not measured — nobody has published
   one, and no test enforces it. The page says so, in the section, in red. Everything either side
   of the arrows is derived: the scores are the paper's, the statuses come from the sync.
3. **No wall clock in the build.** There is no `new Date()` anywhere. Dates come from
   `surface.verified_at`, so two builds of the same records are byte-identical. (This exact leak
   was found twice in a sibling site's build.)
4. **Retract out loud.** `records/surface.json:removed_2026_08_17` lists what this domain served
   until 2026-08-17, and the page prints it. Those quotes are wrapped in `data-quoted`, which the
   gate strips before its banned-claim scan and then asserts is still present — a retraction that
   quotes nothing is not a retraction, and an unmarked quote reads as a claim.

## Known, recorded, not hidden

- **Every path on this domain returns HTTP 200 with the homepage**, including
  `/.well-known/agent-card.json`. Measured 2026-08-17. Three sibling ComputeDriven domains do the
  same, so it is a portfolio-level fault. `404.html` ships as the attempted fix and is marked
  `unverified` until re-measured against the deployed site. See `records/surface.json:hosting`.
- **The vendored `amp-nav.js` does not know the key `a2atraffic`.** That entry exists only in an
  undeployed nav revision. Measured effect: the full portfolio nav still renders, with nothing
  highlighted and no placement band. Resolves when the nav lane deploys. Do not hand-edit the
  vendored copy to work around it.
- **The gap matrix is one preprint's reading**, not peer-reviewed and not our re-scoring. The gate
  fails if the page ever calls it peer-reviewed — that mistake has been made about this exact
  paper before.

## Preview

```bash
python3 -m http.server 8099 --directory .
```

## Re-syncing the invariant table

```bash
node tools/sync-invariants.mjs /home/travis/ProjectAmp2/opensentience.org/invariants.html
```

Prints the group and status counts and whether the source hash moved. The build fails if a
crosswalk arrow points at a cell the record does not contain, so a cell renumbered upstream
surfaces as a refused build rather than a silently dropped row.
