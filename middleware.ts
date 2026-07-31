import { type NextRequest, NextResponse } from "next/server";

// Two jobs. /mcp is the docs page, but agents get pointed at it as the
// endpoint: protocol traffic (POST/DELETE, or GET with an SSE accept) goes
// to the real handler at /api/mcp; browsers still get the page. /explain
// requests carry their path as a header, because the not-found boundary
// cannot read params and needs the slug for its suggestions (N1).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/mcp") {
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
  const headers = new Headers(request.headers);
  headers.set("x-robovac-path", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/mcp", "/explain/:path*"] };
