/**
 * LLM Client wrapper using Vercel AI SDK
 * Supports multiple providers with unified interface
 */

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Provider, LLMOptions } from '../types.js';
import { detectProvider, getApiKey, PROVIDERS } from './providers.js';

/**
 * Create a provider-specific model instance
 */
function createModel(options: LLMOptions) {
  const { provider, model, apiBase } = options;

  switch (provider) {
    case 'groq': {
      const groq = createGroq({
        apiKey: getApiKey('groq'),
      });
      return groq(model);
    }

    case 'openai': {
      const openai = createOpenAI({
        apiKey: getApiKey('openai'),
        baseURL: apiBase,
      });
      return openai(model);
    }

    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: getApiKey('anthropic'),
      });
      return anthropic(model);
    }

    case 'together': {
      // Together uses OpenAI-compatible API
      const together = createOpenAI({
        apiKey: getApiKey('together'),
        baseURL: apiBase ?? 'https://api.together.xyz/v1',
      });
      return together(model);
    }

    case 'fireworks': {
      // Fireworks uses OpenAI-compatible API
      const fireworks = createOpenAI({
        apiKey: getApiKey('fireworks'),
        baseURL: apiBase ?? 'https://api.fireworks.ai/inference/v1',
      });
      return fireworks(model);
    }

    case 'ollama': {
      // Ollama uses OpenAI-compatible API
      const ollama = createOpenAI({
        apiKey: 'ollama', // Required but ignored
        baseURL: apiBase ?? 'http://localhost:11434/v1',
      });
      return ollama(model);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * LLM Client for generating text
 */
export class LLMClient {
  private provider: Provider;
  private model: string;
  private apiBase?: string;

  constructor(options: Partial<LLMOptions> = {}) {
    this.model = options.model ?? PROVIDERS.groq.defaultModel;
    this.provider = options.provider ?? detectProvider(this.model);
    this.apiBase = options.apiBase;
  }

  /**
   * Generate text using the LLM
   */
  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const modelInstance = createModel({
      provider: this.provider,
      model: this.model,
      apiBase: this.apiBase,
    });

    const { text } = await generateText({
      model: modelInstance,
      system: systemPrompt,
      prompt: userPrompt,
    });

    return text;
  }

  /**
   * Generate with retry logic
   */
  async generateWithRetry(
    systemPrompt: string,
    userPrompt: string,
    maxRetries = 3,
    delayMs = 1000,
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.generate(systemPrompt, userPrompt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
      }
    }

    throw lastError ?? new Error('Generation failed after retries');
  }

  /**
   * Get current provider name
   */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * Get current model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get provider display info
   */
  getInfo(): string {
    const providerName = PROVIDERS[this.provider].name;
    return `${providerName} (${this.model})`;
  }
}

/**
 * Create an LLM client with options from CLI
 */
export function createLLMClient(options: {
  model?: string;
  provider?: string;
  apiBase?: string;
}): LLMClient {
  return new LLMClient({
    model: options.model,
    provider: options.provider as Provider | undefined,
    apiBase: options.apiBase,
  });
}
