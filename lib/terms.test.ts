import { describe, expect, it } from "vitest";
import { findTerm, suggestTerms, TERMS, termHref } from "./terms";

describe("findTerm", () => {
  it("resolves a canonical slug", () => {
    expect(findTerm("bloat")?.slug).toBe("bloat");
  });

  it("resolves a tool name to the operation that covers it", () => {
    expect(findTerm("pg_repack")?.slug).toBe("table-rewrite");
    expect(findTerm("pg_squeeze")?.slug).toBe("table-rewrite");
    expect(findTerm("pg-osc")?.slug).toBe("table-rewrite");
    expect(findTerm("vacuum-full")?.slug).toBe("table-rewrite");
  });

  it("returns undefined for a slug that is nobody's alias", () => {
    expect(findTerm("pg_partman")).toBeUndefined();
  });

  it("sends an alias to the canonical href, not to its own path", () => {
    expect(termHref("pg_squeeze")).toBe("/explain/table-rewrite");
  });

  it("keeps every alias out of the canonical slug list", () => {
    const slugs = new Set(TERMS.map((t) => t.slug));
    for (const t of TERMS) {
      for (const alias of t.aliases ?? []) expect(slugs.has(alias)).toBe(false);
    }
  });
});

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

  it("scores aliases, so a typo on a tool name finds the operation", () => {
    expect(suggestTerms("pg_squeze")[0].slug).toBe("table-rewrite");
  });
});
