/**
 * OpenAPI Tools for Agent Use
 *
 * Tools that allow the LLM to analyze OpenAPI specs.
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Extract all endpoints from an OpenAPI spec
 */
export const extractEndpoints = tool({
  description: 'Extract all API endpoints from an OpenAPI specification. Returns a list of endpoints with their methods and paths.',
  parameters: z.object({
    specJson: z.string().describe('The OpenAPI specification as a JSON string'),
  }),
  execute: async ({ specJson }) => {
    try {
      const spec = JSON.parse(specJson);
      const endpoints: Array<{ method: string; path: string; operationId?: string; summary?: string }> = [];

      for (const [path, pathObj] of Object.entries(spec.paths || {})) {
        const methods = pathObj as Record<string, unknown>;
        for (const [method, operation] of Object.entries(methods)) {
          if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
            const op = operation as { operationId?: string; summary?: string };
            endpoints.push({
              method: method.toUpperCase(),
              path,
              operationId: op.operationId,
              summary: op.summary,
            });
          }
        }
      }

      return {
        success: true,
        count: endpoints.length,
        endpoints,
        message: `Found ${endpoints.length} endpoints in the spec`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        endpoints: [],
        message: `Failed to parse spec: ${message}`,
      };
    }
  },
});

/**
 * Detect CRUD patterns in endpoints
 */
export const detectCrudPattern = tool({
  description: 'Detect if a set of endpoints forms a CRUD (Create, Read, Update, Delete) pattern for a resource.',
  parameters: z.object({
    resourcePath: z.string().describe('The base resource path (e.g., "/users")'),
    endpoints: z.array(z.object({
      method: z.string(),
      path: z.string(),
    })).describe('List of endpoints to analyze'),
  }),
  execute: async ({ resourcePath, endpoints }) => {
    const crud = {
      create: false,
      read: false,
      readOne: false,
      update: false,
      delete: false,
    };

    const basePath = resourcePath.replace(/\/$/, '');
    const itemPathRegex = new RegExp(`^${basePath}/\\{[^}]+\\}$`);

    for (const ep of endpoints) {
      const method = ep.method.toUpperCase();
      const path = ep.path;

      if (path === basePath && method === 'POST') crud.create = true;
      if (path === basePath && method === 'GET') crud.read = true;
      if (itemPathRegex.test(path) && method === 'GET') crud.readOne = true;
      if (itemPathRegex.test(path) && (method === 'PUT' || method === 'PATCH')) crud.update = true;
      if (itemPathRegex.test(path) && method === 'DELETE') crud.delete = true;
    }

    const isCrud = crud.create && (crud.read || crud.readOne) && crud.update && crud.delete;
    const operations = Object.entries(crud)
      .filter(([_, present]) => present)
      .map(([op]) => op);

    return {
      isCrud,
      operations,
      resource: basePath,
      message: isCrud
        ? `Found complete CRUD pattern for ${basePath}`
        : `Partial CRUD pattern for ${basePath}: ${operations.join(', ')}`,
    };
  },
});

/**
 * Detect authentication endpoints
 */
export const detectAuthEndpoints = tool({
  description: 'Detect authentication-related endpoints in a list of endpoints (login, logout, token refresh, etc.).',
  parameters: z.object({
    endpoints: z.array(z.object({
      method: z.string(),
      path: z.string(),
      operationId: z.string().optional(),
    })).describe('List of endpoints to analyze'),
  }),
  execute: async ({ endpoints }) => {
    const authPatterns = [
      /auth/i, /login/i, /logout/i, /token/i, /refresh/i,
      /signin/i, /signout/i, /register/i, /signup/i,
      /password/i, /session/i, /oauth/i,
    ];

    const authEndpoints = endpoints.filter(ep => {
      const text = `${ep.path} ${ep.operationId || ''}`;
      return authPatterns.some(pattern => pattern.test(text));
    });

    return {
      found: authEndpoints.length > 0,
      count: authEndpoints.length,
      authEndpoints,
      message: authEndpoints.length > 0
        ? `Found ${authEndpoints.length} authentication-related endpoints`
        : 'No authentication endpoints detected',
    };
  },
});

/**
 * Find nested resources
 */
export const findNestedResources = tool({
  description: 'Find nested resource relationships in API paths (e.g., /users/{id}/posts).',
  parameters: z.object({
    endpoints: z.array(z.object({
      method: z.string(),
      path: z.string(),
    })).describe('List of endpoints to analyze'),
  }),
  execute: async ({ endpoints }) => {
    const relationships: Array<{ parent: string; child: string; path: string }> = [];
    const pathParamRegex = /\{[^}]+\}/g;

    for (const ep of endpoints) {
      const parts = ep.path.split('/').filter(Boolean);
      const paramIndices: number[] = [];

      parts.forEach((part, i) => {
        if (pathParamRegex.test(part)) {
          paramIndices.push(i);
        }
      });

      // If there's a param followed by more path segments, it's nested
      if (paramIndices.length > 0) {
        const lastParamIdx = paramIndices[paramIndices.length - 1];
        if (lastParamIdx < parts.length - 1) {
          // There's content after the last param
          const parent = '/' + parts.slice(0, lastParamIdx).join('/');
          const child = '/' + parts.slice(lastParamIdx + 1).join('/');
          if (parent && child && !relationships.some(r => r.parent === parent && r.child === child)) {
            relationships.push({ parent, child, path: ep.path });
          }
        }
      }
    }

    return {
      found: relationships.length > 0,
      count: relationships.length,
      relationships,
      message: relationships.length > 0
        ? `Found ${relationships.length} nested resource relationships`
        : 'No nested resources detected',
    };
  },
});
