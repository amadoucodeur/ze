import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

// Use the same React instance as the test renderer in the Bun workspace.
const require = createRequire(import.meta.url);
const rendererRequire = createRequire(require.resolve("@testing-library/react"));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: dirname(rendererRequire.resolve("react")),
      "react-dom": dirname(rendererRequire.resolve("react-dom")),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
