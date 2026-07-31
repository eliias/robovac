import { requestOrigin } from "@/lib/origin";
import { TERMS } from "@/lib/terms";

// The indexable surface: the four public pages and the built explain pages.
// The report route is deliberately absent (noindex, fragment-only payload).
export async function GET() {
  const origin = await requestOrigin();
  const paths = [
    "/",
    "/demo",
    "/mcp",
    "/arcana",
    ...TERMS.filter((t) => t.built).map((t) => `/explain/${t.slug}`),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}
