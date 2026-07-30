import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["lib/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**", "packages/robovac-mcp/src/**"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "cobertura"],
    },
  },
});
