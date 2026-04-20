/**
 * Presets for Pi custom providers.
 *
 * Each preset seeds the "Add provider" form with known-good defaults for a
 * local inference server or OpenAI-compatible proxy. Users still pick their
 * own model ids (e.g. whatever llama-server's `-a` alias exposes) and can
 * tune compat flags per model.
 */

export type PiProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export interface PiModelDraft {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  compat?: PiProviderCompat;
}

export interface PiProviderCompat {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  thinkingFormat?: 'openai' | 'zai' | 'qwen' | 'qwen-chat-template';
}

export interface PiProviderDraft {
  id: string;
  baseUrl?: string;
  api?: PiProviderApi;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: PiProviderCompat;
  models?: PiModelDraft[];
}

export interface PiProviderPreset {
  key: string;
  title: string;
  description: string;
  docsUrl?: string;
  draft: PiProviderDraft;
}

// Shared compat shape for OpenAI-compatible local servers that usually don't
// implement the developer role, reasoning_effort, or stream usage.
const localOpenAiCompat: PiProviderCompat = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: 'max_tokens',
};

export const PI_PROVIDER_PRESETS: PiProviderPreset[] = [
  {
    key: 'llama-cpp',
    title: 'llama.cpp server',
    description:
      'OpenAI-compatible endpoint exposed by `llama-server` (part of llama.cpp). Add one model entry per loaded GGUF, matching the `-a` alias or the internal model id.',
    docsUrl: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
    draft: {
      id: 'llama-cpp',
      baseUrl: 'http://localhost:8080/v1',
      api: 'openai-completions',
      apiKey: 'not-needed',
      compat: localOpenAiCompat,
      models: [],
    },
  },
  {
    key: 'ollama',
    title: 'Ollama',
    description:
      'Local Ollama server on port 11434. Declare one model entry per `ollama pull`-ed model.',
    docsUrl: 'https://ollama.com',
    draft: {
      id: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama',
      compat: localOpenAiCompat,
      models: [],
    },
  },
  {
    key: 'lm-studio',
    title: 'LM Studio',
    description:
      'LM Studio local server on port 1234. Declare one model per loaded checkpoint.',
    docsUrl: 'https://lmstudio.ai',
    draft: {
      id: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      api: 'openai-completions',
      apiKey: 'lm-studio',
      compat: localOpenAiCompat,
      models: [],
    },
  },
  {
    key: 'vllm',
    title: 'vLLM',
    description:
      'Local vLLM server on port 8000. Declare one model per `--model` path you served.',
    docsUrl: 'https://docs.vllm.ai',
    draft: {
      id: 'vllm',
      baseUrl: 'http://localhost:8000/v1',
      api: 'openai-completions',
      apiKey: 'vllm',
      compat: localOpenAiCompat,
      models: [],
    },
  },
  {
    key: 'custom-proxy',
    title: 'Custom OpenAI-compatible proxy',
    description:
      'Blank form for any OpenAI-compatible endpoint (corporate gateway, OpenRouter-style proxy, etc.).',
    draft: {
      id: '',
      api: 'openai-completions',
      models: [],
    },
  },
];
