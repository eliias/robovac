import { describe, expect, it } from "vitest";
import { analyticsUrl } from "./analytics-url";

describe("analyticsUrl", () => {
  it("collapses a short link path to /r", () => {
    expect(analyticsUrl("https://robovac.example/r/aBcD1234wXyZ")).toBe(
      "https://robovac.example/r",
    );
  });

  it("drops the fragment from a permalink", () => {
    expect(analyticsUrl("https://robovac.example/report#3.ab.cd.payload")).toBe(
      "https://robovac.example/report",
    );
  });

  it("drops the fragment from a short link", () => {
    expect(analyticsUrl("https://robovac.example/r/aBcD1234wXyZ#3.ab.cd.payload")).toBe(
      "https://robovac.example/r",
    );
  });

  it("keeps the query string of a normal page", () => {
    expect(analyticsUrl("https://robovac.example/explain/xmin-horizon?ref=chat")).toBe(
      "https://robovac.example/explain/xmin-horizon?ref=chat",
    );
  });

  it("leaves a normal path unchanged", () => {
    expect(analyticsUrl("https://robovac.example/mcp")).toBe("https://robovac.example/mcp");
  });

  it("collapses a short link that arrives as a referrer", () => {
    // The browser strips the fragment from document.referrer but keeps the
    // path, so the token reaches this function whole and the query with it.
    expect(analyticsUrl("https://robovac.example/r/aBcD1234wXyZ?utm_source=slack")).toBe(
      "https://robovac.example/r?utm_source=slack",
    );
  });

  it("leaves a path that only starts with the letter r unchanged", () => {
    expect(analyticsUrl("https://robovac.example/report")).toBe("https://robovac.example/report");
  });
});
