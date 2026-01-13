/**
 * Prompt template loading and rendering
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, fileExists } from '../utils/files.js';

// Get the directory of this file for resolving default prompts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From dist/src/generator/ we need to go up 3 levels to reach the root prompts/ folder
const DEFAULT_PROMPTS_DIR = path.resolve(__dirname, '../../../prompts');

/**
 * Prompt template names
 */
export type PromptName =
  | 'planner_system'
  | 'planner_user'
  | 'builder_system'
  | 'builder_user'
  | 'planner_batch_system'
  | 'planner_batch_user'
  | 'builder_batch_system'
  | 'builder_batch_user'
  | 'e2e_planner_system'
  | 'e2e_planner_user'
  | 'e2e_builder_system'
  | 'e2e_builder_user'
  // Agent prompts
  | 'agent_validator_system'
  | 'agent_validator_user'
  | 'agent_analyzer_system'
  | 'agent_analyzer_user'
  | 'smart_planner_system'
  | 'smart_planner_user';

/**
 * Prompt loader that supports custom prompt directories
 */
export class PromptLoader {
  private cache: Map<string, string> = new Map();

  constructor(private customDir?: string) {}

  /**
   * Load a prompt by name
   * First checks custom directory, then falls back to default prompts
   */
  async load(name: PromptName): Promise<string> {
    // Check cache first
    const cacheKey = `${this.customDir ?? 'default'}:${name}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const filename = `${name}.md`;
    let content: string;

    // Try custom directory first
    if (this.customDir) {
      const customPath = path.join(this.customDir, filename);
      if (await fileExists(customPath)) {
        content = await readFile(customPath);
        this.cache.set(cacheKey, content);
        return content;
      }
    }

    // Fall back to default prompts
    const defaultPath = path.join(DEFAULT_PROMPTS_DIR, filename);
    try {
      content = await readFile(defaultPath);
    } catch {
      throw new Error(`Prompt not found: ${name} (looked in ${defaultPath})`);
    }

    this.cache.set(cacheKey, content);
    return content;
  }

  /**
   * Load planner prompts
   */
  async loadPlannerPrompts(batch: boolean, e2e: boolean): Promise<{ system: string; user: string }> {
    if (e2e) {
      return {
        system: await this.load('e2e_planner_system'),
        user: await this.load('e2e_planner_user'),
      };
    }
    if (batch) {
      return {
        system: await this.load('planner_batch_system'),
        user: await this.load('planner_batch_user'),
      };
    }
    return {
      system: await this.load('planner_system'),
      user: await this.load('planner_user'),
    };
  }

  /**
   * Load builder prompts
   */
  async loadBuilderPrompts(batch: boolean, e2e: boolean): Promise<{ system: string; user: string }> {
    if (e2e) {
      return {
        system: await this.load('e2e_builder_system'),
        user: await this.load('e2e_builder_user'),
      };
    }
    if (batch) {
      return {
        system: await this.load('builder_batch_system'),
        user: await this.load('builder_batch_user'),
      };
    }
    return {
      system: await this.load('builder_system'),
      user: await this.load('builder_user'),
    };
  }
}

/**
 * Render a template with variable substitution
 * Variables are in the format {{variable_name}}
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/**
 * Clean up LLM response to extract JSON
 */
export function cleanJsonResponse(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Clean up LLM response to extract code
 */
export function cleanCodeResponse(content: string): string {
  return content
    .trim()
    .replace(/^```javascript\s*/i, '')
    .replace(/^```js\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
