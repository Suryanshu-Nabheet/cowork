import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { DEVICE_CODE_PROVIDERS, DEVICE_CODE_SIGN_IN, isDeviceCodeProvider } from "./pi-oauth.js";

export type PiCatalogAuth = "api-key" | "oauth" | "both";
export type PiCatalogSignIn = typeof DEVICE_CODE_SIGN_IN;

export type PiCatalogEntry = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  billing: string;
  auth: PiCatalogAuth;
  oauthLabel?: string;
  subscription: boolean;
  signIn?: PiCatalogSignIn;
};

export function listPiCatalog(): PiCatalogEntry[] {
  cachedCatalog ??= buildPiCatalog();
  return cachedCatalog;
}

let cachedCatalog: PiCatalogEntry[] | undefined;

const OLLAMA_DEFAULT_MODELS = [
  { id: "llama3.3", label: "Llama 3.3 (70B/8B)" },
  { id: "llama3.2", label: "Llama 3.2 (3B/1B)" },
  { id: "deepseek-r1", label: "DeepSeek R1 (Reasoning)" },
  { id: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
  { id: "mistral", label: "Mistral 7B" },
  { id: "phi4", label: "Phi 4 (14B)" },
  { id: "gemma2", label: "Gemma 2 (9B/27B)" },
];

function buildPiCatalog(): PiCatalogEntry[] {
  const models = builtinModels();
  const entries: PiCatalogEntry[] = [];

  // Add Local Ollama models to catalog
  for (const m of OLLAMA_DEFAULT_MODELS) {
    entries.push({
      provider: "ollama",
      providerName: "Ollama (Local)",
      id: m.id,
      label: m.label,
      billing: "Free local offline inference on your hardware.",
      auth: "api-key",
      subscription: false,
    });
  }

  for (const provider of models.getProviders()) {
    const apiKey = Boolean(provider.auth.apiKey);
    const oauth = Boolean(provider.auth.oauth);
    const auth: PiCatalogAuth = apiKey && oauth ? "both" : oauth ? "oauth" : "api-key";
    const device = DEVICE_CODE_PROVIDERS[provider.id];
    const oauthLabel =
      device?.loginLabel ?? provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name;
    const subscription = Boolean(provider.auth.oauth?.isSubscription);
    const signIn = isDeviceCodeProvider(provider.id) ? DEVICE_CODE_SIGN_IN : undefined;
    const billing = catalogBilling(provider.id, provider.name, {
      apiKey,
      oauth,
    });
    for (const model of provider.getModels()) {
      entries.push({
        provider: provider.id,
        providerName: provider.name,
        id: model.id,
        label: model.name || model.id,
        billing,
        auth,
        oauthLabel,
        subscription,
        signIn,
      });
    }
  }
  return entries;
}

function catalogBilling(
  providerId: string,
  name: string,
  opts: { apiKey: boolean; oauth: boolean },
) {
  const device = DEVICE_CODE_PROVIDERS[providerId];
  if (device) return device.billing;
  if (opts.oauth && !opts.apiKey) {
    return `${name} subscription login is not in the CoWork UI yet. Skip if this deployment already has credentials.`;
  }
  if (opts.apiKey) {
    return `Uses your ${name} API key. CoWork does not pay for model usage.`;
  }
  return `Uses your ${name} key. CoWork does not pay for model usage.`;
}

export const scriptedCatalogEntry: PiCatalogEntry = {
  provider: "scripted",
  providerName: "Scripted",
  id: "scripted",
  label: "Scripted runtime (local verification)",
  billing: "No model charges. Deterministic fixture for tests.",
  auth: "api-key",
  subscription: false,
};
