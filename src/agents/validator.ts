/**
 * Validator Agent - Validates k6 scripts and auto-fixes errors
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from '../utils/files.js';
import { LLMClient } from '../llm/client.js';
import { PromptLoader, renderTemplate, cleanCodeResponse } from '../generator/templates.js';
import { step, success, warn } from '../utils/progress.js';
import type { ValidationResult, ValidationReport, BuildOptions } from '../types.js';

const execAsync = promisify(exec);

/**
 * Run k6 dry-run to validate a script
 */
async function validateScript(scriptPath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await execAsync(`k6 run --dry-run "${scriptPath}"`, {
      timeout: 30000,
    });
    return { valid: true };
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    const errorMessage = error.stderr || error.message || 'Unknown error';
    return { valid: false, error: errorMessage };
  }
}

/**
 * Fix a broken k6 script using LLM
 */
async function fixScript(
  client: LLMClient,
  loader: PromptLoader,
  testName: string,
  code: string,
  errorMessage: string,
  endpointSpec: Record<string, unknown>,
): Promise<string> {
  const systemPrompt = await loader.load('agent_validator_system');
  const userTemplate = await loader.load('agent_validator_user');

  const userPrompt = renderTemplate(userTemplate, {
    test_name: testName,
    code: code,
    error: errorMessage,
    endpoint_spec: JSON.stringify(endpointSpec, null, 2),
  });

  const response = await client.generateWithRetry(systemPrompt, userPrompt);
  return cleanCodeResponse(response);
}

/**
 * Validate and fix a single script
 */
async function validateAndFixScript(
  client: LLMClient,
  loader: PromptLoader,
  scriptPath: string,
  testName: string,
  endpointSpec: Record<string, unknown>,
  maxAttempts: number,
  verbose: boolean,
): Promise<ValidationResult> {
  const filename = scriptPath.split(/[\\/]/).pop() || scriptPath;
  let code = await readFile(scriptPath);
  let attempts = 0;
  let lastError: string | undefined;

  // First validation
  const initial = await validateScript(scriptPath);
  if (initial.valid) {
    return {
      test_name: testName,
      filename,
      valid: true,
      fixed: false,
      attempts: 0,
    };
  }

  lastError = initial.error;

  // Try to fix
  while (attempts < maxAttempts) {
    attempts++;
    if (verbose) {
      console.log(`   Attempt ${attempts}/${maxAttempts} to fix ${testName}...`);
    }

    try {
      const fixedCode = await fixScript(client, loader, testName, code, lastError || '', endpointSpec);

      // Write fixed code
      await writeFile(scriptPath, fixedCode);
      code = fixedCode;

      // Validate again
      const result = await validateScript(scriptPath);
      if (result.valid) {
        return {
          test_name: testName,
          filename,
          valid: true,
          fixed: true,
          attempts,
        };
      }
      lastError = result.error;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (verbose) {
        console.log(`   Fix attempt failed: ${message}`);
      }
      lastError = message;
    }
  }

  return {
    test_name: testName,
    filename,
    valid: false,
    error: lastError,
    fixed: false,
    attempts,
  };
}

/**
 * Validate all scripts in a directory
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

  const loader = new PromptLoader(options.promptDir);

  const results: ValidationResult[] = [];
  let valid = 0;
  let fixed = 0;
  let failed = 0;

  for (const entry of testEntries) {
    const filename = `test_${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.js`;
    const scriptPath = `${scriptsDir}/${filename}`;

    try {
      const result = await validateAndFixScript(
        client,
        loader,
        scriptPath,
        entry.name,
        entry.endpoint_spec,
        options.maxAttempts,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`${entry.name} - error: ${message}`);
      results.push({
        test_name: entry.name,
        filename,
        valid: false,
        error: message,
        fixed: false,
        attempts: 0,
      });
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
