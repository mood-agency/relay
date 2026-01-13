/**
 * Coverage Tools for Agent Use
 *
 * Tools for calculating test coverage metrics and prioritizing tests.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { TestPriority, TestCategory } from '../../types.js';

/**
 * Calculate test coverage metrics
 */
export const calculateCoverage = tool({
  description: 'Calculate test coverage metrics based on the current test plan and total endpoints.',
  parameters: z.object({
    tests: z.array(z.object({
      name: z.string(),
      method: z.string(),
      path: z.string(),
    })).describe('List of test entries'),
    totalEndpoints: z.number().describe('Total number of endpoints in the API'),
    totalMethods: z.number().describe('Total number of unique HTTP methods used'),
  }),
  execute: async ({ tests, totalEndpoints, totalMethods }) => {
    const testedEndpoints = new Set<string>();
    const testedMethods = new Set<string>();

    for (const test of tests) {
      testedEndpoints.add(`${test.method} ${test.path}`);
      testedMethods.add(test.method);
    }

    const endpointCoverage = totalEndpoints > 0
      ? Math.round((testedEndpoints.size / totalEndpoints) * 100)
      : 0;

    const methodCoverage = totalMethods > 0
      ? Math.round((testedMethods.size / totalMethods) * 100)
      : 0;

    return {
      endpointCoverage,
      methodCoverage,
      testedEndpointCount: testedEndpoints.size,
      totalEndpoints,
      testedMethodCount: testedMethods.size,
      totalMethods,
      testCount: tests.length,
      message: `Coverage: ${endpointCoverage}% endpoints, ${methodCoverage}% methods (${tests.length} tests)`,
    };
  },
});

/**
 * Classify a test by priority based on its name and characteristics
 */
export const classifyTestPriority = tool({
  description: 'Classify a test by priority level (critical, high, medium, low) based on its name and endpoint.',
  parameters: z.object({
    testName: z.string().describe('Name of the test'),
    method: z.string().describe('HTTP method'),
    path: z.string().describe('API path'),
  }),
  execute: async ({ testName, method, path }) => {
    const name = testName.toLowerCase();
    const pathLower = path.toLowerCase();

    let priority: TestPriority = 'medium';
    let reason = '';

    // Critical: auth, security, payments
    if (/auth|login|token|session|password/.test(pathLower) ||
        /security|injection|xss/.test(name)) {
      priority = 'critical';
      reason = 'Security or authentication related';
    }
    // Critical: payment, billing
    else if (/payment|billing|charge|subscription/.test(pathLower)) {
      priority = 'critical';
      reason = 'Payment or billing related';
    }
    // High: basic CRUD operations
    else if (/basic|valid|success/.test(name) && ['POST', 'PUT', 'DELETE'].includes(method)) {
      priority = 'high';
      reason = 'Core mutation operation';
    }
    // High: GET operations on main resources
    else if (method === 'GET' && /basic|list|get/.test(name)) {
      priority = 'high';
      reason = 'Core read operation';
    }
    // Low: edge cases and rare scenarios
    else if (/unicode|emoji|long|special|edge/.test(name)) {
      priority = 'low';
      reason = 'Edge case scenario';
    }
    // Medium: everything else (boundary, validation, etc.)
    else {
      priority = 'medium';
      reason = 'Standard test case';
    }

    return {
      priority,
      reason,
      testName,
      message: `Test "${testName}" classified as ${priority}: ${reason}`,
    };
  },
});

/**
 * Classify a test by category based on its name
 */
export const classifyTestCategory = tool({
  description: 'Classify a test by category (happy_path, boundary, negative, security, e2e) based on its name.',
  parameters: z.object({
    testName: z.string().describe('Name of the test'),
  }),
  execute: async ({ testName }) => {
    const name = testName.toLowerCase();

    let category: TestCategory = 'happy_path';
    let reason = '';

    if (/security|injection|xss|traversal|overflow/.test(name)) {
      category = 'security';
      reason = 'Security test pattern detected';
    } else if (/fail|invalid|missing|error|malformed|wrong/.test(name)) {
      category = 'negative';
      reason = 'Negative/validation test pattern detected';
    } else if (/zero|empty|max|min|negative|boundary|limit|large|long/.test(name)) {
      category = 'boundary';
      reason = 'Boundary value test pattern detected';
    } else if (/flow|workflow|lifecycle|e2e|end.to.end|scenario/.test(name)) {
      category = 'e2e';
      reason = 'End-to-end test pattern detected';
    } else {
      category = 'happy_path';
      reason = 'Standard happy path test';
    }

    return {
      category,
      reason,
      testName,
      message: `Test "${testName}" categorized as ${category}: ${reason}`,
    };
  },
});

/**
 * Identify coverage gaps
 */
export const identifyCoverageGaps = tool({
  description: 'Identify which endpoints are not covered by any tests.',
  parameters: z.object({
    allEndpoints: z.array(z.object({
      method: z.string(),
      path: z.string(),
    })).describe('All endpoints in the API'),
    tests: z.array(z.object({
      method: z.string(),
      path: z.string(),
    })).describe('Current test entries'),
  }),
  execute: async ({ allEndpoints, tests }) => {
    const testedSet = new Set(tests.map(t => `${t.method} ${t.path}`));

    const gaps = allEndpoints.filter(ep => !testedSet.has(`${ep.method} ${ep.path}`));

    return {
      gapCount: gaps.length,
      totalEndpoints: allEndpoints.length,
      coveredCount: allEndpoints.length - gaps.length,
      gaps,
      message: gaps.length > 0
        ? `Found ${gaps.length} untested endpoints`
        : 'All endpoints have test coverage',
    };
  },
});
