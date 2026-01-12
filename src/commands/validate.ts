/**
 * Validate command - Validate an OpenAPI specification
 */

import { readFile, resolvePath } from '../utils/files.js';
import { parseOpenAPISpec, getAPIInfo, countEndpoints } from '../utils/openapi.js';
import { success, error, step } from '../utils/progress.js';

export async function validateCommand(specPath: string): Promise<void> {
  step('🔍', `Validating OpenAPI spec: ${specPath}`);

  try {
    const fullPath = resolvePath(specPath);
    const content = await readFile(fullPath);
    const spec = parseOpenAPISpec(content);
    const info = getAPIInfo(spec);
    const endpointCount = countEndpoints(spec);

    console.log();
    step('📋', `Title: ${info.title}`);
    step('📌', `Version: ${info.version}`);
    step('🔗', `Endpoints: ${endpointCount}`);
    
    if (info.description) {
      step('📝', `Description: ${info.description.slice(0, 100)}${info.description.length > 100 ? '...' : ''}`);
    }
    console.log();

    success('Spec is valid!');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Validation failed: ${message}`);
    process.exit(1);
  }
}
