/**
 * Analyzer Agent - Deep analyzes OpenAPI specs using agentic tool use
 *
 * This agent uses Vercel AI SDK's tool use capability to autonomously:
 * 1. Extract all endpoints from the spec
 * 2. Detect CRUD patterns for each resource
 * 3. Find authentication endpoints
 * 4. Identify nested resource relationships
 * 5. Generate a comprehensive analysis report
 */

import { LLMClient } from '../llm/client.js';
import {
  extractEndpoints,
  detectCrudPattern,
  detectAuthEndpoints,
  findNestedResources,
} from './tools/openApiTools.js';
import { step, success } from '../utils/progress.js';
import type { OpenAPISpec, AnalysisResult, PlanOptions, WorkflowPattern, ResourceRelationship } from '../types.js';

/**
 * System prompt for the analyzer agent
 */
const ANALYZER_SYSTEM_PROMPT = `You are an API analyst agent. Your task is to analyze OpenAPI specifications to detect patterns, workflows, and relationships.

## Workflow
1. First, use extractEndpoints to get all API endpoints from the spec
2. For each potential resource base path (e.g., /users, /products), use detectCrudPattern to check if it's a CRUD resource
3. Use detectAuthEndpoints to find authentication-related endpoints
4. Use findNestedResources to identify parent-child resource relationships
5. Based on your findings, compile a comprehensive analysis

## What to Look For
- CRUD patterns: Resources with Create, Read, Update, Delete operations
- Authentication flows: Login, logout, token refresh, registration
- State machines: Resources that might have status/state transitions
- Nested resources: Child resources under parent paths (e.g., /users/{id}/posts)
- Saga patterns: Multi-step workflows that span multiple resources

## Output
After using the tools, provide a summary of your findings. The system will parse your tool results to build the final analysis report.`;

/**
 * Analyze OpenAPI spec using agentic tool use
 */
export async function analyzeSpec(
  spec: OpenAPISpec,
  options: PlanOptions,
): Promise<AnalysisResult> {
  step('🔬', 'Running deep analysis on OpenAPI spec...');

  const client = new LLMClient({
    model: options.model,
    provider: options.provider,
    apiBase: options.apiBase,
  });

  const specJson = JSON.stringify(spec, null, 2);

  try {
    const result = await client.generateWithTools({
      system: ANALYZER_SYSTEM_PROMPT,
      prompt: `Analyze this OpenAPI specification to detect workflow patterns, authentication flows, and resource relationships.

API: ${spec.info.title} (v${spec.info.version})

Specification:
${specJson}

Start by extracting all endpoints, then analyze for patterns.`,
      tools: {
        extractEndpoints,
        detectCrudPattern,
        detectAuthEndpoints,
        findNestedResources,
      },
      maxSteps: 10,
    });

    // Parse tool results to build analysis
    const analysis = parseAnalysisFromSteps(result.steps || []);

    // Print summary
    success('Analysis complete:');
    console.log(`   📊 ${analysis.workflow_patterns.length} workflow patterns detected`);
    console.log(`   🔐 ${analysis.auth_flows.length} auth flows detected`);
    console.log(`   🔄 ${analysis.state_machines.length} state machines detected`);
    console.log(`   🔗 ${analysis.resource_relationships.length} resource relationships detected`);

    if (analysis.workflow_patterns.length > 0) {
      console.log();
      console.log('   Top workflow patterns:');
      for (const pattern of analysis.workflow_patterns.slice(0, 3)) {
        console.log(`   • ${pattern.name} (${pattern.type}, ${pattern.priority})`);
      }
    }

    return analysis;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`   Analysis error: ${message}`);

    // Return empty analysis on error
    return {
      workflow_patterns: [],
      auth_flows: [],
      state_machines: [],
      resource_relationships: [],
      coverage_recommendations: [],
    };
  }
}

/**
 * Parse analysis results from agent steps
 */
function parseAnalysisFromSteps(steps: Array<{
  toolResults?: Array<{
    toolName: string;
    result: unknown;
  }>;
}>): AnalysisResult {
  const workflow_patterns: WorkflowPattern[] = [];
  const auth_flows: string[] = [];
  const resource_relationships: ResourceRelationship[] = [];
  const coverage_recommendations: string[] = [];

  for (const step of steps) {
    if (!step.toolResults) continue;

    for (const toolResult of step.toolResults) {
      const result = toolResult.result as Record<string, unknown>;

      switch (toolResult.toolName) {
        case 'detectCrudPattern': {
          if (result.isCrud) {
            workflow_patterns.push({
              name: `CRUD_${(result.resource as string || 'Resource').replace(/^\//, '').replace(/\//g, '_')}`,
              type: 'crud',
              priority: 'high',
              endpoints: [result.resource as string],
              description: `CRUD operations for ${result.resource}`,
            });
            coverage_recommendations.push(`Test full CRUD lifecycle for ${result.resource}`);
          }
          break;
        }

        case 'detectAuthEndpoints': {
          const authEndpoints = result.authEndpoints as Array<{ path: string; method: string }> || [];
          if (authEndpoints.length > 0) {
            for (const ep of authEndpoints) {
              const flowName = ep.path.split('/').pop() || 'auth';
              if (!auth_flows.includes(flowName)) {
                auth_flows.push(flowName);
              }
            }
            workflow_patterns.push({
              name: 'Authentication_Flow',
              type: 'auth_flow',
              priority: 'critical',
              endpoints: authEndpoints.map(ep => ep.path),
              description: 'Authentication and authorization flow',
            });
            coverage_recommendations.push('Test authentication flow end-to-end');
          }
          break;
        }

        case 'findNestedResources': {
          const relationships = result.relationships as Array<{ parent: string; child: string; path: string }> || [];
          for (const rel of relationships) {
            resource_relationships.push({
              parent: rel.parent,
              child: rel.child,
              type: 'nested',
            });
          }
          if (relationships.length > 0) {
            coverage_recommendations.push('Test nested resource access patterns');
          }
          break;
        }
      }
    }
  }

  return {
    workflow_patterns,
    auth_flows,
    state_machines: [], // State machine detection would require schema analysis
    resource_relationships,
    coverage_recommendations,
  };
}
