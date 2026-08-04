import { afterEach, describe, expect, it, vi } from "vitest";

const { fileStore, redisStore } = vi.hoisted(() => ({
  fileStore: vi.fn(() => ({ kind: "file" }) as const),
  redisStore: vi.fn(() => ({ kind: "redis" }) as const),
}));

vi.mock("./file-store", () => ({ fileStore }));
vi.mock("./redis-store", () => ({ redisStore }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fileStore.mockClear();
  redisStore.mockClear();
});

async function load() {
  vi.resetModules();
  return (await import("./index")).linkStore;
}

describe("linkStore", () => {
  it("throws in production without REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");
    const linkStore = await load();
    expect(() => linkStore()).toThrow(/REDIS_URL/);
  });

  it("picks the file store in development and never touches redis", async () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    const linkStore = await load();

    linkStore();

    expect(fileStore).toHaveBeenCalledTimes(1);
    expect(fileStore).toHaveBeenCalledWith(".links-dev.json");
    expect(redisStore).not.toHaveBeenCalled();
  });

  it("picks the redis store when REDIS_URL is set and never touches the file store", async () => {
    const url = "redis://example.invalid:6379";
    vi.stubEnv("REDIS_URL", url);
    vi.stubEnv("NODE_ENV", "production");
    const linkStore = await load();

    linkStore();

    expect(redisStore).toHaveBeenCalledTimes(1);
    expect(redisStore).toHaveBeenCalledWith(url);
    expect(fileStore).not.toHaveBeenCalled();
  });

  it("returns the same instance on every call, the factory runs once", async () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    const linkStore = await load();

    const first = linkStore();
    const second = linkStore();

    expect(first).toBe(second);
    expect(fileStore).toHaveBeenCalledTimes(1);
  });
});
