// node tools/sign-records.mjs
//
// Signs every published record under records/, so the evidence the page is
// generated from is tamper-evident and not only the card that points at it.
// Same key, same detached-JWS construction, same rule: this is run by a human,
// the build only verifies, and the build refuses when a record has changed since
// it was signed.
//
// RUN ORDER: if the Agent Card changed, `node tools/sign-card.mjs` first — it
// rewrites records/agent-card.signature.json, which is itself one of the records
// signed here.
//
// WHAT IS NOT SIGNED, and why:
//   records-manifest.json     — carries its own signature; signing it from
//                               inside itself is the circularity §8.4.1 excludes
//                               signatures[] to avoid.
//   signing-key.public.json   — a key vouching for itself adds no trust. Whoever
//                               can swap that file can swap the signature over
//                               it. It is bound by TLS and by nothing else, and
//                               saying so is more useful than a signature that
//                               looks like it helps.
//
// TWO HASHES PER RECORD, deliberately:
//   payload_sha256 — sha256 of the RFC 8785 canonical form. This is what the
//                    signature covers, and it survives reformatting.
//   file_sha256    — sha256 of the exact bytes served. Not signed; it is a
//                    convenience so a reader with sha256sum and no JCS
//                    implementation can still check byte-identity in one command.
//                    A mismatch here with a valid signature means the file was
//                    reformatted, not altered.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signPayload, verifyPayload, sha256, manifestSigningPayload, JKU, ALG } from "./card-signing.mjs";
import { canonicalBytes } from "./jcs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => join(ROOT, p);
const KEY_PATH = process.env.A2ATRAFFIC_SIGNING_KEY || join(homedir(), ".config", "a2atraffic", "signing-key.jwk");

const MANIFEST = "records/records-manifest.json";
const EXCLUDED = new Set(["records-manifest.json", "signing-key.public.json"]);

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const die = (m) => {
  console.error(`\x1b[31mrefused: \x1b[0m${m}`);
  process.exit(1);
};

if (!existsSync(KEY_PATH)) die(`no signing key at ${KEY_PATH}. Run: node tools/sign-card.mjs --init`);

const priv = JSON.parse(readFileSync(KEY_PATH, "utf8"));
const jwks = JSON.parse(readFileSync(R("records/signing-key.public.json"), "utf8"));

const files = readdirSync(R("records"))
  .filter((f) => f.endsWith(".json") && !EXCLUDED.has(f))
  .sort();

const records = files.map((f) => {
  const raw = readFileSync(R(`records/${f}`));
  const payload = canonicalBytes(JSON.parse(raw.toString("utf8")));
  const { signature, payload_sha256 } = signPayload(payload, priv);

  const check = verifyPayload(payload, signature, jwks);
  if (!check.ok) die(`the signature just produced for ${f} does not verify: ${check.reason}`);

  return { path: `/records/${f}`, bytes: raw.length, file_sha256: sha256(raw), payload_sha256, signature };
});

const manifest = {
  _comment:
    "Detached JWS signatures over every published record, produced by `node tools/sign-records.mjs` and verified — never produced — by build-site.mjs and launch-gate.mjs. Same key as the Agent Card, same construction: the payload is the record canonicalised per RFC 8785, and the signature is not carried inside the record it covers. Served at /.well-known/records-signatures.json with the annotation keys stripped.",
  _not_signed_comment:
    "records-manifest.json is absent because it carries its own signature below, and signing it from inside itself is the circularity the card avoids by excluding signatures[]. signing-key.public.json is absent because a key vouching for itself adds no trust — whoever can swap that file can swap a signature over it. Both omissions are stated rather than left to be noticed.",
  _limit_comment:
    "This proves a record has not changed since it was signed by the holder of that key. It does not prove the record is TRUE, and it does not prove who signed it: the verifying key is published on the same domain as the records, so TLS is what carries the domain binding. A signature is not a second opinion about the same channel.",
  alg: ALG,
  jku: JKU,
  kid: records.length ? JSON.parse(Buffer.from(records[0].signature.protected, "base64url").toString()).kid : null,
  signed_at: new Date().toISOString().slice(0, 10),
  records,
};

// The manifest's own signature. The exclusion rule is EXACTLY the card's — drop
// `signature`, drop the annotation keys, canonicalise the rest — so a verifier
// needs one rule for this file and the card, not two. An earlier version also
// stored a top-level payload_sha256 and had to exclude that as well, which is a
// second rule invented to describe a field a verifier can compute for itself.
const manifestPayload = manifestSigningPayload(manifest);
const self = signPayload(manifestPayload, priv);
if (!verifyPayload(manifestPayload, self.signature, jwks).ok) die("the manifest's own signature does not verify");
manifest.signature = self.signature;

writeFileSync(R(MANIFEST), JSON.stringify(manifest, null, 2) + "\n");

console.log(green("signed") + ` ${records.length} records`);
for (const r of records) console.log(`  ${r.path.padEnd(38)} ${String(r.bytes).padStart(6)} B  ${r.payload_sha256.slice(0, 12)}…`);
console.log(`\n  manifest signed over its own entries: ${self.payload_sha256.slice(0, 12)}…`);
console.log(`  written ${MANIFEST}\n\nRebuild and run the gate.`);
