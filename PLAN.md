# a2atraffic.com — the rebuild plan

**Author:** Claude (Opus 5), session 2026-08-17
**Status:** `proposed`. **[TRAVIS]** marks decisions reserved per `DOCTRINE.md` rule 6.
**Inputs reconciled:** a GPT critique (product-ward: interactive observatory + SEO lab), a Fable
critique (portfolio-ward: witness surface, rung-honest, COMPOSE-vendored), and
`ProjectAmp2/PORTFOLIO_AUDIT_REVIEW.md` §5.1, which is an **in-tree decision already written**
and which neither external critique had seen.

---

## 0. Verdict

All three inputs agree on the subtraction and disagree on what replaces it. The subtraction is
not in question and ships regardless. For the replacement, **§5.1 wins**, because it is the only
one of the three whose content is *verifiable today* and *not available to a competitor*:

> a2atraffic.com becomes **the A2A observatory** — what the protocol says, **what it structurally
> cannot say**, and what this surface has actually witnessed (which is nothing, stated plainly).

GPT's Observatory and Protocol Lab are absorbed as sections. Fable's witness role is absorbed as
the ledger discipline and the `records/` + gate machinery. Fable's COMPOSE-vendoring is **blocked**
and left as a seam — see §5.

## 1. What was checked before any of this was written

Doctrine rule 1. Every protocol fact below was re-derived from a primary source today, because the
whole failure of the current page is that it prints numbers nobody re-derived.

| Claim | Check | Verdict |
|---|---|---|
| Well-known path is `agent-card.json`, not `agent.json` | `a2a-protocol.org/latest/topics/agent-discovery/` — *"The standard path is `https://{agent-server-domain}/.well-known/agent-card.json`, following the principles of RFC 8615."* | **CONFIRMED.** Current page ships the v0.x path. |
| Current version is 1.0, not 1.2 | spec page: *"Latest Released Version: 1.0.0"*; a2a-protocol.org front page announces v1.0 | **CONFIRMED 1.0.** One secondary blog claimed "1.2" — wrong, discarded. |
| `supportedInterfaces[]` replaced top-level `url`/`preferredTransport`/`additionalInterfaces` | `a2aproject/A2A@main/specification/a2a.proto:336-399` read directly | **CONFIRMED**, field-by-field. |
| Task states are `TASK_STATE_*` | `a2a.proto:187-208` | **CONFIRMED**, 9 values incl. `TASK_STATE_UNSPECIFIED`. |
| Bindings are `JSONRPC`, `GRPC`, `HTTP+JSON` | `a2a.proto:341-344` — *"The core ones officially supported are `JSONRPC`, `GRPC` and `HTTP+JSON`."* | **CONFIRMED.** |
| 150+ organisations | LF press release **April 9, 2026** | **CONFIRMED** — and it is April, not August. Also 22,000+ GitHub stars, five production-ready languages. |
| A2A is moving to the AAIF | AAIF formed **Dec 9, 2025** (MCP, goose, AGENTS.md). Reported Aug 2026: Google transferring A2A into it. The Axios URL in the GPT critique **403s** and could not be read. | **PARTIAL.** The move is corroborated by secondary reporting (Techzine) but I could not open the cited primary. Site states it as reported, not as fact. |
| The governance gap paper exists and says what §5.1 says | `arxiv.org/abs/2606.31498` — Kang & Diponegoro, *"Governance Gaps in Agent Interoperability Protocols"*, submitted 2026-06-30; Table III re-read | **CONFIRMED. A2A v1.0.1 = 1/12** (G1 partial, G2–G6 absent). It is a **preprint**, not peer-reviewed, and the page says so. |
| `reply() → signed: false` is real and runnable | `cd RRABBIT && node test/mail.mjs` → **68 passed, 0 failed**; `test/mail.mjs:204` pins `r.fact.signed === false` | **CONFIRMED, ran it today.** |
| a2atraffic has no `<amp-nav>` | `grep -c amp-nav index.html` → **0** | **CONFIRMED.** One of the two surfaces the nav fan-out cannot reach. |

## 2. The defects being removed (all three critiques agree)

1. **`99.97% Uptime`** and the three JS-driven counters (`statMessages`, `statAgents`,
   `statLatency`, seeded 12,400 / 847 / 23ms in `animateStats()`). Fabricated. Doctrine rule 2.
   JS-off they render `0 0 0 99.97`, which is worse than either honest state.
2. **`GET /.well-known/agent.json`** printed as a code block with `streaming: true`. Wrong path
   *and* a falsifiable endpoint claim the reader is handed the curl for.
3. **Present-tense product copy** — *"Transparent proxy layer captures all JSON-RPC messages"*,
   *"No code changes required"*, *"From Deploy to Insight in Minutes"*. No such thing exists.
4. **`Every agent in the [&] portfolio speaks A2A`** — an unwitnessed universal. Deleted, not
   softened.
5. **The partner strip** (`Google Cloud`, `Salesforce`, `SAP`… `100+ Partners`) reads as *our*
   partners. Recaptioned as the A2A ecosystem, and `100+` corrected to the sourced **150+**.
6. **`Documentation` and `Changelog` → `#`.** Dead.
7. **`MONITORING LIVE A2A TRAFFIC`** badge over a decorative canvas.

## 3. The architecture

| # | Section | Rung of its content | Source of its numbers |
|---|---|---|---|
| 1 | Hero — canvas kept, badge relabelled `SIMULATION · NOT LIVE TRAFFIC` | — | — |
| 2 | **Ledger strip** (replaces the stats bar) | checkable | `records/protocol.json`, `records/gap-matrix.json`, `records/witness.json` |
| 3 | **The gap matrix** — G1–G6 × 5 protocols, interactive | `spec` (a preprint's reading) | `records/gap-matrix.json` |
| 4 | **What v1.0 changed** — v0.3 → v1.0 migration table | checkable | `records/protocol.json` |
| 5 | **Agent Card inspector** — live fetch, honest CORS refusal + curl fallback, paste-a-card validator | `live_local` (it runs) | the browser |
| 6 | **Our own card** — the draft, and why it is *not* at the well-known path | checkable | `records/agent-card.draft.json` |
| 7 | **Protocol reference** — lifecycle, methods, A2A vs MCP | checkable | `records/protocol.json` |
| 8 | **Capabilities (design)** — the six cards kept, each chipped `proposed` | `proposed` | hand-written, labelled |
| 9 | **Receipts** — honest empty state; fixes both dead footer links | — | `records/witness.json` |
| 10 | **The crosswalk** — the six dimensions joined to the invariant table | judgement (labelled) | `records/gap-matrix.json` + `records/invariants.json` |
| 11 | Closing — *the observatory reports what it has seen* | — | — |

### 3.1 The section that makes the domain defensible

Kong shipped Agent Gateway with A2A observability (April 14, 2026); Galileo sells agent-graph
monitoring; agentgateway routes and observes MCP/A2A. **Generic A2A telemetry is a taken category
and we have no product in it.** What nobody publishes is the *negative space*: A2A v1.0.1 scores
1/12 on a six-dimension governance taxonomy, and per dimension there is a concrete statement of
what the protocol transports, what it cannot express, and what a refusal looks like here. That is
the wedge, it costs nothing to hold, and it is true.

### 3.1b What building the inspector found — the page's own 404 claim was false

The first draft of §3.2 below promised that `https://a2atraffic.com/.well-known/agent-card.json`
returns **404**, and invited the reader to check. The inspector, written for this page and pointed
at this domain as its own first test, came back **`HTTP 200`**. Measured with curl:

| Path | Status | Content-Type | Size |
|---|---|---|---|
| `/.well-known/agent-card.json` | **200** | `text/html; charset=utf-8` | 77,879 B — the homepage |
| `/nonexistent-xyz` | **200** | `text/html; charset=utf-8` | 77,879 B — the homepage |

**And it is not this domain's.** `runefort.com`, `fleetprompt.com` and `computedriven.com` all
return `200 text/html` for an invented path too. **[TRAVIS]** — the whole portfolio currently
answers 200 with its homepage for any path anyone invents. Consequences past this surface: no path
on any of these domains can be proven absent by curl; crawlers see unbounded duplicate pages; and
*any* "that endpoint does not exist" claim on *any* surface is unverifiable. There is no
`_redirects`, `_headers` or `404.html` in the a2atraffic repo, so the behaviour is host/dashboard
configuration, not repository content.

For A2A this is **worse than a 404**: a client doing well-known discovery gets a *successful*
response whose body is an HTML page. Success plus wrong content is harder to handle than absence.

A `404.html` ships with this build as the attempted fix — Cloudflare Pages serves a root `404.html`
with a genuine 404 for unmatched requests *unless* catch-all routing is set, which is dashboard
state the build cannot read. It is recorded `unverified` and must be re-measured against the
deployed site. The page now states the measurement instead of the promise, and the correction is
written into the section rather than quietly swapped.

### 3.2 The agent card decision — publish the refusal, not the card

§5.1's instruction is *"publish the refusal."* Applied literally here:

Cloudflare Pages serves static files. Discovery (`GET`) works; the task surface (`SendMessage`,
`GetTask`, …) does not and cannot. A spec-valid `AgentCard` **requires** `supportedInterfaces[]`,
so any card served at `/.well-known/agent-card.json` today would advertise an interface that does
not answer — **the same defect class as the current page, re-committed in a new place.**

So: the card ships at **`/records/agent-card.draft.json`**, named a draft, rendered on the page,
beside the sentence *we do not serve the discovery path, because we do not answer A2A task
methods.* ~~A reader who curls the discovery path gets a 404, which is exactly what the page said
would happen.~~ **Retracted before publication — see §3.1b. It returns 200.** The page states the
measured 200 instead, and the inspector's default demo is the site inspecting itself and showing
that defect, which is a better demonstration than the one I had planned.

> **[TRAVIS]** — this is a "what to publish" call. The alternative is to ship a card at the
> well-known path anyway. I have built the honest default; flipping it is a one-line change in
> `records/surface.json` (`serve_agent_card: false`).

## 4. The machinery (why this is a surface, not another page)

Matching the runefort/fleetprompt convention, because the entire critique is *hand-authored claims*:

- `records/*.json` — the frozen records. **No number on the emitted page may exist that is not
  derived from one.**
- `build-site.mjs` — fills `<!-- GEN:x -->…<!-- /GEN:x -->` regions in `src/index.template.html`.
- `launch-gate.mjs` — re-reads the *emitted* `index.html` and refuses on drift, plus a banned-claim
  scan (`uptime`, `99.9`, `/.well-known/agent.json`, `100+ Partners`, live-traffic present tense).
- `amp-nav.js` vendored at the **deployed** 52,272-byte revision (md5 `da32283e…`, byte-identical
  to what `runefort.com/amp-nav.js` serves right now) + `<amp-nav property="a2atraffic">`.
  Ruled by Travis 2026-08-17: the nav goes on each site.

**Known nav disagreement, recorded not hidden:** `amp-nav.js:761` has
`a2atraffic: { name: "A2A Traffic", place: 3, rung: null }` with the comment *"has no directory in
this repository at all, so there is nothing to link and no rung to state."* It renders `?`. The
directory now exists (outside the repo, in `~/Projects/`). Only the nav lane may change that entry.

## 5. What is blocked, and left as a seam

**Fable's ledger strip vendored from the COMPOSE snapshot cannot be built.** There is no COMPOSE
record: no `/compose/` route on computedriven.com and no compose record file anywhere in
ProjectAmp2 (checked). It waits on the `[TRAVIS]` shared-facts ruling.

The seam is built: `records/witness.json` carries `messages_witnessed: 0` and the receipt schema,
the ledger strip already renders from records, and the freshness gate already exists. When COMPOSE
lands, it becomes one more record file and one more `GEN` region — no re-architecture.

**Also deferred:** the WRL block (grammar unfrozen, same dependency as every other surface's), and
receipt-driven canvas replay (needs a first receipt, and there are none).

## 6. Order

- **A** — subtraction + records + generator + gate + nav. No dependencies. *This plan builds it.*
- **B** — COMPOSE ledger, WRL block. Blocked on the ruling.
- **C** — formatter-verified WRL, replay-from-receipt hero. Post-freeze, post-first-traffic.
