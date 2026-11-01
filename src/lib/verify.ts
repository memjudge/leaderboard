/**
 * Ed25519 signatures over RFC 8785 canonical JSON, checked exactly as
 * memjudge's `signing.verify_envelope` does.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import canonicalize from "canonicalize";

export class VerificationError extends Error {}

/** First 16 hex characters of the SHA-256 of the raw 32-byte public key. */
export function keyId(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return createHash("sha256")
    .update(der.subarray(der.length - 32))
    .digest("hex")
    .slice(0, 16);
}

/** Trusted public keys (`*.pub`, PEM) by key id. */
export function loadTrustedKeys(dir: string): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".pub"))
    .sort()) {
    const key = createPublicKey(readFileSync(join(dir, name), "utf8"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(`${name} is not an Ed25519 public key`);
    }
    keys.set(keyId(key), key);
  }
  return keys;
}

export function canonicalBytes(value: unknown): Buffer {
  const text = canonicalize(value);
  if (text === undefined) throw new VerificationError("payload cannot be canonicalised");
  return Buffer.from(text, "utf8");
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Check a signed envelope against the trusted keys and return the signing key id.
 * `envelope` must be exactly what JSON.parse returned for the file: converting
 * dates or numbers first would change the canonical bytes.
 */
export function verifyEnvelope(envelope: unknown, trusted: Map<string, KeyObject>): string {
  if (!isRecord(envelope) || !isRecord(envelope.payload) || !isRecord(envelope.signature)) {
    throw new VerificationError("malformed envelope: needs payload and signature objects");
  }
  const { payload, signature } = envelope;
  const kid = signature.key_id;
  const value = signature.value;
  if (typeof kid !== "string" || typeof value !== "string") {
    throw new VerificationError("malformed envelope: signature needs key_id and value");
  }
  if (value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new VerificationError("malformed envelope: signature value is not base64");
  }
  if (signature.alg !== "Ed25519") {
    throw new VerificationError(`unsupported algorithm ${JSON.stringify(signature.alg)}`);
  }
  if (payload.key_id !== kid) {
    throw new VerificationError("payload key_id does not match signature key_id");
  }
  const key = trusted.get(kid);
  if (key === undefined) throw new VerificationError(`unknown signing key ${kid}`);
  if (!verify(null, canonicalBytes(payload), key, Buffer.from(value, "base64"))) {
    throw new VerificationError("signature does not match payload");
  }
  return kid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
