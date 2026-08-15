import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  resolveNovncTarget,
  safeProxyHeaders,
  safeProxyResponseHeaders,
  stripSensitiveHandshakeHeaders,
} from "./screen-proxy.js";

function signedPath(
  port: number,
  expiresAt: number,
  secret: string,
  rest = "/embed.html",
  hostname = "127.0.0.1",
) {
  const signature = createHmac("sha256", secret)
    .update(`${hostname}:${port}:${expiresAt}`)
    .digest("base64url");
  const target = Buffer.from(hostname).toString("base64url");
  return `/novnc/${target}/${port}/${expiresAt}.${signature}${rest}`;
}

describe("noVNC proxy authorization", () => {
  it("accepts signed, unexpired loopback targets", () => {
    expect(resolveNovncTarget(signedPath(49152, 2_000, "secret"), "secret", 1_000)).toEqual({
      hostname: "127.0.0.1",
      port: 49152,
      path: "/embed.html",
    });
  });

  it("rejects arbitrary ports, bad signatures, and expired capabilities", () => {
    expect(resolveNovncTarget("/novnc/5432/index.html", "secret", 1_000)).toBeNull();
    expect(resolveNovncTarget(signedPath(49152, 2_000, "wrong"), "secret", 1_000)).toBeNull();
    expect(resolveNovncTarget(signedPath(49152, 999, "secret"), "secret", 1_000)).toBeNull();
  });

  it("does not forward application credentials", () => {
    expect(
      safeProxyHeaders({
        host: "app.example",
        cookie: "session=secret",
        authorization: "Bearer secret",
        "proxy-authorization": "Basic secret",
        upgrade: "websocket",
        "sec-websocket-key": "key",
      }),
    ).toEqual({ upgrade: "websocket", "sec-websocket-key": "key" });
  });

  it("does not accept cookie or site-data mutations from a bot computer", () => {
    expect(
      safeProxyResponseHeaders({
        "content-type": "text/html",
        "set-cookie": ["session=attacker"],
        "clear-site-data": '"cookies"',
      }),
    ).toEqual({ "content-type": "text/html" });

    const handshake = Buffer.from(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nSet-Cookie: session=attacker\r\n\r\nframe",
      "latin1",
    );
    expect(stripSensitiveHandshakeHeaders(handshake)?.toString("latin1")).toBe(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\nframe",
    );
  });
});
