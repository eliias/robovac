import { requestOrigin } from "@/lib/origin";

// The report routes carry someone's table statistics, /report in its fragment
// and /r/ in a stored payload: never crawl either. The rest is public docs.
export async function GET() {
  const origin = await requestOrigin();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /report",
    "Disallow: /r/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
