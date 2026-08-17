// a2atraffic.com — Agent Card inspector.
//
// Runs entirely in the visitor's browser. Nothing is sent to this server and
// nothing is stored. It is a READER, not a prover: it cannot verify a JWS
// signature, and when it meets one it says so rather than implying a check it
// did not run.
//
// The common outcome is a refusal. A browser cannot read a cross-origin URL
// that does not send Access-Control-Allow-Origin, and most agents do not. That
// is not a bug to hide behind a spinner — the refusal is printed with the exact
// curl to run instead.

(function () {
  "use strict";

  var WELL_KNOWN = "/.well-known/agent-card.json";

  // v1.0 required fields, from a2a.proto:362-399 (field_behavior REQUIRED).
  var REQUIRED = [
    "name",
    "description",
    "supportedInterfaces",
    "version",
    "capabilities",
    "defaultInputModes",
    "defaultOutputModes",
    "skills",
  ];

  // Fields that only existed before v1.0. Their presence dates a card.
  var LEGACY = {
    url: "top-level url — replaced by supportedInterfaces[].url",
    preferredTransport: "replaced by the order of supportedInterfaces[]",
    additionalInterfaces: "folded into supportedInterfaces[]",
    protocolVersion: "moved onto each supportedInterfaces[] entry",
    supportsAuthenticatedExtendedCard: "moved to capabilities.extendedAgentCard",
  };

  var out = document.getElementById("inspOut");
  var input = document.getElementById("inspUrl");
  var goBtn = document.getElementById("inspGo");
  var pasteToggle = document.getElementById("inspPasteToggle");
  var pasteWrap = document.getElementById("inspPasteWrap");
  var pasteArea = document.getElementById("inspPaste");
  var validateBtn = document.getElementById("inspValidate");
  if (!out || !input || !goBtn) return;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function status(kind, badge, text) {
    return (
      '<div class="insp-status" data-k="' +
      kind +
      '"><span class="badge">' +
      esc(badge) +
      "</span><span>" +
      text +
      "</span></div>"
    );
  }

  function field(k, v, cls) {
    return (
      '<div class="insp-field"><span class="k">' +
      esc(k) +
      '</span><span class="v' +
      (cls ? " " + cls : "") +
      '">' +
      esc(v) +
      "</span></div>"
    );
  }

  function curlFor(url) {
    return (
      '<pre class="code" style="margin-top:1rem"><span class="fn">curl</span> -sS ' +
      esc(url) +
      " | jq .</pre>"
    );
  }

  // For the HTML case, piping into jq just prints a jq parse error and buries
  // the actual finding. Show the status line and content type instead.
  function curlHead(url) {
    return (
      '<pre class="code" style="margin-top:1rem"><span class="fn">curl</span> -sS -o /dev/null -w ' +
      '<span class="str">"%{http_code} %{content_type} %{size_download}\\n"</span> \\\n     ' +
      esc(url) +
      "</pre>"
    );
  }

  // Turn whatever the visitor typed into the discovery URL.
  function toCardUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    var u;
    try {
      u = new URL(s);
    } catch (e) {
      return null;
    }
    // If they pasted the card path itself, keep it. Otherwise append.
    if (u.pathname.indexOf("/.well-known/agent-card.json") !== -1) return u.href;
    if (u.pathname === "/" || u.pathname === "") return u.origin + WELL_KNOWN;
    return u.origin + WELL_KNOWN;
  }

  // ── rendering a parsed card ───────────────────────────────────────────────
  function renderCard(card, sourceLabel) {
    var html = "";
    var notes = [];

    var missing = REQUIRED.filter(function (k) {
      return !(k in card);
    });

    var legacyHits = Object.keys(LEGACY).filter(function (k) {
      return k in card;
    });

    var verdictKind, verdictBadge, verdictText;
    if (missing.length === 0 && legacyHits.length === 0) {
      verdictKind = "ok";
      verdictBadge = "v1.0 shape";
      verdictText =
        "All " +
        REQUIRED.length +
        " required fields present, no pre-1.0 fields. Read from " +
        esc(sourceLabel) +
        ".";
    } else if (legacyHits.length > 0) {
      verdictKind = "refused";
      verdictBadge = "pre-1.0";
      verdictText =
        "This card carries " +
        legacyHits.length +
        " field(s) that v1.0 removed. Read from " +
        esc(sourceLabel) +
        ".";
    } else {
      verdictKind = "refused";
      verdictBadge = "incomplete";
      verdictText =
        missing.length +
        " required field(s) absent. Read from " +
        esc(sourceLabel) +
        ".";
    }
    html += status(verdictKind, verdictBadge, verdictText);

    // identity
    html += '<div class="insp-fields">';
    html += field("name", card.name || "—", card.name ? "" : "miss");
    html += field("version", card.version || "—", card.version ? "" : "miss");
    html += field(
      "provider",
      card.provider && card.provider.organization
        ? card.provider.organization
        : "— (optional)",
    );
    html += field(
      "skills",
      Array.isArray(card.skills) ? String(card.skills.length) : "—",
      Array.isArray(card.skills) ? "" : "miss",
    );

    // capabilities
    var caps = card.capabilities || {};
    html += field(
      "streaming",
      caps.streaming === true ? "true" : caps.streaming === false ? "false" : "—",
      caps.streaming === true ? "ok" : "",
    );
    html += field(
      "pushNotifications",
      caps.pushNotifications === true
        ? "true"
        : caps.pushNotifications === false
          ? "false"
          : "—",
      caps.pushNotifications === true ? "ok" : "",
    );

    // signature
    var sigs = Array.isArray(card.signatures) ? card.signatures.length : 0;
    html += field(
      "signatures",
      sigs > 0 ? String(sigs) + " — NOT verified here" : "none (unsigned)",
      sigs > 0 ? "" : "miss",
    );
    if (sigs > 0) {
      notes.push(
        "This card is signed. <strong>This tool did not verify it.</strong> Verification means JWS (RFC 7515) over JCS-canonicalised JSON (RFC 8785) against a key the domain controls, and a reader in a page cannot honestly claim to have done that.",
      );
    } else {
      notes.push(
        "This card is unsigned. v1.0 added <code class=\"inline\">signatures[]</code> so a card can be cryptographically bound to its domain; nothing here is bound to anything.",
      );
    }
    html += "</div>";

    // interfaces
    var ifaces = card.supportedInterfaces;
    if (Array.isArray(ifaces) && ifaces.length) {
      html +=
        '<h4 style="font-family:var(--mono);font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);font-weight:400;margin:0 0 0.6rem">supportedInterfaces — first entry is preferred</h4>';
      html += '<div class="tbl-wrap" style="margin-bottom:1.2rem"><table class="data"><thead><tr><th>#</th><th>protocolBinding</th><th>protocolVersion</th><th>url</th></tr></thead><tbody>';
      ifaces.forEach(function (i, n) {
        html +=
          "<tr><th scope=\"row\">" +
          (n + 1) +
          (n === 0 ? " ★" : "") +
          "</th><td><code>" +
          esc(i.protocolBinding || "—") +
          "</code></td><td><code>" +
          esc(i.protocolVersion || "—") +
          "</code></td><td><code>" +
          esc(i.url || "—") +
          "</code></td></tr>";
      });
      html += "</tbody></table></div>";
    } else if (!("supportedInterfaces" in card)) {
      notes.push(
        "No <code class=\"inline\">supportedInterfaces[]</code>. In v1.0 this is required — it replaced top-level <code class=\"inline\">url</code>, <code class=\"inline\">preferredTransport</code> and <code class=\"inline\">additionalInterfaces</code>.",
      );
    }

    if (legacyHits.length) {
      notes.push(
        "Pre-1.0 fields found: " +
          legacyHits
            .map(function (k) {
              return "<code class=\"inline\">" + esc(k) + "</code> (" + esc(LEGACY[k]) + ")";
            })
            .join("; ") +
          ".",
      );
    }
    if (missing.length) {
      notes.push(
        "Required fields absent: " +
          missing
            .map(function (k) {
              return "<code class=\"inline\">" + esc(k) + "</code>";
            })
            .join(", ") +
          ".",
      );
    }

    if (notes.length) {
      html += '<ul class="insp-notes">';
      notes.forEach(function (n) {
        html += "<li>" + n + "</li>";
      });
      html += "</ul>";
    }
    return html;
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  function inspect(raw) {
    var url = toCardUrl(raw);
    if (!url) {
      out.innerHTML = status(
        "absent",
        "bad input",
        "That is not a URL this tool can turn into a discovery path.",
      );
      return;
    }

    out.innerHTML = status("idle", "fetching", "GET " + esc(url));

    fetch(url, { method: "GET", mode: "cors", redirect: "follow" })
      .then(function (res) {
        if (res.status === 404 || res.status === 410) {
          out.innerHTML =
            status(
              "absent",
              "HTTP " + res.status,
              "No Agent Card at the discovery path. Either this domain does not run an A2A agent, or it publishes its card somewhere the standard does not name.",
            ) + curlFor(url);
          return null;
        }
        if (!res.ok) {
          out.innerHTML =
            status(
              "refused",
              "HTTP " + res.status,
              "The server answered, but not with a card.",
            ) + curlFor(url);
          return null;
        }
        var ctype = res.headers.get("content-type") || "";
        return res.text().then(function (text) {
          var card;
          try {
            card = JSON.parse(text);
          } catch (e) {
            // "did not parse as JSON" is a true statement and a useless one.
            // The interesting case — and the one this domain itself is in — is
            // 200 with an HTML body, which is a catch-all route answering for a
            // path that has nothing at it. Name it, because a client that
            // treats 200 as success is exactly what that shape breaks.
            if (/text\/html/i.test(ctype) || /^\s*<(!doctype|html)/i.test(text)) {
              out.innerHTML =
                status(
                  "refused",
                  "HTML, not a card",
                  "The server returned <strong>HTTP 200</strong> with " +
                    (ctype ? "<code class=\"inline\">" + esc(ctype) + "</code>" : "an HTML body") +
                    " — a web page, not an Agent Card. Almost always a catch-all route answering for a path that has nothing at it. " +
                    "For discovery this is worse than a 404: a client that checks the status code sees success and then has to parse a home page. " +
                    "<a href=\"#ourcard\">This domain is currently in exactly that state, and says so.</a>",
                ) + curlHead(url);
              return null;
            }
            out.innerHTML =
              status(
                "refused",
                "not JSON",
                "HTTP 200" +
                  (ctype ? " with <code class=\"inline\">" + esc(ctype) + "</code>" : "") +
                  ", but the body did not parse as JSON: " +
                  esc(e.message) +
                  ".",
              ) + curlFor(url);
            return null;
          }
          var warn =
            ctype && !/application\/json|\+json/i.test(ctype)
              ? '<p class="src" style="margin-bottom:1rem;color:var(--orange)">Served as <code class="inline">' +
                esc(ctype) +
                "</code>. It parsed as JSON anyway, but a card should be <code class=\"inline\">application/json</code> — a strict client may refuse it.</p>"
              : "";
          out.innerHTML = warn + renderCard(card, url);
          return null;
        });
      })
      .catch(function () {
        // Browsers deliberately refuse to tell a page why a cross-origin fetch
        // failed. Do not guess between CORS, DNS and offline — say which.
        out.innerHTML =
          status(
            "refused",
            "blocked",
            "The browser refused this read and will not say why — a cross-origin fetch failure is indistinguishable from DNS failure, TLS failure, or being offline, by design. The most likely cause is that the agent does not send <code class=\"inline\">Access-Control-Allow-Origin</code>, which most do not. Nothing is wrong with the card; the check just cannot happen here.",
          ) +
          curlFor(url) +
          '<p class="src" style="margin-top:0.8rem">Then paste the result into “Paste a card” above and this tool will read it against the v1.0 shape offline.</p>';
      });
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  goBtn.addEventListener("click", function () {
    inspect(input.value);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      inspect(input.value);
    }
  });

  Array.prototype.forEach.call(
    document.querySelectorAll(".insp-examples button[data-url]"),
    function (b) {
      b.addEventListener("click", function () {
        input.value = b.getAttribute("data-url");
        inspect(input.value);
      });
    },
  );

  if (pasteToggle && pasteWrap) {
    pasteToggle.addEventListener("click", function () {
      var open = pasteWrap.style.display !== "none";
      pasteWrap.style.display = open ? "none" : "block";
      pasteToggle.textContent = open ? "Paste a card" : "Hide paste";
      if (!open && pasteArea) pasteArea.focus();
    });
  }

  if (validateBtn && pasteArea) {
    validateBtn.addEventListener("click", function () {
      var text = pasteArea.value.trim();
      if (!text) {
        out.innerHTML = status("absent", "empty", "Nothing pasted.");
        return;
      }
      var card;
      try {
        card = JSON.parse(text);
      } catch (e) {
        out.innerHTML = status(
          "refused",
          "not JSON",
          "That did not parse: " + esc(e.message),
        );
        return;
      }
      out.innerHTML = renderCard(card, "pasted text");
    });
  }
})();
