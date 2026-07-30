#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

const server = new McpServer({ name: "robovac", version: "0.2.0" });
registerTools(server);
const transport = new StdioServerTransport();
await server.connect(transport);
