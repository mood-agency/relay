/**
 * Test plan generation using LLM
 */

import pLimit from 'p-limit';
import type {
  TestPlan,
  TestEntry,
  E2EScenario,
  EndpointInfo,
  OpenAPISpec,
  PlanOptions,
  BatchPlanResult,
  SmartTestPlan,
  AnalysisResult,
} from '../types.js';
import { LLMClient } from '../llm/client.js';
import { PromptLoader, renderTemplate, cleanJsonResponse } from './templates.js';
import { extractEndpoints, getAPIInfo } from '../utils/openapi.js';
import { step, success, error, warn, debug, ProgressCounter } from '../utils/progress.js';
import { analyzeSpec } from '../agents/analyzer.js';
import { smartPlan } from '../agents/smartPlanner.js';

/**
 * Create a test plan from an OpenAPI spec
 */
export async function createTestPlan(
  spec: OpenAPISpec,
  specPath: string,
  options: PlanOptions,
): Promise<TestPlan | SmartTestPlan> {
  const client = new LLMClient({
    model: options.model,
    provider: options.provider,
    apiBase: options.apiBase,
  });

  const loader = new PromptLoader(options.promptDir);
  const info = getAPIInfo(spec);

  // Run analyzer if requested (with E2E mode)
  let analysis: AnalysisResult | undefined;
  if (options.analyze && options.e2e) {
    analysis = await analyzeSpec(spec, options);
    console.log();
  }

  // Create base test plan
  const plan: TestPlan = {
    version: '1.0',
    spec_path: specPath,
    api_title: info.title,
    api_version: info.version,
    e2e: options.e2e,
    tests: [],
    scenarios: [],
  };

  step('🤖', `Using LLM: ${client.getInfo()}`);

  if (options.e2e) {
    // E2E mode: analyze full spec for workflow patterns
    return createE2ETestPlan(spec, plan, client, loader, options, analysis);
  }

  // Standard mode: generate tests per endpoint
  const endpoints = extractEndpoints(spec);
  const endpointCount = endpoints.length;

  step('📋', `Found ${endpointCount} endpoints to process`);

  if (options.batchSize > 1) {
    step('📦', `Batching: ${options.batchSize} endpoints per request`);
  }

  step('👷', `Using ${options.workers} parallel workers`);

  if (options.rpm > 0) {
    step('⏱️', `Rate limit: ${options.rpm} requests/minute`);
  }

  console.log();

  // Log endpoints being processed
  for (const ep of endpoints) {
    console.log(`   • ${ep.method} ${ep.path}`);
  }
  console.log();

  // Process endpoints
  const useBatching = options.batchSize > 1;

  if (useBatching) {
    plan.tests = await processEndpointsBatched(
      endpoints,
      client,
      loader,
      options,
    );
  } else {
    plan.tests = await processEndpointsIndividual(
      endpoints,
      client,
      loader,
      options,
    );
  }

  success(`Generated ${plan.tests.length} test entries`);

  // Apply smart planning if requested
  if (options.smart) {
    console.log();
    const smartResult = await smartPlan(plan.tests, spec, analysis, options);

    const smartTestPlan: SmartTestPlan = {
      ...plan,
      smart: true,
      target_coverage: options.targetCoverage,
      coverage_metrics: smartResult.coverage_metrics,
      analysis: analysis,
      tests: smartResult.tests,
    };

    return smartTestPlan;
  }

  return plan;
}

/**
 * Process endpoints individually (one LLM call per endpoint)
 */
async function processEndpointsIndividual(
  endpoints: EndpointInfo[],
  client: LLMClient,
  loader: PromptLoader,
  options: PlanOptions,
): Promise<TestEntry[]> {
  const prompts = await loader.loadPlannerPrompts(false, false);
  const limit = pLimit(options.workers);

  // Rate limiter
  const rpmDelay = options.rpm > 0 ? 60000 / options.rpm : 0;
  let lastRequestTime = 0;

  const progress = new ProgressCounter(endpoints.length, 'Planning');

  const tasks = endpoints.map(endpoint =>
    limit(async () => {
      // Rate limiting
      if (rpmDelay > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < rpmDelay) {
          await new Promise(resolve => setTimeout(resolve, rpmDelay - timeSinceLastRequest));
        }
        lastRequestTime = Date.now();
      }

      const endpointSpec = JSON.stringify(endpoint.spec, null, 2);
      const userPrompt = renderTemplate(prompts.user, { spec: endpointSpec });

      try {
        const response = await client.generateWithRetry(prompts.system, userPrompt);
        const cleanJson = cleanJsonResponse(response);
        const testNames: string[] = JSON.parse(cleanJson);

        debug(`${endpoint.method} ${endpoint.path} -> ${testNames.length} tests`, options.verbose);
        progress.increment();

        return testNames.map(name => ({
          name,
          method: endpoint.method,
          path: endpoint.path,
          endpoint_spec: endpoint.spec,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warn(`${endpoint.method} ${endpoint.path} - Error: ${message}`);
        progress.increment();
        return [];
      }
    }),
  );

  const results = await Promise.all(tasks);
  progress.succeed(`Planned ${endpoints.length} endpoints`);

  return results.flat();
}

/**
 * Process endpoints in batches (multiple endpoints per LLM call)
 */
async function processEndpointsBatched(
  endpoints: EndpointInfo[],
  client: LLMClient,
  loader: PromptLoader,
  options: PlanOptions,
): Promise<TestEntry[]> {
  const prompts = await loader.loadPlannerPrompts(true, false);
  const limit = pLimit(options.workers);

  // Create batches
  const batches: { id: string; endpoint: EndpointInfo }[][] = [];
  for (let i = 0; i < endpoints.length; i += options.batchSize) {
    const batch = endpoints.slice(i, i + options.batchSize).map((ep, idx) => ({
      id: `endpoint_${i + idx}`,
      endpoint: ep,
    }));
    batches.push(batch);
  }

  const progress = new ProgressCounter(batches.length, 'Planning batches');

  // Rate limiter
  const rpmDelay = options.rpm > 0 ? 60000 / options.rpm : 0;
  let lastRequestTime = 0;

  const tasks = batches.map((batch, batchIndex) =>
    limit(async () => {
      // Rate limiting
      if (rpmDelay > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < rpmDelay) {
          await new Promise(resolve => setTimeout(resolve, rpmDelay - timeSinceLastRequest));
        }
        lastRequestTime = Date.now();
      }

      const endpointsJson = batch.map(({ id, endpoint }) => ({
        endpoint_id: id,
        method: endpoint.method,
        path: endpoint.path,
        spec: endpoint.spec,
      }));

      const userPrompt = renderTemplate(prompts.user, {
        endpoints: JSON.stringify(endpointsJson, null, 2),
      });

      try {
        const response = await client.generateWithRetry(prompts.system, userPrompt);
        const cleanJson = cleanJsonResponse(response);
        const results: BatchPlanResult = JSON.parse(cleanJson);

        const entries: TestEntry[] = [];
        for (const { id, endpoint } of batch) {
          const testNames = results[id];
          if (testNames && Array.isArray(testNames)) {
            for (const name of testNames) {
              entries.push({
                name,
                method: endpoint.method,
                path: endpoint.path,
                endpoint_spec: endpoint.spec,
              });
            }
            success(`${endpoint.method} ${endpoint.path} - ${testNames.length} tests`);
          } else {
            warn(`${endpoint.method} ${endpoint.path} - Missing from batch response`);
          }
        }

        progress.increment();
        return entries;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        error(`Batch ${batchIndex + 1} failed: ${message}`);
        for (const { endpoint } of batch) {
          console.log(`   • ${endpoint.method} ${endpoint.path}`);
        }
        progress.increment();
        return [];
      }
    }),
  );

  const results = await Promise.all(tasks);
  progress.succeed(`Planned ${batches.length} batches`);

  return results.flat();
}

/**
 * Create E2E test plan by analyzing the full spec
 */
async function createE2ETestPlan(
  spec: OpenAPISpec,
  plan: TestPlan,
  client: LLMClient,
  loader: PromptLoader,
  _options: PlanOptions,
  analysis?: AnalysisResult,
): Promise<TestPlan> {
  step('🔗', 'E2E Mode: Analyzing full API spec for workflow patterns...');

  const prompts = await loader.loadPlannerPrompts(false, true);
  const specString = JSON.stringify(spec, null, 2);

  // Include analysis in the prompt if available
  const analysisContext = analysis
    ? `\n\n## Analysis Context\n${JSON.stringify(analysis, null, 2)}`
    : '';

  const userPrompt = renderTemplate(prompts.user, { spec: specString + analysisContext });

  try {
    const response = await client.generateWithRetry(prompts.system, userPrompt);
    const cleanJson = cleanJsonResponse(response);
    const scenarios: E2EScenario[] = JSON.parse(cleanJson);

    // Attach full spec to each scenario for builder phase
    plan.scenarios = scenarios.map(scenario => ({
      ...scenario,
      endpoint_spec: spec as unknown as Record<string, unknown>,
    }));

    console.log();
    success(`Generated ${plan.scenarios.length} E2E workflow scenarios`);
    for (const scenario of plan.scenarios) {
      console.log(`   • ${scenario.name} (${scenario.steps.length} steps)`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`E2E planning failed: ${message}`);
    throw err;
  }

  return plan;
}
