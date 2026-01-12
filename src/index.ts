/**
 * Rohan - OpenAPI Test Generator for k6
 *
 * Public API exports for programmatic usage
 */

// Types
export type {
  Provider,
  TestPlan,
  TestEntry,
  E2EScenario,
  ManifestEntry,
  OpenAPISpec,
  OpenAPIInfo,
  EndpointInfo,
  PlanOptions,
  BuildOptions,
  LLMOptions,
} from './types.js';

// CLI
export { createCli } from './cli.js';

// LLM
export { LLMClient, createLLMClient } from './llm/client.js';
export { detectProvider, getApiKey, hasApiKey, PROVIDERS } from './llm/providers.js';

// Generator
export { createTestPlan } from './generator/planner.js';
export { buildScripts } from './generator/builder.js';
export { PromptLoader, renderTemplate, cleanJsonResponse, cleanCodeResponse } from './generator/templates.js';

// Utils
export { parseOpenAPISpec, extractEndpoints, getAPIInfo, countEndpoints } from './utils/openapi.js';
export {
  readFile,
  writeFile,
  readJson,
  writeJson,
  fileExists,
  ensureDir,
  testNameToFilename,
} from './utils/files.js';
