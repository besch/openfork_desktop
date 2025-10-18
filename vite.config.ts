import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import config from "./config.json";

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./", // Ensure assets are loaded correctly in Electron
  build: {
    outDir: "dist", // Output directory for production build
  },
  server: {
    port: 5173, // Must match the port in electron.cjs
    proxy: {
      "/api": {
        target: config.ORCHESTRATOR_API_URL,
        changeOrigin: true,
      },
    },
  },
});
