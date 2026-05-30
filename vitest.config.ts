import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    globals: false
  }
});
