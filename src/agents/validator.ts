/**
 * Validator Agent - Validates k6 scripts and auto-fixes errors using agentic tool use
 *
 * This agent uses Vercel AI SDK's tool use capability to autonomously:
 * 1. Read the script
 * 2. Validate it with k6 dry-run
 * 3. If errors, fix the code and write it back
 * 4. Repeat until valid or max steps reached
 */

import { LLMClient } from '../llm/client.js';
import { validateK6Script, readScript, writeScript } from './tools/k6Tools.js';
import { step, success, warn } from '../utils/progress.js';
import type { ValidationResult, ValidationReport, BuildOptions } from '../types.js';

/**
 * System prompt for the validator agent
 */
const VALIDATOR_SYSTEM_PROMPT = `You are a k6 script validator and fixer agent. Your task is to validate and fix k6 test scripts.

## Workflow
1. First, read the script content using the readScript tool
2. Validate the script using validateK6Script tool
3. If the script is valid, report success
4. If invalid, analyze the error message, fix the code, and use writeScript to save the fix
5. After writing a fix, validate again to confirm it works
6. Repeat until the script is valid or you've tried multiple fixes

## Common k6 Errors and Fixes
- Missing imports: Add \`import http from 'k6/http';\` and \`import { check } from 'k6';\`
- Syntax errors: Fix JavaScript syntax (missing brackets, semicolons, template literals)
- Undefined variables: Ensure all variables are declared before use
- Wrong Content-Type: Use \`{ headers: { 'Content-Type': 'application/json' } }\` for JSON bodies
- JSON body: Use \`JSON.stringify(body)\` for request body

## Important Rules
- Always read the script first to see current state
- After fixing, always validate again
- Keep the test intent intact - don't change what the test is testing
- If you cannot fix the error after several attempts, report failure`;

/**
 * Validate and fix a single script using agentic tool use
 */
async function validateAndFixScriptAgentic(
  client: LLMClient,
  scriptPath: string,
  testName: string,
  endpointSpec: Record<string, unknown>,
  maxSteps: number,
  verbose: boolean,
): Promise<ValidationResult> {
  const filename = scriptPath.split(/[\\/]/).pop() || scriptPath;

  try {
    const result = await client.generateWithTools({
      system: VALIDATOR_SYSTEM_PROMPT,
      prompt: `Validate and fix the k6 script at: ${scriptPath}

Test Name: ${testName}
Endpoint Spec: ${JSON.stringify(endpointSpec, null, 2)}

Start by reading the script, then validate it. If there are errors, fix them.`,
      tools: {
        validateK6Script,
        readScript,
        writeScript,
      },
      maxSteps,
    });

    // Analyze the result to determine if validation succeeded
    const steps = result.steps || [];
    let wasFixed = false;
    let isValid = false;
    let lastError: string | undefined;
    let attempts = 0;

    // Count validation attempts and check results
    for (const step of steps) {
      if (step.toolResults) {
        for (const toolResult of step.toolResults) {
          if (toolResult.toolName === 'validateK6Script') {
            attempts++;
            const validationResult = toolResult.result as { valid: boolean; error?: string };
            if (validationResult.valid) {
              isValid = true;
            } else {
              lastError = validationResult.error;
            }
          }
          if (toolResult.toolName === 'writeScript') {
            wasFixed = true;
          }
        }
      }
    }

    if (verbose) {
      console.log(`   ${testName}: ${steps.length} agent steps, ${attempts} validations`);
    }

    return {
      test_name: testName,
      filename,
      valid: isValid,
      error: isValid ? undefined : lastError,
      fixed: wasFixed && isValid,
      attempts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      test_name: testName,
      filename,
      valid: false,
      error: message,
      fixed: false,
      attempts: 0,
    };
  }
}

/**
 * Validate all scripts in a directory using agentic validation
 */
export async function validateScripts(
  scriptsDir: string,
  testEntries: Array<{ name: string; endpoint_spec: Record<string, unknown> }>,
  options: BuildOptions,
): Promise<ValidationReport> {
  step('🔍', 'Validating generated scripts...');

  const client = new LLMClient({
    model: options.model,
    provider: options.provider,
    apiBase: options.apiBase,
  });

  const results: ValidationResult[] = [];
  let valid = 0;
  let fixed = 0;
  let failed = 0;

  for (const entry of testEntries) {
    const filename = `test_${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.js`;
    const scriptPath = `${scriptsDir}/${filename}`;

    const result = await validateAndFixScriptAgentic(
      client,
      scriptPath,
      entry.name,
      entry.endpoint_spec,
      options.maxAttempts * 2, // maxSteps = maxAttempts * 2 to allow read/validate/write cycles
      options.verbose,
    );

    results.push(result);

    if (result.valid && !result.fixed) {
      success(`${entry.name} - valid`);
      valid++;
    } else if (result.valid && result.fixed) {
      success(`${entry.name} - fixed after ${result.attempts} attempt(s)`);
      fixed++;
    } else {
      warn(`${entry.name} - could not fix (${result.attempts} attempts)`);
      failed++;
    }
  }

  const report: ValidationReport = {
    total: results.length,
    valid: valid + fixed,
    fixed,
    failed,
    results,
  };

  // Print summary
  console.log();
  step('🔍', 'Validation Summary');
  console.log(`   ✓ Valid: ${valid}`);
  console.log(`   🔧 Fixed: ${fixed}`);
  console.log(`   ✗ Failed: ${failed}`);

  return report;
}
