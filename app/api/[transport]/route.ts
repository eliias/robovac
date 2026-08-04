import { createMcpHandler } from "mcp-handler";
import { linkStore } from "@/lib/links";
import { registerTools } from "@/lib/mcp/tools";

// The public MCP endpoint at /api/mcp. No auth. Nothing is limited here:
// create_report counts its own writes per IP, and the three store-free tools
// answer every call. mcp-handler builds the MCP server inside the request and
// runs this callback there, so the per-request IP reaches registerTools. One
// handler per request costs one closure, because the server was per request
// either way.
const handler = (ip: string) =>
  createMcpHandler(
    (server) => registerTools(server, linkStore(), ip),
    { serverInfo: { name: "robovac", version: "0.2.0" } },
    { basePath: "/api" },
  );

// The middleware rewrites protocol traffic on /mcp to this route, but the
// request keeps its original URL. The handler checks that URL against
// /api/mcp, so prefix the path before it looks.
const normalized = async (request: Request) => {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const handle = handler(ip);

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    url.pathname = `/api${url.pathname}`;
    return handle(new Request(url, request));
  }
  return handle(request);
};

export { normalized as GET, normalized as POST, normalized as DELETE };
