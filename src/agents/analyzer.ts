/**
 * Analyzer Agent - Deep analyzes OpenAPI specs to detect patterns
 */

import { LLMClient } from '../llm/client.js';
import { PromptLoader, renderTemplate, cleanJsonResponse } from '../generator/templates.js';
import { step, success } from '../utils/progress.js';
import type { OpenAPISpec, AnalysisResult, PlanOptions } from '../types.js';

/**
 * Analyze OpenAPI spec for workflow patterns and relationships
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

  const loader = new PromptLoader(options.promptDir);

  const systemPrompt = await loader.load('agent_analyzer_system');
  const userTemplate = await loader.load('agent_analyzer_user');

  const userPrompt = renderTemplate(userTemplate, {
    spec: JSON.stringify(spec, null, 2),
  });

  const response = await client.generateWithRetry(systemPrompt, userPrompt);
  const cleaned = cleanJsonResponse(response);

  let analysis: AnalysisResult;
  try {
    analysis = JSON.parse(cleaned);
  } catch {
    // Return empty analysis if parsing fails
    analysis = {
      workflow_patterns: [],
      auth_flows: [],
      state_machines: [],
      resource_relationships: [],
      coverage_recommendations: [],
    };
  }

  // Ensure all required fields exist
  analysis.workflow_patterns = analysis.workflow_patterns || [];
  analysis.auth_flows = analysis.auth_flows || [];
  analysis.state_machines = analysis.state_machines || [];
  analysis.resource_relationships = analysis.resource_relationships || [];
  analysis.coverage_recommendations = analysis.coverage_recommendations || [];

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
}
