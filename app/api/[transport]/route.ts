import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/packages/robovac-mcp/src/tools";

// The public MCP endpoint at /api/mcp: the same four tools as the stdio
// package, hosted. Stateless like everything else here: no auth, no storage.
const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "robovac", version: "0.2.0" } },
  { basePath: "/api" },
);

// The middleware rewrites protocol traffic on /mcp to this route, but the
// request keeps its original URL. The handler checks that URL against
// /api/mcp, so prefix the path before it looks.
const normalized = (request: Request) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    url.pathname = `/api${url.pathname}`;
    return handler(new Request(url, request));
  }
  return handler(request);
};

export { normalized as GET, normalized as POST, normalized as DELETE };
