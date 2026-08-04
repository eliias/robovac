import { describe, expect, it } from "vitest";
import { LINK_TTL_SECONDS, newId } from "./store";

describe("newId", () => {
  it("is exactly 12 base64url characters", () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});

describe("LINK_TTL_SECONDS", () => {
  it("is 30 days", () => {
    expect(LINK_TTL_SECONDS).toBe(2592000);
  });
});
