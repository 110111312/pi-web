import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      {
        find: /^shiki$/,
        replacement: fileURLToPath(
          new URL("./src/shims/shiki-diffs.ts", import.meta.url),
        ),
      },
      {
        find: /^shiki\/wasm$/,
        replacement: fileURLToPath(
          new URL("./src/shims/shiki-wasm-empty.ts", import.meta.url),
        ),
      },
    ],
  },
  build: {
    outDir: "../../web-dist",
    emptyOutDir: true,
    target: "esnext",
    cssMinify: "lightningcss",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Group beautiful-mermaid + cytoscape + katex together since they're always co-loaded
          if (
            id.includes("node_modules/beautiful-mermaid") ||
            id.includes("node_modules/cytoscape") ||
            id.includes("node_modules/katex")
          ) {
            return "vendor-mermaid";
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
