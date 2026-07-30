import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/packages/robovac-mcp/src/tools";

// The public MCP endpoint at /api/mcp: the same four tools as the stdio
// package, hosted. Stateless like everything else here — no auth, no storage.
const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "robovac", version: "0.2.0" } },
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
