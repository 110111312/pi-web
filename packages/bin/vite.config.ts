import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-web/bridge": resolve(__dirname, "../bridge/src"),
    },
  },
  build: {
    outDir: "../../dist/bin",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/^@mariozechner\//, /^@earendil-works\//, /^node:/, "ws"],
    },
    target: "node20",
    ssr: true,
  },
});
