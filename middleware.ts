import { type NextRequest, NextResponse } from "next/server";

// /mcp is the docs page, but agents get pointed at it as the endpoint.
// Send protocol traffic to the real handler at /api/mcp; browsers still
// get the page. Protocol traffic is POST/DELETE, or GET with an SSE accept.
export function middleware(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  const isProtocol =
    request.method === "POST" ||
    request.method === "DELETE" ||
    (request.method === "GET" && accept.includes("text/event-stream"));
  if (isProtocol) {
    return NextResponse.rewrite(new URL("/api/mcp", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/mcp" };
