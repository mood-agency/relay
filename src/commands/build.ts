/**
 * Build command - Generate k6 test scripts from test plan
 */

import type { TestPlan, BuildOptions } from '../types.js';
import { readJson, resolvePath } from '../utils/files.js';
import { buildScripts } from '../generator/builder.js';
import { step, success, error, warn, section } from '../utils/progress.js';
import { validateScripts } from '../agents/validator.js';

interface BuildCommandOptions {
  output: string;
  workers: string;
  model: string;
  provider?: string;
  apiBase?: string;
  batchSize: string;
  rpm: string;
  e2e: boolean;
  overwrite: boolean;
  verbose: boolean;
  promptDir?: string;
  validate: boolean;
  maxAttempts: string;
}

export async function buildCommand(
  planPath: string,
  cmdOptions: BuildCommandOptions,
): Promise<void> {
  // Parse CLI options
  const options: BuildOptions = {
    output: cmdOptions.output,
    workers: parseInt(cmdOptions.workers, 10),
    model: cmdOptions.model,
    provider: cmdOptions.provider as BuildOptions['provider'],
    apiBase: cmdOptions.apiBase,
    batchSize: parseInt(cmdOptions.batchSize, 10),
    rpm: parseInt(cmdOptions.rpm, 10),
    e2e: cmdOptions.e2e,
    overwrite: cmdOptions.overwrite,
    verbose: cmdOptions.verbose,
    promptDir: cmdOptions.promptDir,
    validate: cmdOptions.validate,
    maxAttempts: parseInt(cmdOptions.maxAttempts, 10),
  };

  try {
    // 1. Load test plan
    step('📖', `Loading test plan from ${planPath}...`);
    const fullPath = resolvePath(planPath);
    const plan = await readJson<TestPlan>(fullPath);

    success(`Loaded plan for ${plan.api_title} (v${plan.api_version})`);

    // Check if plan mode matches CLI flag
    if (plan.e2e !== options.e2e) {
      if (plan.e2e) {
        warn('This is an E2E test plan. Add --e2e flag to build command.');
        options.e2e = true;
      } else {
        warn('This is a unit test plan. Remove --e2e flag from build command.');
        options.e2e = false;
      }
    }

    if (plan.e2e) {
      console.log(`   ${plan.scenarios.length} E2E scenarios`);
    } else {
      console.log(`   ${plan.tests.length} test entries`);
    }

    // 2. Build scripts
    section('🏗️  Building test scripts...');

    const { scripts, manifest } = await buildScripts(plan, options);

    // 3. Print summary
    section('📊 Summary');
    success(`Generated ${scripts.length} scripts`);
    console.log(`   ${manifest.length} files in manifest`);

    // 4. Validate scripts if requested
    if (options.validate && !plan.e2e) {
      console.log();
      const testEntries = plan.tests.map(t => ({
        name: t.name,
        endpoint_spec: t.endpoint_spec,
      }));
      await validateScripts(resolvePath(options.output), testEntries, options);
    }

    // 5. Print k6 run instructions
    const testsPath = options.output;

    section('🚀 Run tests with k6:');
    console.log();
    console.log('   # Run a single test:');
    console.log(`   k6 run --env BASE_URL=http://localhost:8080 ${testsPath}/test_get_message_basic.js`);
    console.log();
    console.log('   # Run all tests (bash/zsh):');
    console.log(`   for f in ${testsPath}/*.js; do k6 run --env BASE_URL=http://localhost:8080 "$f"; done`);
    console.log();
    console.log('   # Run all tests (PowerShell):');
    console.log(`   Get-ChildItem ${testsPath}\\*.js | ForEach-Object { k6 run --env BASE_URL=http://localhost:8080 $_.FullName }`);
    console.log();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Build failed: ${message}`);
    if (cmdOptions.verbose && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}
