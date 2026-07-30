import { requestOrigin } from "@/lib/origin";

// The report route carries someone's table statistics in its fragment: never
// crawl it. Everything else is public documentation.
export async function GET() {
  const origin = await requestOrigin();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /report",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
