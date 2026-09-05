// RFC 8785 — JSON Canonicalization Scheme.
//
// A2A §8.4.1 requires the Agent Card be canonicalised with JCS before signing,
// with the signatures field excluded. This is the whole of that, and it is
// small because JCS was designed to be expressible in ECMAScript:
//
//   - object properties sorted lexicographically by UTF-16 code unit, which is
//     what a default Array#sort on strings already does;
//   - numbers serialised as ECMAScript Number#toString, which is what
//     JSON.stringify already emits;
//   - strings escaped as JSON.stringify escapes them (\b \f \n \r \t shortcuts,
//     \u00xx for other control characters, lone surrogates escaped);
//   - no insignificant whitespace.
//
// So the only work is the sort. Everything else is delegated to JSON.stringify
// deliberately rather than reimplemented — a hand-rolled number formatter is the
// classic way to get JCS subtly wrong. Verified against RFC 8785's own test
// vector in test/jcs.mjs, which exercises the double-precision edges and the
// control characters that the Agent Card itself never contains.

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

/** Canonical JSON text for `value`, per RFC 8785. */
export function canonicalize(value) {
  return JSON.stringify(sortDeep(value));
}

/** Canonical bytes — what actually gets signed. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}

/**
 * The A2A signing payload for an Agent Card: the card with `signatures`
 * excluded (§8.4.1, "Signature Field Exclusion"), canonicalised.
 *
 * §8.4.1 also requires default-valued fields be dropped unless REQUIRED or
 * explicitly-set-optional. This card has none to drop — every field it carries
 * is either REQUIRED or an optional that was explicitly set — so the rule is
 * satisfied by construction rather than by a transform. If a field is ever added
 * whose value is a protobuf default and which is neither REQUIRED nor
 * explicitly set, this function must learn to strip it.
 */
export function cardPayload(card) {
  const { signatures, ...rest } = card;
  return canonicalBytes(rest);
}
