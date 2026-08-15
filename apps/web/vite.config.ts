import http from "node:http";
import net from "node:net";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PreviewServer, type ViteDevServer } from "vite";
import {
  resolveNovncTarget,
  safeProxyHeaders,
  safeProxyResponseHeaders,
} from "./src/screen-proxy.js";

const webPort = Number(process.env.WEB_PORT ?? 5173);

function resolveScreenSecret(env: Record<string, string | undefined>): string {
  const value = env.BETTER_AUTH_SECRET;
  if (value && value !== "dev-secret-change-me-please-32chars") return value;
  return value || "dev-secret-change-me-please-32chars";
}

function attachNovncProxy(server: ViteDevServer | PreviewServer, secret: string) {
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/novnc/")) {
      next();
      return;
    }
    const target = resolveNovncTarget(req.url, secret);
    if (!target) {
      res.statusCode = 403;
      res.end("Invalid or expired screen capability");
      return;
    }
    const headers = {
      ...safeProxyHeaders(req.headers),
      host: `${target.hostname}:${target.port}`,
    };
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: req.method,
        headers,
      },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, {
          ...safeProxyResponseHeaders(incoming.headers),
          "access-control-allow-origin": "*",
        });
        incoming.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.statusCode = 502;
      res.end(error.message);
    });
    req.pipe(upstream);
  });

  server.httpServer?.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/novnc/")) return;
    const target = resolveNovncTarget(req.url, secret);
    if (!target) {
      socket.destroy();
      return;
    }
    const upstream = net.connect(target.port, target.hostname, () => {
      const headers = safeProxyHeaders(req.headers);
      const lines = [`${req.method ?? "GET"} ${target.path} HTTP/1.1`];
      for (const [key, val] of Object.entries(headers)) {
        if (val != null) {
          const value = Array.isArray(val) ? val.join(", ") : String(val);
          lines.push(`${key.toLowerCase() === "host" ? "Host" : key}: ${value}`);
        }
      }
      lines.push("", "");
      upstream.write(lines.join("\r\n"));
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => {
      socket.destroy();
    });
    socket.on("error", () => {
      upstream.destroy();
    });
  });
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const api = process.env.API_PROXY_TARGET ?? rootEnv.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
  const screenProxySecret = resolveScreenSecret({
    ...process.env,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? rootEnv.BETTER_AUTH_SECRET,
  });
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "cowork-novnc-proxy",
        configureServer: (server) => attachNovncProxy(server, screenProxySecret),
        configurePreviewServer: (server) => attachNovncProxy(server, screenProxySecret),
      },
    ],
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": { target: api, changeOrigin: true },
        "/rpc": { target: api, changeOrigin: true },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": { target: api, changeOrigin: true },
        "/rpc": { target: api, changeOrigin: true },
      },
    },
  };
});
