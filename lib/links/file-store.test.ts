import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fileStore } from "./file-store";

let path: string;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "robovac-links-")), "links.json");
});

describe("fileStore", () => {
  it("returns the fragment it stored", async () => {
    const store = fileStore(path);
    const { id } = await store.put("3.ab.cd.payload");
    expect(await store.get(id)).toMatchObject({ fragment: "3.ab.cd.payload" });
  });

  it("returns null for an unknown id", async () => {
    expect(await fileStore(path).get("nosuchid1234")).toBeNull();
  });

  it("gives two puts of the same fragment different ids", async () => {
    const store = fileStore(path);
    const a = await store.put("same");
    const b = await store.put("same");
    expect(a.id).not.toBe(b.id);
    expect(await store.get(a.id)).toMatchObject({ fragment: "same" });
    expect(await store.get(b.id)).toMatchObject({ fragment: "same" });
  });

  it("expires in 30 days", async () => {
    const { expiresAt } = await fileStore(path).put("x");
    const days = (expiresAt - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("returns null for an expired row", async () => {
    writeFileSync(
      path,
      JSON.stringify({ oldlink12345: { fragment: "gone", expiresAt: Date.now() - 1000 } }),
    );
    expect(await fileStore(path).get("oldlink12345")).toBeNull();
  });

  it("drops an expired row when the next put rewrites the file", async () => {
    writeFileSync(
      path,
      JSON.stringify({ oldlink12345: { fragment: "gone", expiresAt: Date.now() - 1000 } }),
    );
    await fileStore(path).put("fresh");
    expect(readFileSync(path, "utf8")).not.toContain("oldlink12345");
  });

  it("survives a corrupt file", async () => {
    writeFileSync(path, "not json at all");
    const store = fileStore(path);
    const { id } = await store.put("fresh");
    expect(await store.get(id)).toMatchObject({ fragment: "fresh" });
  });

  it("does not destroy live rows when the file is corrupt", async () => {
    const store = fileStore(path);
    const { id } = await store.put("keep me");
    writeFileSync(path, `${readFileSync(path, "utf8")}garbage`);
    expect(await store.get(id)).toBeNull();

    writeFileSync(path, readFileSync(path, "utf8").replace("garbage", ""));
    expect(await store.get(id)).toMatchObject({ fragment: "keep me" });
  });

  it("returns null for __proto__ instead of Object.prototype", async () => {
    const store = fileStore(path);
    await store.put("some link");
    expect(await store.get("__proto__")).toBeNull();
  });

  it("returns null for a stored value of the wrong shape", async () => {
    writeFileSync(
      path,
      JSON.stringify({ badshape1234: { fragment: 7, expiresAt: Date.now() + 1000 } }),
    );
    expect(await fileStore(path).get("badshape1234")).toBeNull();
  });
});
