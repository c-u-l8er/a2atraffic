// Agent Card signing and verification — A2A §8.4.
//
// WHY THE BUILD NEVER SIGNS. ECDSA is randomised: signing the same bytes twice
// gives two different signatures. If build-site.mjs signed, no two builds would
// be byte-identical, and this repository treats that property as load-bearing —
// it is why there is no `new Date()` anywhere in the build. So the signature is
// an INPUT, committed at records/agent-card.signature.json and produced by
// `node tools/sign-card.mjs`, which is run by a human when the card changes.
// The build only ever VERIFIES. That also means a build works without the
// private key, which matters because the private key is not in this repository
// and must never be.
//
// The alternative was EdDSA, which is deterministic and would have let the build
// sign on every run. It was not taken: a signature only anyone can check is
// worth having, ES256 is the algorithm the spec's own example uses and the one
// every JOSE implementation and every browser's Web Crypto supports, and
// reproducibility is recoverable by committing the signature whereas interop is
// not recoverable at all.

import { createHash, createPublicKey, createPrivateKey, sign, verify } from "node:crypto";
import { cardPayload, canonicalBytes } from "./jcs.mjs";

export const JKU = "https://a2atraffic.com/.well-known/jwks.json";
export const ALG = "ES256";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * RFC 7638 JWK thumbprint. Used as the kid, so the key identifier is derived
 * from the key rather than chosen — a kid that is a name can be reused after a
 * rotation and quietly point at the wrong key.
 */
export function thumbprint(jwk) {
  const required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return b64u(createHash("sha256").update(JSON.stringify(required)).digest());
}

/** The JWS Signing Input, RFC 7515 §5.1 — a detached payload. */
function signingInput(protectedB64, payload) {
  return Buffer.concat([Buffer.from(protectedB64 + ".", "ascii"), Buffer.from(b64u(payload), "ascii")]);
}

/**
 * Sign arbitrary canonical bytes. The Agent Card is one caller; the published
 * records are the other. Same key, same detached-JWS construction, so a verifier
 * that can check one can check the other with no second code path.
 */
export function signPayload(payload, privateJwk) {
  const header = {
    alg: ALG,
    typ: "JOSE",
    kid: thumbprint(privateJwk),
    jku: JKU,
  };
  const protectedB64 = b64u(Buffer.from(JSON.stringify(header), "utf8"));
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  // dsaEncoding ieee-p1363 is the raw r||s form JOSE requires; the default DER
  // form would verify nowhere.
  const sig = sign("sha256", signingInput(protectedB64, payload), { key, dsaEncoding: "ieee-p1363" });
  return {
    signature: { protected: protectedB64, signature: b64u(sig) },
    payload_sha256: sha256(payload),
    kid: header.kid,
  };
}

/** Sign a card: the payload is the card with `signatures` excluded (§8.4.1). */
export function signCard(card, privateJwk) {
  return signPayload(cardPayload(card), privateJwk);
}

/**
 * Verify a detached signature over `payload`, resolving the key from `jwks` by
 * the kid in the protected header. Returns { ok, reason, header }.
 */
export function verifyPayload(payload, signature, jwks) {
  let header;
  try {
    header = JSON.parse(unb64u(signature.protected).toString("utf8"));
  } catch {
    return { ok: false, reason: "protected header is not base64url-encoded JSON" };
  }
  if (header.alg !== ALG) return { ok: false, reason: `alg is ${header.alg}, expected ${ALG}`, header };
  if (!header.kid) return { ok: false, reason: "protected header carries no kid", header };

  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: `no key in the JWKS has kid ${header.kid}`, header };
  if (thumbprint(jwk) !== header.kid) {
    return { ok: false, reason: "the JWKS key's RFC 7638 thumbprint is not its own kid", header };
  }
  if (jwk.d) return { ok: false, reason: "the published JWKS contains a PRIVATE key", header };

  const ok = verify(
    "sha256",
    signingInput(signature.protected, payload),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    unb64u(signature.signature),
  );
  return ok
    ? { ok: true, header, payload_sha256: sha256(payload) }
    : { ok: false, reason: "the signature does not verify over the canonical payload", header };
}

/**
 * Verify one AgentCardSignature against a card and a JWKS, following the steps
 * §8.4.3 requires of a client: exclude signatures, canonicalise, resolve the key
 * by kid, verify.
 */
export function verifyCard(card, signature, jwks) {
  return verifyPayload(cardPayload(card), signature, jwks);
}

/**
 * The records manifest's signing payload: annotation keys and `signature`
 * excluded, canonicalised — EXACTLY the card's rule, so a verifier needs one
 * rule and not two.
 *
 * It lives here rather than in tools/sign-records.mjs because that file is a
 * script: importing it to borrow one function would run the signer, read the
 * private key, and exit if the key were absent. A rule the build and the gate
 * both depend on belongs in a module that is safe to import.
 */
export function manifestSigningPayload(m) {
  return canonicalBytes(
    Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("_") && k !== "signature")),
  );
}
