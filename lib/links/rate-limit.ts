import { redisClient } from "./redis-store";

/** A normal fragment is about 900 bytes. This only catches abuse. */
export const MAX_FRAGMENT_BYTES = 8192;

export const MAX_REPORTS_PER_HOUR = 300;

/**
 * One counter per IP per clock hour, counting report writes. create_report
 * calls it, the three store-free tools never do. It exists to stop casual
 * misuse of free storage, nothing more. Without Redis there is nothing to
 * protect and nowhere to count, so development always allows.
 *
 * A Redis error allows too: the store is already unavailable in that case,
 * and a counter outage is not a reason to refuse the calls that still work.
 */
export async function allow(ip: string): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return true;

  try {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `rl:${ip}:${hour}`;
    const redis = redisClient(url);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    return count <= MAX_REPORTS_PER_HOUR;
  } catch (err) {
    console.error("[links] rate limit unavailable, allowing the report:", err);
    return true;
  }
}
