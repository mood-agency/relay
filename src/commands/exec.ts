/**
 * Exec command - Show k6 run instructions
 */

import type { ManifestEntry } from '../types.js';
import { readJson, resolvePath, listFiles } from '../utils/files.js';
import { step, success, error, section } from '../utils/progress.js';
import path from 'path';

interface ExecCommandOptions {
  target: string;
}

export async function execCommand(
  testsDir: string,
  options: ExecCommandOptions,
): Promise<void> {
  try {
    const fullPath = resolvePath(testsDir);
    const target = options.target;

    // Try to load manifest
    let testCount: number;
    try {
      const manifestPath = path.join(fullPath, 'manifest.json');
      const manifest = await readJson<ManifestEntry[]>(manifestPath);
      testCount = manifest.length;
    } catch {
      // Fall back to counting .js files
      const files = await listFiles(fullPath, '.js');
      testCount = files.length;
    }

    step('📋', `Found ${testCount} k6 test scripts in ${testsDir}`);
    console.log();

    section('🚀 Run these tests with k6:');
    console.log();
    console.log('   # Run a single test:');
    console.log(`   k6 run --env BASE_URL=${target} ${testsDir}/test_example.js`);
    console.log();
    console.log('   # Run all tests (bash/zsh):');
    console.log(`   for f in ${testsDir}/*.js; do k6 run --env BASE_URL=${target} "$f"; done`);
    console.log();
    console.log('   # Run all tests (PowerShell):');
    console.log(`   Get-ChildItem ${testsDir}\\*.js | ForEach-Object { k6 run --env BASE_URL=${target} $_.FullName }`);
    console.log();
    console.log('   # Load test with 10 virtual users for 30 seconds:');
    console.log(`   k6 run --env BASE_URL=${target} --vus 10 --duration 30s ${testsDir}/test_example.js`);
    console.log();

    section('📦 Install k6:');
    console.log();
    console.log('   Windows:  choco install k6  OR  winget install k6');
    console.log('   macOS:    brew install k6');
    console.log('   Linux:    See https://k6.io/docs/get-started/installation/');
    console.log();

    success('For more k6 options: https://k6.io/docs/');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Failed to read tests directory: ${message}`);
    process.exit(1);
  }
}
