import * as SecureStore from "expo-secure-store";
import { defaultApiBase, type EndpointResult, normalizeApiBase } from "./endpoint";
import {
  clearSessionToken,
  loadSessionToken,
  saveSessionToken,
  tokenFromAuthResponse,
} from "./session";
import type { ThreadEvent } from "./thread-events";

const ENDPOINT_KEY = "cowork.api_base";

let cachedApiBase: string | undefined;

export function currentApiBase() {
  return cachedApiBase ?? defaultApiBase();
}

export function isCustomApiBase() {
  return currentApiBase() !== defaultApiBase();
}

export async function loadApiBase() {
  try {
    const stored = await SecureStore.getItemAsync(ENDPOINT_KEY);
    if (stored) {
      const parsed = normalizeApiBase(stored);
      if (parsed.ok) {
        cachedApiBase = parsed.url;
        return cachedApiBase;
      }
    }
  } catch {
    // SecureStore is unavailable in some test / web hosts.
  }
  cachedApiBase = defaultApiBase();
  return cachedApiBase;
}

export async function saveApiBase(input: string): Promise<EndpointResult> {
  const parsed = normalizeApiBase(input);
  if (!parsed.ok) return parsed;
  if (parsed.url === defaultApiBase()) return resetApiBase();
  const previous = currentApiBase();
  await SecureStore.setItemAsync(ENDPOINT_KEY, parsed.url);
  cachedApiBase = parsed.url;
  if (parsed.url !== previous) await clearSessionToken();
  return parsed;
}

export async function resetApiBase(): Promise<EndpointResult> {
  const previous = currentApiBase();
  try {
    await SecureStore.deleteItemAsync(ENDPOINT_KEY);
  } catch {
    // ignore missing keys
  }
  const url = defaultApiBase();
  cachedApiBase = url;
  if (url !== previous) await clearSessionToken();
  return { ok: true, url };
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await loadSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function signIn(email: string, password: string) {
  const res = await fetch(`${currentApiBase()}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "cowork://" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: string }).message ?? "Could not sign in")
        : "Could not sign in";
    throw new Error(message);
  }
  const token = tokenFromAuthResponse(res, body);
  if (!token) throw new Error("Sign-in did not return a session");
  await saveSessionToken(token);
}

export async function signUp(name: string, email: string, password: string) {
  const res = await fetch(`${currentApiBase()}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "cowork://" },
    body: JSON.stringify({ name, email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: string }).message ?? "Could not create account")
        : "Could not create account";
    throw new Error(message);
  }
  const token = tokenFromAuthResponse(res, body);
  if (!token) throw new Error("Sign-up did not return a session");
  await saveSessionToken(token);
}

export async function signOut() {
  const headers = await authHeaders();
  await fetch(`${currentApiBase()}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "cowork://", ...headers },
  }).catch(() => undefined);
  await clearSessionToken();
}

export async function rpc<T>(proc: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${currentApiBase()}/rpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "cowork://",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ json: body }),
  });
  const parsed = (await res.json()) as { json?: T; error?: { message?: string } };
  if (!res.ok || parsed.error) throw new Error(parsed.error?.message ?? `rpc ${proc} failed`);
  return parsed.json as T;
}

export type MobileBot = {
  id: string;
  name: string;
  preview: string;
  title: string;
  color: string;
  updatedAt: string;
  parentBotId?: string | null;
};

export type MobileMe = {
  name: string;
  email: string;
};

export type { MobileMessage, MobileSnapshot, ThreadEvent } from "./thread-events";
export { applyMobileThreadEvent, blockText } from "./thread-events";

export async function subscribeThread(
  botId: string,
  cursor: number,
  onEvent: (event: ThreadEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${currentApiBase()}/rpc/threads/subscribe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      origin: "cowork://",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ json: { botId, cursor } }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`rpc threads/subscribe failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { json?: ThreadEvent; error?: { message?: string } };
        if (parsed.json?.type) onEvent(parsed.json);
      } catch {
        // ignore keepalives and partial frames
      }
    }
  }
}

export {
  apiBaseWarning,
  defaultApiBase,
  displayApiHost,
  normalizeApiBase,
  probeApiBase,
} from "./endpoint";
export { loadSessionToken };
