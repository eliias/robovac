import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "cobertura"],
    },
  },
});
