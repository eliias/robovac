import { createClient } from "redis";
import {
  asStoredLink,
  LINK_TTL_MS,
  LINK_TTL_SECONDS,
  newId,
  type LinkStore,
  type StoredLink,
} from "./store";

// Derived from createClient rather than the exported RedisClientType, whose
// generic defaults differ between node-redis majors. This alias always matches
// the installed version and needs no cast.
export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;

/**
 * One connection per process, shared with the rate limiter. Connect once and
 * hand out the same client: node-redis queues commands until it is ready.
 */
export function redisClient(url: string): RedisClient {
  if (!client) {
    client = createClient({ url });
    client.on("error", (err) => console.error("[links] redis:", err));
    client
      .connect()
      .catch((err) =>
        console.error("[links] redis connect failed, link storage unavailable:", err),
      );
  }
  return client;
}

/**
 * Production. Two commands and no collision guard, see newId for why. The
 * expiry lives in the value as well as in EX: the report page prints the days
 * left, and reading it from the value costs no second round trip.
 */
export function redisStore(url: string): LinkStore {
  const redis = redisClient(url);

  return {
    async put(fragment) {
      const id = newId();
      const expiresAt = Date.now() + LINK_TTL_MS;
      const row: StoredLink = { fragment, expiresAt };
      await redis.set(`link:${id}`, JSON.stringify(row), {
        expiration: { type: "EX", value: LINK_TTL_SECONDS },
      });
      return { id, expiresAt };
    },

    async get(id) {
      const raw = await redis.get(`link:${id}`);
      if (!raw) return null;
      // A malformed value is a missing link, not a 500 on the report page.
      try {
        return asStoredLink(JSON.parse(raw));
      } catch {
        return null;
      }
    },
  };
}
