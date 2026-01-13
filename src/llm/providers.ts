/**
 * LLM Provider configurations
 */

import type { Provider } from '../types.js';

export interface ProviderConfig {
  name: string;
  envVar: string;
  defaultModel: string;
  models: string[];
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  groq: {
    name: 'Groq',
    envVar: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
  },
  openai: {
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  anthropic: {
    name: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  },
  together: {
    name: 'Together AI',
    envVar: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
    models: [
      'meta-llama/Llama-3-70b-chat-hf',
      'meta-llama/Llama-3-8b-chat-hf',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ],
  },
  fireworks: {
    name: 'Fireworks AI',
    envVar: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/llama-v3-70b-instruct',
    models: [
      'accounts/fireworks/models/llama-v3-70b-instruct',
      'accounts/fireworks/models/mixtral-8x7b-instruct',
    ],
  },
  ollama: {
    name: 'Ollama (Local)',
    envVar: 'OLLAMA_API_KEY', // Not required but kept for consistency
    defaultModel: 'llama3',
    models: ['llama3', 'llama2', 'mistral', 'codellama'],
  },
  portkey: {
    name: 'Portkey (Nebius/Multi-provider)',
    envVar: 'PORTKEY_API_KEY',
    defaultModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-Coder-7B-Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'meta-llama/Llama-3.3-70B-Instruct',
    ],
  },
  cloudflare: {
    name: 'Cloudflare Workers AI',
    envVar: 'CLOUDFLARE_API_TOKEN',
    defaultModel: '@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq',
    models: [
      '@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.1-70b-instruct',
      '@cf/qwen/qwen1.5-14b-chat-awq',
      '@cf/mistral/mistral-7b-instruct-v0.2',
    ],
  },
};

/**
 * Detect provider from model name
 */
export function detectProvider(model: string): Provider {
  const modelLower = model.toLowerCase();

  if (modelLower.startsWith('gpt-')) return 'openai';
  if (modelLower.startsWith('claude-')) return 'anthropic';
  if (modelLower.startsWith('@cf/')) return 'cloudflare';
  if (modelLower.includes('llama') || modelLower.includes('mixtral') || modelLower.includes('gemma')) {
    return 'groq';
  }
  if (modelLower.startsWith('meta-llama/') || modelLower.startsWith('mistralai/')) {
    return 'together';
  }
  if (modelLower.startsWith('accounts/fireworks/')) return 'fireworks';

  // Default to groq for unknown models
  return 'groq';
}

/**
 * Get API key for a provider from environment
 * Checks provider-specific env var first, then falls back to ROHAN_API_KEY
 */
export function getApiKey(provider: Provider): string | undefined {
  const config = PROVIDERS[provider];
  // First check provider-specific env var (e.g., GROQ_API_KEY)
  // Then fall back to generic ROHAN_API_KEY
  return process.env[config.envVar] ?? process.env.ROHAN_API_KEY;
}

/**
 * Check if provider has a valid API key configured
 */
export function hasApiKey(provider: Provider): boolean {
  if (provider === 'ollama') return true; // Ollama doesn't need API key
  if (provider === 'cloudflare') {
    // Cloudflare needs both API token and account ID
    return !!getApiKey(provider) && !!process.env.CLOUDFLARE_ACCOUNT_ID;
  }
  return !!getApiKey(provider);
}

/**
 * Get provider configuration
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  return PROVIDERS[provider];
}

/**
 * List all available providers
 */
export function listProviders(): Provider[] {
  return Object.keys(PROVIDERS) as Provider[];
}
