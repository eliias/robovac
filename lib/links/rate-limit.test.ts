import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { incr, expire } = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn() }));
vi.mock("./redis-store", () => ({ redisClient: () => ({ incr, expire }) }));

import { allow, MAX_REPORTS_PER_HOUR } from "./rate-limit";

const originalUrl = process.env.REDIS_URL;

beforeEach(() => {
  incr.mockReset();
  expire.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.REDIS_URL = originalUrl;
  vi.restoreAllMocks();
});

describe("allow", () => {
  it("allows without touching redis when REDIS_URL is unset", async () => {
    delete process.env.REDIS_URL;
    expect(await allow("1.2.3.4")).toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });

  it("allows when redis throws", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    incr.mockRejectedValue(new Error("connection refused"));
    expect(await allow("1.2.3.4")).toBe(true);
  });

  it("refuses the report that goes over the cap", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    incr.mockResolvedValue(MAX_REPORTS_PER_HOUR + 1);
    expect(await allow("1.2.3.4")).toBe(false);
  });
});

describe("MAX_REPORTS_PER_HOUR", () => {
  it("is 300 report writes", () => {
    expect(MAX_REPORTS_PER_HOUR).toBe(300);
  });
});
