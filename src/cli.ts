/**
 * CLI command definitions using Commander
 */

import { Command } from 'commander';
import { planCommand } from './commands/plan.js';
import { buildCommand } from './commands/build.js';
import { execCommand } from './commands/exec.js';
import { validateCommand } from './commands/validate.js';

// Default values from environment variables
const DEFAULT_MODEL = process.env.ROHAN_MODEL ?? 'llama-3.3-70b-versatile';
const DEFAULT_PROVIDER = process.env.ROHAN_PROVIDER;
const DEFAULT_API_BASE = process.env.ROHAN_API_BASE;
const DEFAULT_WORKERS = process.env.ROHAN_WORKERS ?? '5';
const DEFAULT_BATCH_SIZE = process.env.ROHAN_BATCH_SIZE ?? '5';
const DEFAULT_RPM = process.env.ROHAN_RPM ?? '0';
const DEFAULT_PROMPT_DIR = process.env.ROHAN_PROMPT_DIR;

export function createCli(): Command {
  const program = new Command();

  program
    .name('rohan')
    .description('🚀 Rohan - OpenAPI Test Generator for k6')
    .version('1.0.0');

  // Plan command - Generate test plan from OpenAPI spec
  program
    .command('plan')
    .description('Generate test plan JSON from an OpenAPI spec')
    .argument('<spec>', 'Path to OpenAPI JSON specification file')
    .option('-o, --output <file>', 'Output file for the test plan', 'test-plan.json')
    .option('-w, --workers <number>', 'Number of parallel LLM workers', DEFAULT_WORKERS)
    .option('--model <model>', 'LLM model identifier (env: ROHAN_MODEL)', DEFAULT_MODEL)
    .option('--provider <provider>', 'LLM provider: groq, openai, anthropic, together, fireworks, ollama (env: ROHAN_PROVIDER)', DEFAULT_PROVIDER)
    .option('--api-base <url>', 'Custom LLM API endpoint (env: ROHAN_API_BASE)', DEFAULT_API_BASE)
    .option('--batch-size <number>', 'Endpoints to batch per LLM request (env: ROHAN_BATCH_SIZE)', DEFAULT_BATCH_SIZE)
    .option('--rpm <number>', 'Max requests per minute, 0 = unlimited (env: ROHAN_RPM)', DEFAULT_RPM)
    .option('--e2e', 'Generate E2E workflow tests', false)
    .option('--verbose', 'Enable detailed logging', false)
    .option('--prompt-dir <path>', 'Custom prompt directory (env: ROHAN_PROMPT_DIR)', DEFAULT_PROMPT_DIR)
    .action(planCommand);

  // Build command - Generate k6 scripts from test plan
  program
    .command('build')
    .description('Build k6 test scripts from a test plan JSON file')
    .argument('<plan>', 'Path to test plan JSON file')
    .option('-o, --output <dir>', 'Output directory for test scripts', 'tests/')
    .option('-w, --workers <number>', 'Number of parallel LLM workers', DEFAULT_WORKERS)
    .option('--model <model>', 'LLM model identifier (env: ROHAN_MODEL)', DEFAULT_MODEL)
    .option('--provider <provider>', 'LLM provider: groq, openai, anthropic, together, fireworks, ollama (env: ROHAN_PROVIDER)', DEFAULT_PROVIDER)
    .option('--api-base <url>', 'Custom LLM API endpoint (env: ROHAN_API_BASE)', DEFAULT_API_BASE)
    .option('--batch-size <number>', 'Tests to batch per LLM request (env: ROHAN_BATCH_SIZE)', DEFAULT_BATCH_SIZE)
    .option('--rpm <number>', 'Max requests per minute, 0 = unlimited (env: ROHAN_RPM)', DEFAULT_RPM)
    .option('--e2e', 'Build E2E workflow tests', false)
    .option('--overwrite', 'Overwrite existing test files', false)
    .option('--verbose', 'Enable detailed logging', false)
    .option('--prompt-dir <path>', 'Custom prompt directory (env: ROHAN_PROMPT_DIR)', DEFAULT_PROMPT_DIR)
    .action(buildCommand);

  // Exec command - Show k6 run instructions
  program
    .command('exec')
    .description('Show instructions for running k6 tests')
    .argument('<tests-dir>', 'Directory containing k6 test scripts')
    .option('--target <url>', 'Base URL for example commands', 'http://localhost:8080')
    .action(execCommand);

  // Validate command - Validate OpenAPI spec
  program
    .command('validate')
    .description('Validate an OpenAPI specification file')
    .argument('<spec>', 'Path to OpenAPI JSON specification file')
    .action(validateCommand);

  return program;
}
