import { defineConfig } from "vitest/config";
import path from "node:path";

// `server-only` throws by default outside a real Next.js "react-server"
// bundling context (confirmed live: its package.json exports condition
// picks `index.js`, which unconditionally throws, unless the "react-server"
// export condition is set — which only Next.js's own bundler sets). Every
// lib/ file under test here starts with `import "server-only"`, so aliasing
// it straight to the package's own harmless `empty.js` (same file Next.js
// itself resolves to) lets these modules load under plain Vitest/Node
// without pulling in a whole Next.js runtime just to run unit tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
    },
  },
});
