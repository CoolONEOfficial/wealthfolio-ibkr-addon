import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Packages provided by the Wealthfolio addon sandbox at runtime (see HOST_DEPENDENCIES
 * in @wealthfolio/addon-sdk). They must stay external ESM imports so the addon shares
 * the host's React instance; keep in sync with manifest.json "hostDependencies".
 */
const hostProvidedDependencies = [
  "@tanstack/react-query",
  "@wealthfolio/addon-sdk",
  "@wealthfolio/addon-sdk/host-api",
  "@wealthfolio/addon-sdk/host-dependencies",
  "@wealthfolio/addon-sdk/manifest",
  "@wealthfolio/addon-sdk/permissions",
  "@wealthfolio/addon-sdk/types",
  "@wealthfolio/addon-sdk/utils",
  "@wealthfolio/ui",
  "@wealthfolio/ui/chart",
  "date-fns",
  "lucide-react",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "recharts",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    // Browser floor of the Wealthfolio 3.7+ system WebView
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    lib: {
      entry: "src/addon.tsx",
      fileName: () => "addon.js",
      formats: ["es"],
    },
    rollupOptions: {
      external: hostProvidedDependencies,
      output: {
        inlineDynamicImports: true, // Bundle all chunks into single file for addon
      },
    },
    outDir: "dist",
    minify: false,
    sourcemap: true,
  },
});
