/**
 * Plan command - Generate test plan from OpenAPI spec
 */

import type { PlanOptions } from '../types.js';
import { readFile, writeJson, resolvePath } from '../utils/files.js';
import { parseOpenAPISpec, getAPIInfo } from '../utils/openapi.js';
import { createTestPlan } from '../generator/planner.js';
import { step, success, error, section } from '../utils/progress.js';

interface PlanCommandOptions {
  output: string;
  workers: string;
  model: string;
  provider?: string;
  apiBase?: string;
  batchSize: string;
  rpm: string;
  e2e: boolean;
  verbose: boolean;
  promptDir?: string;
  smart: boolean;
  targetCoverage: string;
  analyze: boolean;
}

export async function planCommand(
  specPath: string,
  cmdOptions: PlanCommandOptions,
): Promise<void> {
  // Parse CLI options
  const options: PlanOptions = {
    output: cmdOptions.output,
    workers: parseInt(cmdOptions.workers, 10),
    model: cmdOptions.model,
    provider: cmdOptions.provider as PlanOptions['provider'],
    apiBase: cmdOptions.apiBase,
    batchSize: parseInt(cmdOptions.batchSize, 10),
    rpm: parseInt(cmdOptions.rpm, 10),
    e2e: cmdOptions.e2e,
    verbose: cmdOptions.verbose,
    promptDir: cmdOptions.promptDir,
    smart: cmdOptions.smart,
    targetCoverage: parseInt(cmdOptions.targetCoverage, 10),
    analyze: cmdOptions.analyze,
  };

  try {
    // 1. Parse OpenAPI Spec
    step('🔍', 'Parsing OpenAPI spec...');
    const fullPath = resolvePath(specPath);
    const content = await readFile(fullPath);
    const spec = parseOpenAPISpec(content);
    const info = getAPIInfo(spec);

    success(`Found API: ${info.title} (v${info.version})`);

    // 2. Generate Test Plan
    const planType = options.e2e ? 'E2E Test Plan' : 'Test Plan';
    section(`📐 Generating ${planType}...`);

    const plan = await createTestPlan(spec, specPath, options);

    // 3. Save plan to JSON file
    const outputPath = resolvePath(options.output);
    await writeJson(outputPath, plan);

    section('💾 Results');
    success(`Saved test plan to ${outputPath}`);

    if (options.e2e) {
      console.log(`   ${plan.scenarios.length} E2E scenarios for ${plan.api_title} (v${plan.api_version})`);
      console.log();
      console.log('📝 E2E Scenarios:');
      for (const [i, scenario] of plan.scenarios.slice(0, 20).entries()) {
        console.log(`  ${i + 1}. ${scenario.name} (${scenario.steps.length} steps)`);
      }
      if (plan.scenarios.length > 20) {
        console.log(`  ... and ${plan.scenarios.length - 20} more`);
      }
      console.log();
      step('✨', `Next: rohan build ${options.output} --e2e`);
    } else {
      console.log(`   ${plan.tests.length} test entries for ${plan.api_title} (v${plan.api_version})`);
      console.log();
      console.log('📝 Test entries:');
      for (const [i, test] of plan.tests.slice(0, 20).entries()) {
        console.log(`  ${i + 1}. ${test.name} (${test.method} ${test.path})`);
      }
      if (plan.tests.length > 20) {
        console.log(`  ... and ${plan.tests.length - 20} more`);
      }
      console.log();
      step('✨', `Next: rohan build ${options.output}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Planning failed: ${message}`);
    if (cmdOptions.verbose && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}
