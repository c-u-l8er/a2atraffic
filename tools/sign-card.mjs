// node tools/sign-card.mjs --init   generate the signing key (once, ever)
// node tools/sign-card.mjs          re-sign the card after its content changes
//
// The private key lives OUTSIDE this repository, at
// ~/.config/a2atraffic/signing-key.jwk, mode 0600. Nothing in the build reads
// it; only this script does, and only when a human runs it. What is committed is
// the public JWKS (records/signing-key.public.json) and the detached signature
// (records/agent-card.signature.json).
//
// Rotation: --init to a fresh path, publish BOTH public keys in the JWKS, re-sign,
// then drop the old key once no cached card references it. §8.4.3 allows multiple
// signatures for exactly this.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signCard, verifyCard, thumbprint, JKU, ALG } from "./card-signing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => join(ROOT, p);
const KEY_PATH = process.env.A2ATRAFFIC_SIGNING_KEY || join(homedir(), ".config", "a2atraffic", "signing-key.jwk");

const PUBLIC_RECORD = "records/signing-key.public.json";
const SIG_RECORD = "records/agent-card.signature.json";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const die = (m) => {
  console.error(red("refused: ") + m);
  process.exit(1);
};

if (process.argv.includes("--init")) {
  if (existsSync(KEY_PATH)) {
    die(
      `a signing key already exists at ${KEY_PATH}.\n` +
        `  Overwriting it would orphan every card already signed with it. To rotate, --init to a\n` +
        `  different path with A2ATRAFFIC_SIGNING_KEY set, publish both public keys, then re-sign.`,
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const priv = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const kid = thumbprint(pub);

  mkdirSync(dirname(KEY_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(KEY_PATH, JSON.stringify({ ...priv, kid, alg: ALG, use: "sig" }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);

  writeFileSync(
    R(PUBLIC_RECORD),
    JSON.stringify(
      {
        _comment:
          "The PUBLIC half of the Agent Card signing key, published at /.well-known/jwks.json and named by the jku in every signature's protected header. The private half is not in this repository and never will be; it lives at ~/.config/a2atraffic/signing-key.jwk, mode 0600, on one machine. If that file is lost the card cannot be re-signed and a new key must be published — which is a real single point of failure and is stated rather than hidden.",
        _kid_comment:
          "kid is the RFC 7638 thumbprint of the key itself, not a name. A named kid can be reused after a rotation and quietly point at a different key; a thumbprint cannot, and launch-gate.mjs re-derives it rather than trusting it.",
        keys: [{ ...pub, kid, alg: ALG, use: "sig" }],
      },
      null,
      2,
    ) + "\n",
  );

  console.log(green("generated") + ` ES256 signing key`);
  console.log(`  private  ${KEY_PATH}  (mode 0600, NOT in the repository)`);
  console.log(`  public   ${PUBLIC_RECORD}`);
  console.log(`  kid      ${kid}`);
  console.log(`\nNow run: node tools/sign-card.mjs`);
  process.exit(0);
}

// ── sign ───────────────────────────────────────────────────────────────────
if (!existsSync(KEY_PATH)) die(`no signing key at ${KEY_PATH}. Run: node tools/sign-card.mjs --init`);

const priv = JSON.parse(readFileSync(KEY_PATH, "utf8"));
const jwks = JSON.parse(readFileSync(R(PUBLIC_RECORD), "utf8"));

// Sign the same public card the build emits: the record with annotation keys
// stripped. Deriving it here rather than reading .well-known/agent-card.json
// means signing does not depend on a build having already run.
const draft = JSON.parse(readFileSync(R("records/agent-card.draft.json"), "utf8"));
const card = Object.fromEntries(Object.entries(draft).filter(([k]) => !k.startsWith("_")));

const { signature, payload_sha256, kid } = signCard(card, priv);

const check = verifyCard(card, signature, jwks);
if (!check.ok) die(`the signature just produced does not verify: ${check.reason}`);

writeFileSync(
  R(SIG_RECORD),
  JSON.stringify(
    {
      _comment:
        "A detached JWS over the Agent Card, A2A §8.4. The payload is the card with `signatures` excluded, canonicalised per RFC 8785 — it is not carried here, because the card itself is the payload. Produced by `node tools/sign-card.mjs`, never by the build: ECDSA is randomised, so a build that signed would not be byte-identical to the previous one. build-site.mjs and launch-gate.mjs only verify.",
      _payload_sha256_comment:
        "sha256 of the canonical payload this signature was made over. The build refuses when the card's current canonical payload hashes differently, which is what turns 'someone edited the card and forgot to re-sign' from a silent stale signature into a refused build.",
      payload_sha256,
      kid,
      alg: ALG,
      jku: JKU,
      signed_at: new Date().toISOString().slice(0, 10),
      signature,
    },
    null,
    2,
  ) + "\n",
);

console.log(green("signed") + ` the Agent Card`);
console.log(`  kid              ${kid}`);
console.log(`  payload sha256   ${payload_sha256}`);
console.log(`  written          ${SIG_RECORD}`);
console.log(`\nVerified against ${PUBLIC_RECORD} before writing. Rebuild and run the gate.`);
