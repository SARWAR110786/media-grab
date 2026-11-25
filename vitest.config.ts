import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mediagrab/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web"),
      "server-only": path.resolve(__dirname, "apps/web/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
