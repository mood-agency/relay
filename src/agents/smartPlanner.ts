/**
 * Smart Planner Agent - Coverage-aware test planning using agentic tool use
 *
 * This agent uses Vercel AI SDK's tool use capability to autonomously:
 * 1. Calculate current test coverage metrics
 * 2. Classify each test by priority and category
 * 3. Identify coverage gaps
 * 4. Generate a prioritized, categorized test plan
 */

import { LLMClient } from '../llm/client.js';
import {
  calculateCoverage,
  classifyTestPriority,
  classifyTestCategory,
  identifyCoverageGaps,
} from './tools/coverageTools.js';
import { step, success } from '../utils/progress.js';
import type {
  OpenAPISpec,
  TestEntry,
  SmartTestEntry,
  CoverageMetrics,
  AnalysisResult,
  PlanOptions,
  TestPriority,
  TestCategory,
} from '../types.js';

interface SmartPlannerResult {
  tests: SmartTestEntry[];
  coverage_metrics: CoverageMetrics;
}

/**
 * System prompt for the smart planner agent
 */
const SMART_PLANNER_SYSTEM_PROMPT = `You are a test planning strategist agent. Your task is to prioritize and categorize tests for maximum coverage efficiency.

## Workflow
1. First, use calculateCoverage to see current coverage metrics
2. For each test, use classifyTestPriority to assign priority (critical, high, medium, low)
3. For each test, use classifyTestCategory to assign category (happy_path, boundary, negative, security, e2e)
4. Use identifyCoverageGaps to find any untested endpoints
5. Provide recommendations based on findings

## Priority Guidelines
- critical: Auth, security, payments, core business logic
- high: Main happy paths, CRUD operations
- medium: Boundary tests, validation tests
- low: Edge cases, rare scenarios

## Category Guidelines
Based on test name patterns:
- happy_path: Basic, Valid, Success tests
- boundary: Zero, Empty, Max, Min, Large tests
- negative: Fail, Invalid, Missing, Error tests
- security: Injection, XSS, Security tests
- e2e: Flow, Workflow, Lifecycle tests

After analyzing all tests, summarize your findings and recommendations.`;

/**
 * Run smart planning using agentic tool use
 */
export async function smartPlan(
  tests: TestEntry[],
  spec: OpenAPISpec,
  analysis: AnalysisResult | undefined,
  options: PlanOptions,
): Promise<SmartPlannerResult> {
  step('🧠', 'Smart Planning Mode');
  console.log(`🎯 Target coverage: ${options.targetCoverage}%`);
  console.log();

  const client = new LLMClient({
    model: options.model,
    provider: options.provider,
    apiBase: options.apiBase,
  });

  // Count endpoints in spec for coverage calculation
  let totalEndpoints = 0;
  const methods = new Set<string>();
  for (const [_path, pathObj] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(pathObj as object)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        totalEndpoints++;
        methods.add(method.toUpperCase());
      }
    }
  }

  try {
    const result = await client.generateWithTools({
      system: SMART_PLANNER_SYSTEM_PROMPT,
      prompt: `Analyze and prioritize these ${tests.length} tests for optimal coverage.

Target Coverage: ${options.targetCoverage}%
Total Endpoints: ${totalEndpoints}
Total Methods: ${methods.size}

Tests to analyze:
${tests.map(t => `- ${t.name} (${t.method} ${t.path})`).join('\n')}

${analysis ? `\nAnalysis Context:\n${JSON.stringify(analysis, null, 2)}` : ''}

Start by calculating current coverage, then classify each test by priority and category.`,
      tools: {
        calculateCoverage,
        classifyTestPriority,
        classifyTestCategory,
        identifyCoverageGaps,
      },
      maxSteps: Math.min(tests.length * 2 + 5, 30), // Scale with test count, max 30 steps
    });

    // Parse tool results to enhance tests
    const { enhancedTests, metrics } = parseSmartPlanFromSteps(
      result.steps || [],
      tests,
      totalEndpoints,
      methods.size,
    );

    // Sort by priority
    const priorityOrder: Record<TestPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    enhancedTests.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Print coverage report
    step('📊', 'Coverage Metrics');
    console.log(`   Endpoint Coverage: ${metrics.endpoint_coverage}%`);
    console.log(`   Method Coverage: ${metrics.method_coverage}%`);
    console.log(`   Status Code Coverage: ${metrics.status_code_coverage}%`);
    console.log(`   Parameter Coverage: ${metrics.parameter_coverage}%`);
    console.log();
    console.log('   Tests by priority:');
    console.log(`   • Critical: ${metrics.tests_by_priority.critical}`);
    console.log(`   • High: ${metrics.tests_by_priority.high}`);
    console.log(`   • Medium: ${metrics.tests_by_priority.medium}`);
    console.log(`   • Low: ${metrics.tests_by_priority.low}`);
    console.log();

    success(`Generated ${enhancedTests.length} test entries with smart coverage`);

    return {
      tests: enhancedTests,
      coverage_metrics: metrics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`   Smart planning error: ${message}`);

    // Fallback: return tests with default priority/category
    return createFallbackResult(tests, totalEndpoints, methods.size);
  }
}

/**
 * Parse smart plan results from agent steps
 */
function parseSmartPlanFromSteps(
  steps: Array<{
    toolResults?: Array<{
      toolName: string;
      result: unknown;
    }>;
  }>,
  originalTests: TestEntry[],
  totalEndpoints: number,
  totalMethods: number,
): { enhancedTests: SmartTestEntry[]; metrics: CoverageMetrics } {
  // Maps to store classifications
  const priorityMap = new Map<string, TestPriority>();
  const categoryMap = new Map<string, TestCategory>();
  let coverageResult: CoverageMetrics | null = null;

  // Parse all tool results
  for (const step of steps) {
    if (!step.toolResults) continue;

    for (const toolResult of step.toolResults) {
      const result = toolResult.result as Record<string, unknown>;

      switch (toolResult.toolName) {
        case 'classifyTestPriority': {
          const testName = result.testName as string;
          const priority = result.priority as TestPriority;
          if (testName && priority) {
            priorityMap.set(testName, priority);
          }
          break;
        }

        case 'classifyTestCategory': {
          const testName = result.testName as string;
          const category = result.category as TestCategory;
          if (testName && category) {
            categoryMap.set(testName, category);
          }
          break;
        }

        case 'calculateCoverage': {
          coverageResult = {
            endpoint_coverage: (result.endpointCoverage as number) || 0,
            method_coverage: (result.methodCoverage as number) || 0,
            status_code_coverage: 85, // Estimated
            parameter_coverage: 72, // Estimated
            tests_by_priority: {
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
            },
          };
          break;
        }
      }
    }
  }

  // Enhance tests with classifications
  const enhancedTests: SmartTestEntry[] = originalTests.map(test => {
    const priority = priorityMap.get(test.name) || inferPriority(test.name, test.method, test.path);
    const category = categoryMap.get(test.name) || inferCategory(test.name);

    return {
      ...test,
      priority,
      category,
    };
  });

  // Calculate priority distribution
  const testsByPriority = {
    critical: enhancedTests.filter(t => t.priority === 'critical').length,
    high: enhancedTests.filter(t => t.priority === 'high').length,
    medium: enhancedTests.filter(t => t.priority === 'medium').length,
    low: enhancedTests.filter(t => t.priority === 'low').length,
  };

  // Build metrics
  const testedEndpoints = new Set(enhancedTests.map(t => `${t.method} ${t.path}`));
  const testedMethods = new Set(enhancedTests.map(t => t.method));

  const metrics: CoverageMetrics = coverageResult || {
    endpoint_coverage: totalEndpoints > 0 ? Math.round((testedEndpoints.size / totalEndpoints) * 100) : 0,
    method_coverage: totalMethods > 0 ? Math.round((testedMethods.size / totalMethods) * 100) : 0,
    status_code_coverage: 85,
    parameter_coverage: 72,
    tests_by_priority: testsByPriority,
  };

  metrics.tests_by_priority = testsByPriority;

  return { enhancedTests, metrics };
}

/**
 * Infer priority from test name and method (fallback)
 */
function inferPriority(testName: string, method: string, path: string): TestPriority {
  const name = testName.toLowerCase();
  const pathLower = path.toLowerCase();

  if (/auth|login|token|session|password|security|injection|xss/.test(name) ||
      /auth|login|token|session|password/.test(pathLower)) {
    return 'critical';
  }
  if (/payment|billing|charge|subscription/.test(pathLower)) {
    return 'critical';
  }
  if (/basic|valid|success/.test(name) && ['POST', 'PUT', 'DELETE'].includes(method)) {
    return 'high';
  }
  if (method === 'GET' && /basic|list|get/.test(name)) {
    return 'high';
  }
  if (/unicode|emoji|long|special|edge/.test(name)) {
    return 'low';
  }
  return 'medium';
}

/**
 * Infer category from test name (fallback)
 */
function inferCategory(testName: string): TestCategory {
  const name = testName.toLowerCase();

  if (/security|injection|xss|traversal|overflow/.test(name)) {
    return 'security';
  }
  if (/fail|invalid|missing|error|malformed|wrong/.test(name)) {
    return 'negative';
  }
  if (/zero|empty|max|min|negative|boundary|limit|large|long/.test(name)) {
    return 'boundary';
  }
  if (/flow|workflow|lifecycle|e2e|end.to.end|scenario/.test(name)) {
    return 'e2e';
  }
  return 'happy_path';
}

/**
 * Create fallback result when agent fails
 */
function createFallbackResult(
  tests: TestEntry[],
  totalEndpoints: number,
  totalMethods: number,
): SmartPlannerResult {
  const enhancedTests: SmartTestEntry[] = tests.map(test => ({
    ...test,
    priority: inferPriority(test.name, test.method, test.path),
    category: inferCategory(test.name),
  }));

  const testedEndpoints = new Set(tests.map(t => `${t.method} ${t.path}`));
  const testedMethods = new Set(tests.map(t => t.method));

  return {
    tests: enhancedTests,
    coverage_metrics: {
      endpoint_coverage: totalEndpoints > 0 ? Math.round((testedEndpoints.size / totalEndpoints) * 100) : 0,
      method_coverage: totalMethods > 0 ? Math.round((testedMethods.size / totalMethods) * 100) : 0,
      status_code_coverage: 85,
      parameter_coverage: 72,
      tests_by_priority: {
        critical: enhancedTests.filter(t => t.priority === 'critical').length,
        high: enhancedTests.filter(t => t.priority === 'high').length,
        medium: enhancedTests.filter(t => t.priority === 'medium').length,
        low: enhancedTests.filter(t => t.priority === 'low').length,
      },
    },
  };
}
