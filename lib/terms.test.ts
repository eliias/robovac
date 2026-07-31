import { describe, expect, it } from "vitest";
import { suggestTerms } from "./terms";

describe("suggestTerms", () => {
  it("resolves a dropped vacuum_ prefix to the scale factors", () => {
    const s = suggestTerms("autovacuum_scale_factor").map((t) => t.slug);
    expect(s).toHaveLength(3);
    expect(s).toContain("autovacuum_vacuum_scale_factor");
    expect(s).toContain("autovacuum_analyze_scale_factor");
  });

  it("resolves a typo by trigram similarity", () => {
    const s = suggestTerms("xmin-horizn").map((t) => t.slug);
    expect(s[0]).toBe("xmin-horizon");
  });

  it("puts an exact match first", () => {
    expect(suggestTerms("bloat")[0].slug).toBe("bloat");
  });
});
