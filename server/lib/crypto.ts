// AES-256-GCM encryption helper for integration tokens.
//
// The key comes from the ENCRYPTION_KEY env var (32 bytes hex => 64 hex chars).
// If it is missing, we generate a development key and persist it to a gitignored
// file (.encryption_key) so that encrypted values survive restarts in dev. In
// production you MUST set ENCRYPTION_KEY explicitly.
//
// Ciphertext format: "iv:tag:data" where each part is base64.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_FILE = resolve(process.cwd(), ".encryption_key");
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce length
const KEY_LENGTH = 32; // 256 bits

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv && fromEnv.trim().length > 0) {
    const buf = Buffer.from(fromEnv.trim(), "hex");
    if (buf.length !== KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes hex (64 hex chars). ` +
          `Generate one with: openssl rand -hex 32`,
      );
    }
    cachedKey = buf;
    return buf;
  }

  // Dev fallback: read or generate a persisted key.
  if (existsSync(KEY_FILE)) {
    const buf = Buffer.from(readFileSync(KEY_FILE, "utf-8").trim(), "hex");
    if (buf.length === KEY_LENGTH) {
      cachedKey = buf;
      console.warn(
        "[crypto] WARN: ENCRYPTION_KEY env var is not set. Using the dev key " +
          "from .encryption_key. Set ENCRYPTION_KEY in production.",
      );
      return buf;
    }
  }

  const generated = randomBytes(KEY_LENGTH);
  try {
    writeFileSync(KEY_FILE, generated.toString("hex"), { mode: 0o600 });
  } catch (err) {
    console.warn("[crypto] WARN: could not persist dev key to .encryption_key:", err);
  }
  console.warn(
    "[crypto] WARN: ENCRYPTION_KEY env var is not set. Generated a NEW dev key " +
      "and stored it in .encryption_key (gitignored). Set ENCRYPTION_KEY in production.",
  );
  cachedKey = generated;
  return generated;
}

/** Encrypt a plaintext string. Returns "iv:tag:data" (each part base64). */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

/** Decrypt a "iv:tag:data" ciphertext back to plaintext. Throws on tamper. */
export function decrypt(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format, expected iv:tag:data");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

/** Safe decrypt: returns null instead of throwing (e.g. for masked/empty values). */
export function tryDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}
