import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import config from "./config.json";

function getOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getWebsocketOrigin(value: string) {
  const origin = getOrigin(value);
  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
    return parsed.origin;
  } catch {
    return null;
  }
}

function compactDirectives(directives: Array<string | null | false>) {
  return directives.filter(Boolean).join("; ");
}

function compactSources(sources: Array<string | null>) {
  return sources.filter((source): source is string => Boolean(source));
}

function buildRendererCsp(isDev: boolean) {
  const orchestratorOrigin = getOrigin(config.ORCHESTRATOR_API_URL);
  const supabaseOrigin = getOrigin(config.SUPABASE_URL);
  const supabaseRealtimeOrigin = getWebsocketOrigin(config.SUPABASE_URL);

  const connectSrc = compactSources([
    "'self'",
    orchestratorOrigin,
    supabaseOrigin,
    supabaseRealtimeOrigin,
    ...(isDev
      ? [
          "http://localhost:*",
          "http://127.0.0.1:*",
          "ws://localhost:*",
          "ws://127.0.0.1:*",
        ]
      : []),
  ]);

  const scriptSrc = isDev
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'"];

  return compactDirectives([
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    `media-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]);
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    {
      name: "openfork-renderer-csp",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: buildRendererCsp(command === "serve"),
            },
            injectTo: "head-prepend",
          },
        ];
      },
    },
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./", // Ensure assets are loaded correctly in Electron
  build: {
    outDir: "dist", // Output directory for production build
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          return undefined;
        },
      },
    },
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
}));
