import { createHmac } from "node:crypto";

const SCREEN_PROXY_TTL_MS = 60 * 60_000;

export function addScreenProxyCapability(
  url: string,
  secret: string,
  proxyOrigin: string,
  now = Date.now(),
): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" || !parsed.hostname || !parsed.port) return url;
    const expiresAt = now + SCREEN_PROXY_TTL_MS;
    const target = Buffer.from(parsed.hostname).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(`${parsed.hostname}:${parsed.port}:${expiresAt}`)
      .digest("base64url");
    const origin = new URL(proxyOrigin).origin;
    return `${origin}/novnc/${target}/${parsed.port}/${expiresAt}.${signature}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
