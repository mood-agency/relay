/**
 * OpenAPI parsing utilities
 */

import type { OpenAPISpec, OpenAPIInfo, EndpointInfo } from '../types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/**
 * Validate and parse an OpenAPI specification
 */
export function parseOpenAPISpec(content: string): OpenAPISpec {
  let spec: unknown;
  
  try {
    spec = JSON.parse(content);
  } catch {
    throw new Error('Failed to parse OpenAPI spec as JSON');
  }

  if (!spec || typeof spec !== 'object') {
    throw new Error('OpenAPI spec must be a JSON object');
  }

  const obj = spec as Record<string, unknown>;

  // Validate required fields
  if (!obj.openapi || typeof obj.openapi !== 'string') {
    throw new Error('OpenAPI spec missing "openapi" version field');
  }

  if (!obj.info || typeof obj.info !== 'object') {
    throw new Error('OpenAPI spec missing "info" object');
  }

  const info = obj.info as Record<string, unknown>;
  if (!info.title || typeof info.title !== 'string') {
    throw new Error('OpenAPI spec missing "info.title"');
  }

  if (!info.version || typeof info.version !== 'string') {
    throw new Error('OpenAPI spec missing "info.version"');
  }

  if (!obj.paths || typeof obj.paths !== 'object') {
    throw new Error('OpenAPI spec missing "paths" object');
  }

  return spec as OpenAPISpec;
}

/**
 * Get API info from spec
 */
export function getAPIInfo(spec: OpenAPISpec): OpenAPIInfo {
  return {
    title: spec.info.title,
    version: spec.info.version,
    description: spec.info.description,
  };
}

/**
 * Extract all endpoints from an OpenAPI spec
 */
export function extractEndpoints(spec: OpenAPISpec): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  const paths = spec.paths;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation) continue;

      // Build endpoint spec with path, method, and operation details
      const endpointSpec = {
        path,
        method: method.toUpperCase(),
        operation,
      };

      endpoints.push({
        path,
        method: method.toUpperCase(),
        spec: endpointSpec,
      });
    }
  }

  return endpoints;
}

/**
 * Count total endpoints in spec
 */
export function countEndpoints(spec: OpenAPISpec): number {
  return extractEndpoints(spec).length;
}

/**
 * Get a summary of the spec for logging
 */
export function getSpecSummary(spec: OpenAPISpec): string {
  const info = getAPIInfo(spec);
  const endpointCount = countEndpoints(spec);
  return `${info.title} (v${info.version}) - ${endpointCount} endpoints`;
}
