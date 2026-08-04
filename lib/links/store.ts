import { randomBytes } from "node:crypto";

/**
 * How long a short link resolves. A constant, never a parameter: no caller
 * wants a different lifetime, and a per-link TTL is surface nobody asked for.
 */
export const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LINK_TTL_MS = LINK_TTL_SECONDS * 1000;

export interface StoredLink {
  /** The codec fragment, exactly as encodeReport produced it. */
  fragment: string;
  /** Epoch milliseconds. The report page prints the days left from this. */
  expiresAt: number;
}

export interface LinkStore {
  put(fragment: string): Promise<{ id: string; expiresAt: number }>;
  get(id: string): Promise<StoredLink | null>;
}

/**
 * What both stores return, or null. Everything a store loads is untrusted: a
 * hand-edited JSON file, a Redis value from an older shape, or the id
 * `__proto__`, which reaches Object.prototype through a plain object and
 * reads as a truthy row with no fields. One guard for both, so the two
 * implementations cannot drift.
 */
export function asStoredLink(value: unknown): StoredLink | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<StoredLink>;
  if (typeof row.fragment !== "string" || typeof row.expiresAt !== "number") return null;
  return { fragment: row.fragment, expiresAt: row.expiresAt };
}

/**
 * 9 random bytes as base64url: exactly 12 characters, no padding, 72 bits.
 * The payload carries real table names, so a guessable id leaks production
 * data. There is no collision check anywhere: at 72 bits the first collision
 * arrives near 2^36 stored links.
 */
export function newId(): string {
  return randomBytes(9).toString("base64url");
}
