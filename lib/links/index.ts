import { fileStore } from "./file-store";
import { redisStore } from "./redis-store";
import type { LinkStore } from "./store";

export type { LinkStore, StoredLink } from "./store";

/** Where the development store keeps its rows. Gitignored. */
const DEV_STORE_PATH = ".links-dev.json";

let store: LinkStore | undefined;

/**
 * REDIS_URL is the only switch. One variable cannot disagree with itself the
 * way a separate USE_REDIS flag can. A production deploy that forgets it
 * fails here, instead of quietly writing links into a container filesystem
 * that the next replica cannot read.
 */
export function linkStore(): LinkStore {
  if (store) return store;

  const url = process.env.REDIS_URL;
  if (url) {
    store = redisStore(url);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required in production: short report links need a store");
  } else {
    store = fileStore(DEV_STORE_PATH);
  }
  return store;
}
