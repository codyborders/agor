// src/provider-metadata.ts

/**
 * Built-in Pi provider metadata.
 *
 * pi-ai ships a fixed list of providers in its generated model registry.
 * This module centralizes the mapping from provider id → display label and
 * help URL so the UI never needs to duplicate pi-ai's catalog. If pi-ai adds
 * a new built-in provider, update BUILT_IN_PROVIDER_IDS here (not in the UI).
 */

/** Provider ids baked into pi-ai's `models.generated.js`. */
export const BUILT_IN_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'azure',
  'bedrock',
  'mistral',
  'groq',
  'cerebras',
  'deepseek',
  'xai',
  'openrouter',
  'vercel',
  'together',
  'fireworks',
  'replicate',
  'minimax',
  'minimax-cn',
  'zai',
  'baseten',
  'novita',
  'qwen',
]);

/** URL where a user can obtain an API key. */
export const PROVIDER_HELP_URLS: Readonly<Record<string, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
  minimax: 'https://www.minimax.io/platform/user-center/basic-information/interface-key',
  'minimax-cn': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  zai: 'https://z.ai/manage-apikey/apikey-list',
  mistral: 'https://console.mistral.ai/api-keys',
  groq: 'https://console.groq.com/keys',
  cerebras: 'https://cloud.cerebras.ai',
  deepseek: 'https://platform.deepseek.com/api_keys',
  xai: 'https://console.x.ai',
  openrouter: 'https://openrouter.ai/keys',
  together: 'https://api.together.xyz/settings/api-keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
};

/** Curated display labels for brands whose id title-casing looks wrong. */
export const PROVIDER_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  zai: 'Z.ai',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  xai: 'xAI',
  openrouter: 'OpenRouter',
};

export function isBuiltInProvider(providerId: string): boolean {
  return BUILT_IN_PROVIDER_IDS.has(providerId);
}

export function getProviderHelpUrl(providerId: string): string | undefined {
  return PROVIDER_HELP_URLS[providerId];
}

export function getProviderDisplayLabel(providerId: string): string | undefined {
  return PROVIDER_DISPLAY_LABELS[providerId];
}
