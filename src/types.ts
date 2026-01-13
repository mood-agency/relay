/**
 * Type definitions for Rohan
 */

/**
 * Supported LLM providers
 */
export type Provider = 'groq' | 'openai' | 'anthropic' | 'together' | 'fireworks' | 'ollama' | 'cloudflare' | 'portkey';

/**
 * A single test entry in the test plan
 */
export interface TestEntry {
  name: string;
  method: string;
  path: string;
  endpoint_spec: Record<string, unknown>;
}

/**
 * An E2E test scenario with multiple steps
 */
export interface E2EScenario {
  name: string;
  steps: string[];
  description: string;
  endpoint_spec?: Record<string, unknown>;
}

/**
 * The complete test plan that can be saved to JSON
 */
export interface TestPlan {
  version: string;
  spec_path: string;
  api_title: string;
  api_version: string;
  e2e: boolean;
  tests: TestEntry[];
  scenarios: E2EScenario[];
}

/**
 * Manifest entry for generated test files
 */
export interface ManifestEntry {
  id: number;
  name: string;
  file: string;
}

/**
 * OpenAPI Info object
 */
export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

/**
 * OpenAPI Spec (simplified)
 */
export interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

/**
 * Extracted endpoint information
 */
export interface EndpointInfo {
  path: string;
  method: string;
  spec: Record<string, unknown>;
}

/**
 * Test priority levels for smart planning
 */
export type TestPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Test category for classification
 */
export type TestCategory = 'happy_path' | 'boundary' | 'negative' | 'security' | 'e2e';

/**
 * Extended test entry with smart planning metadata
 */
export interface SmartTestEntry extends TestEntry {
  priority: TestPriority;
  category: TestCategory;
  coverage_impact?: number;
}

/**
 * Workflow pattern detected by analyzer
 */
export interface WorkflowPattern {
  name: string;
  type: 'crud' | 'saga' | 'state_machine' | 'auth_flow';
  priority: TestPriority;
  endpoints: string[];
  description: string;
}

/**
 * Resource relationship detected by analyzer
 */
export interface ResourceRelationship {
  parent: string;
  child: string;
  type: 'nested' | 'reference' | 'dependency';
}

/**
 * Analysis result from analyzer agent
 */
export interface AnalysisResult {
  workflow_patterns: WorkflowPattern[];
  auth_flows: string[];
  state_machines: string[];
  resource_relationships: ResourceRelationship[];
  coverage_recommendations: string[];
}

/**
 * Coverage metrics for smart planning
 */
export interface CoverageMetrics {
  endpoint_coverage: number;
  method_coverage: number;
  status_code_coverage: number;
  parameter_coverage: number;
  tests_by_priority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Enhanced test plan with smart planning metadata
 */
export interface SmartTestPlan extends TestPlan {
  smart: boolean;
  target_coverage: number;
  coverage_metrics?: CoverageMetrics;
  analysis?: AnalysisResult;
  tests: SmartTestEntry[];
}

/**
 * Validation result for a single script
 */
export interface ValidationResult {
  test_name: string;
  filename: string;
  valid: boolean;
  error?: string;
  fixed: boolean;
  attempts: number;
}

/**
 * Validation summary report
 */
export interface ValidationReport {
  total: number;
  valid: number;
  fixed: number;
  failed: number;
  results: ValidationResult[];
}

/**
 * CLI options for plan command
 */
export interface PlanOptions {
  output: string;
  workers: number;
  model: string;
  provider?: Provider;
  apiBase?: string;
  batchSize: number;
  rpm: number;
  e2e: boolean;
  verbose: boolean;
  promptDir?: string;
  // Smart agent options
  smart: boolean;
  targetCoverage: number;
  analyze: boolean;
}

/**
 * CLI options for build command
 */
export interface BuildOptions {
  output: string;
  workers: number;
  model: string;
  provider?: Provider;
  apiBase?: string;
  batchSize: number;
  rpm: number;
  e2e: boolean;
  overwrite: boolean;
  verbose: boolean;
  promptDir?: string;
  // Validator agent options
  validate: boolean;
  maxAttempts: number;
}

/**
 * CLI options for exec command
 */
export interface ExecOptions {
  target: string;
}

/**
 * Result of planning for a single endpoint
 */
export interface PlanResult {
  method: string;
  path: string;
  endpoint_spec: Record<string, unknown>;
  test_names: string[];
  error?: string;
}

/**
 * Result of generating a single test script
 */
export interface ScriptResult {
  test_name: string;
  code: string;
  error?: string;
}

/**
 * Batched planning result
 */
export interface BatchPlanResult {
  [endpoint_id: string]: string[];
}

/**
 * Batched script result
 */
export interface BatchScriptResult {
  [test_name: string]: string;
}

/**
 * LLM generation options
 */
export interface LLMOptions {
  provider: Provider;
  model: string;
  apiBase?: string;
}
