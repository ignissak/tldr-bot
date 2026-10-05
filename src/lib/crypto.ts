import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface Sealed {
  iv: Uint8Array;
  tag: Uint8Array;
  data: Uint8Array;
}

/**
 * AES-256-GCM. `aad` binds the ciphertext to its owner (Discord user id),
 * so a row copied to another user fails to decrypt.
 */
export function seal(key: Buffer, plaintext: string, aad: string): Sealed {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

export function open(key: Buffer, sealed: Sealed, aad: string): string {
  const decipher = createDecipheriv(ALGO, key, sealed.iv, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.data), decipher.final()]).toString("utf8");
}
