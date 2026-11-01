/**
 * Raw run files (artifacts), fetched from R2 or a local folder and checked against the
 * SHA-256 hash in the signed result before anything is shown.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import type { Artifact } from "./types.ts";

/** The artifact is not where its result says it is. */
export class ArtifactMissing extends Error {}
/** The artifact's bytes differ from the hash in the signed result. */
export class ArtifactMismatch extends Error {}

export interface ArtifactSource {
  /** Throws ArtifactMissing when the file does not exist. */
  read(runId: string, artifact: Artifact): Promise<Uint8Array>;
}

export function sha256(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

/** `<dir>/<run_id>/<name>`: a local copy of the artifacts, for previews and tests. */
export function localSource(dir: string): ArtifactSource {
  return {
    async read(runId, artifact) {
      const path = join(dir, runId, artifact.name);
      if (!existsSync(path)) throw new ArtifactMissing(`${path} not found`);
      return readFileSync(path);
    },
  };
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Read through R2's S3 API, so the bucket can stay private. The object key is the URL path. */
export function r2Source(config: R2Config): ArtifactSource {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  return {
    async read(_runId, artifact) {
      if (!artifact.url) throw new ArtifactMissing(`${artifact.name} has no URL`);
      const key = new URL(artifact.url).pathname.replace(/^\/+/, "");
      const res = await client.fetch(`${endpoint}/${key}`);
      if (res.status === 404) throw new ArtifactMissing(`${key} not found in R2`);
      if (!res.ok) throw new Error(`R2 returned ${res.status} for ${key}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Fetch an artifact (or take it from the cache) and check its hash. */
export async function loadArtifact(
  source: ArtifactSource,
  runId: string,
  artifact: Artifact,
  cacheDir: string | null,
): Promise<Uint8Array> {
  const cached = cacheDir ? join(cacheDir, artifact.sha256.replace(/^sha256:/, "")) : null;
  if (cached && existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (sha256(bytes) === artifact.sha256) return bytes;
  }
  const bytes = await source.read(runId, artifact);
  if (sha256(bytes) !== artifact.sha256) {
    throw new ArtifactMismatch(`${artifact.name} does not match its signed hash`);
  }
  if (cached && cacheDir) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, bytes);
  }
  return bytes;
}
