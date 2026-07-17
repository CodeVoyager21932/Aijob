import { constants } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { sha256 } from "../lib/canonical-json.js";

export interface StoredSnapshot {
  contentHash: string;
  objectKey: string;
  absolutePath: string;
  originalByteSize: number;
  storedByteSize: number;
  contentType: string;
  contentEncoding: "gzip";
}

export async function storeSnapshot(
  snapshotRoot: string,
  sourceKey: string,
  body: Uint8Array,
  contentType: string,
): Promise<StoredSnapshot> {
  if (!/^[a-z0-9-]+$/.test(sourceKey)) {
    throw new Error("INVALID_SOURCE_KEY");
  }

  const contentHash = sha256(body);
  const objectKey = posix.join(sourceKey, contentHash.slice(0, 2), `${contentHash}.json.gz`);
  const absolutePath = join(snapshotRoot, ...objectKey.split("/"));
  // Modern Node writes a zero gzip mtime, so equal input stays byte-for-byte deterministic.
  const compressed = gzipSync(body, { level: 9 });
  await mkdir(dirname(absolutePath), { recursive: true });

  try {
    await writeFile(absolutePath, compressed, {
      flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  const stored = await readFile(absolutePath);
  const restored = gunzipSync(stored);
  if (restored.byteLength !== body.byteLength || sha256(restored) !== contentHash) {
    throw new Error("SNAPSHOT_INTEGRITY_CHECK_FAILED");
  }

  return {
    contentHash,
    objectKey,
    absolutePath,
    originalByteSize: body.byteLength,
    storedByteSize: stored.byteLength,
    contentType,
    contentEncoding: "gzip",
  };
}
