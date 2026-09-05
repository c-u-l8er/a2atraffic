// RFC 8785's own test vector. If this passes, the canonicaliser handles the
// cases that are actually hard — number formatting at the edges of double
// precision, control characters, lone surrogates — none of which the Agent Card
// itself exercises, which is exactly why they need a test rather than a reading.
import { canonicalize, cardPayload } from "../tools/jcs.mjs";

let fails = 0;
const t = (label, fn) => {
  try {
    fn();
    console.log("  ok  ", label);
  } catch (e) {
    fails++;
    console.log("  FAIL", label, "->", e.message);
  }
};
const eq = (a, b) => {
  if (a !== b) throw new Error(`\n    got      ${a}\n    expected ${b}`);
};

console.log("RFC 8785 canonicalisation\n");

t("the RFC's worked example", () => {
  const input = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
    // € $ U+000F LF A ' B " \ \ " /  — the RFC's string, written with escapes.
    string: "\u20ac$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  eq(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

t("keys sort by UTF-16 code unit, not by locale", () => {
  eq(canonicalize({ "\u00e4": 1, "\u000b": 2, a: 3, A: 4 }), '{"\\u000b":2,"A":4,"a":3,"\u00e4":1}');
});

t("sorting is recursive, and array order is preserved", () => {
  eq(canonicalize({ b: [{ z: 1, a: 2 }, { y: 3 }], a: 1 }), '{"a":1,"b":[{"a":2,"z":1},{"y":3}]}');
});

t("lone surrogates are escaped rather than emitted raw", () => {
  eq(canonicalize({ s: "\ud800" }), '{"s":"\\ud800"}');
});

t("the card payload excludes signatures and nothing else", () => {
  const card = { name: "x", signatures: [{ protected: "p", signature: "s" }], version: "1" };
  eq(cardPayload(card).toString("utf8"), '{"name":"x","version":"1"}');
});

t("the payload is identical whether or not signatures is present", () => {
  eq(
    cardPayload({ b: 2, a: 1, signatures: [] }).toString("utf8"),
    cardPayload({ a: 1, b: 2 }).toString("utf8"),
  );
});

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
