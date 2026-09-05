// Cloudflare Pages Function — a routing probe, not a feature.
//
// WHY THIS EXISTS: records/surface.json:serve_agent_card is false because
// A2A v1.0 requires supportedInterfaces[] on every AgentCard, and the draft
// declares https://a2atraffic.com/a2a/json. Publishing the card before that
// URL answers would advertise an endpoint that refuses. Whether this Pages
// project even executes Functions is UNMEASURED: the only other repo in the
// portfolio that ships them (workbench, functions/mcp/*.ts) answers 404 at
// https://workbench.opensentience.org/mcp/delegatic, so the pattern must not
// be assumed to work here.
//
// This file answers exactly one question — does a nested Pages Function under
// functions/a2a/ execute on this domain — and answers nothing about A2A.
// It is deliberately at /a2a/probe, NOT /a2a/json, so that nothing which
// performs A2A discovery can mistake it for a task surface.
//
// DELETE IT once the question is settled, or once /a2a/json is real.

export function onRequest({ request }) {
  const url = new URL(request.url);
  const cf = request.cf || {};

  return new Response(
    JSON.stringify(
      {
        probe: "a2atraffic-pages-functions",
        answers: "does a nested Pages Function execute on this domain",
        not_an_agent:
          "This is not an A2A endpoint and never will be. It implements no A2A method. The discovery path /.well-known/agent-card.json still 404s, deliberately.",
        observed: {
          method: request.method,
          path: url.pathname,
          nested_route: url.pathname === "/a2a/probe",
          colo: cf.colo ?? null,
          country: cf.country ?? null,
          tls: cf.tlsVersion ?? null,
        },
        runtime: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
      null,
      2,
    ) + "\n",
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
