import { headers } from "next/headers";

/**
 * The public origin, derived from the request (og:image, canonical, and
 * JSON-LD need absolute URLs). No configuration: the host header decides.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
