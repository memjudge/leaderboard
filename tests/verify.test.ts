import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, keyId, loadTrustedKeys, verifyEnvelope } from "../src/lib/verify.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const RUN = "20261001T120000Z-a11111";
const trusted = loadTrustedKeys(join(FIXTURES, "keys"));

/** A fresh copy of a fixture signed by memjudge (Python), exactly as JSON.parse returns it. */
function envelope(): { payload: Record<string, any>; signature: Record<string, any> } {
  return JSON.parse(readFileSync(join(FIXTURES, "results", "runs", `${RUN}.json`), "utf8"));
}

describe("verifyEnvelope", () => {
  it("accepts a result signed by memjudge (Python and TypeScript agree byte for byte)", () => {
    expect(verifyEnvelope(envelope(), trusted)).toBe("354ba5be4e44ca1e");
  });

  it("matches memjudge's key id for the trusted key", () => {
    expect([...trusted.keys()]).toEqual(["354ba5be4e44ca1e"]);
  });

  it("rejects a changed number", () => {
    const e = envelope();
    e.payload.metrics.top30.overall.accuracy = 0.99;
    expect(() => verifyEnvelope(e, trusted)).toThrow("signature does not match payload");
  });

  it("rejects a changed artifact URL", () => {
    const e = envelope();
    e.payload.artifacts[0].url = "https://elsewhere.example.org/x";
    expect(() => verifyEnvelope(e, trusted)).toThrow("signature does not match payload");
  });

  it("rejects an unknown key", () => {
    expect(() => verifyEnvelope(envelope(), new Map())).toThrow("unknown signing key");
  });

  it("rejects a key id that differs between payload and signature", () => {
    const e = envelope();
    e.payload.key_id = "0000000000000000";
    expect(() => verifyEnvelope(e, trusted)).toThrow("does not match signature key_id");
  });

  it("rejects other algorithms", () => {
    const e = envelope();
    e.signature.alg = "RS256";
    expect(() => verifyEnvelope(e, trusted)).toThrow("unsupported algorithm");
  });

  it("rejects a signature that is not base64", () => {
    const e = envelope();
    e.signature.value = "not base64!";
    expect(() => verifyEnvelope(e, trusted)).toThrow("not base64");
  });

  it("rejects things that are not envelopes", () => {
    expect(() => verifyEnvelope([], trusted)).toThrow("malformed envelope");
    expect(() => verifyEnvelope({ payload: {} }, trusted)).toThrow("malformed envelope");
  });

  it("verifies a payload signed in TypeScript with a fresh key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const kid = keyId(publicKey);
    const payload = { b: 1, a: [1.5, "é😀 ", null, true], key_id: kid };
    const value = sign(null, canonicalBytes(payload), privateKey).toString("base64");
    const keys = new Map([[kid, publicKey]]);
    expect(
      verifyEnvelope({ payload, signature: { alg: "Ed25519", key_id: kid, value } }, keys),
    ).toBe(kid);
  });
});

describe("canonicalBytes", () => {
  it("follows RFC 8785 like memjudge's test vectors", () => {
    expect(canonicalBytes({ b: 1, a: [1.0, "é", null, true] }).toString()).toBe(
      '{"a":[1,"é",null,true],"b":1}',
    );
    expect(canonicalBytes({ x: 1e21, y: 0.1 }).toString()).toBe('{"x":1e+21,"y":0.1}');
  });
});
