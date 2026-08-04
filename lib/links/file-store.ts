import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { asStoredLink, LINK_TTL_MS, newId, type LinkStore, type StoredLink } from "./store";

type Rows = Record<string, StoredLink>;

const live = (rows: Rows, now: number): Rows =>
  Object.fromEntries(Object.entries(rows).filter(([, row]) => row.expiresAt > now));

/**
 * The development store. One JSON file, rewritten by put, which is also where
 * expired rows are dropped. A plain in-process Map would lose every link on a
 * `next dev` module reload, which makes a 30-day flow untestable. A corrupt
 * file reads as empty: this is a scratch file, not a database. get never
 * writes, so one bad read cannot overwrite the live rows with that empty
 * object.
 */
export function fileStore(path: string): LinkStore {
  const load = (): Rows => {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Rows;
    } catch {
      return {};
    }
  };

  const save = (rows: Rows) => writeFileSync(path, JSON.stringify(rows, null, 2));

  return {
    async put(fragment) {
      const now = Date.now();
      const id = newId();
      const expiresAt = now + LINK_TTL_MS;
      save({ ...live(load(), now), [id]: { fragment, expiresAt } });
      return { id, expiresAt };
    },

    async get(id) {
      const row = asStoredLink(load()[id]);
      return row && row.expiresAt > Date.now() ? row : null;
    },
  };
}
