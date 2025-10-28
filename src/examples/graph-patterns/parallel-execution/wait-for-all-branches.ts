/**
 * LangGraph Parallel Execution: Waiting for All Branches to Complete
 *
 * This example demonstrates how to make a fan-in node wait for ALL branches
 * to complete before executing, using LangGraph's array syntax for edges.
 *
 * KEY DIFFERENCE FROM DEFAULT BEHAVIOR:
 * - Default: addEdge("branch1", "aggregate") → aggregate runs immediately
 * - This example: addEdge(["branch1", "branch2", "branch3"], "aggregate") → aggregate waits for ALL
 *
 * THE SOLUTION:
 * Instead of adding individual edges from each branch to the aggregation node,
 * you pass an ARRAY of node names to the addEdge method. This tells LangGraph
 * to wait for ALL specified nodes to complete before executing the target node.
 *
 * COMPARISON:
 *
 * 1. DEFAULT BEHAVIOR (Multiple Executions):
 *    ```typescript
 *    .addEdge("quick_validate", "aggregate_results")
 *    .addEdge("process_step3", "aggregate_results")
 *    .addEdge("qa_step5", "aggregate_results")
 *    // Result: aggregate_results runs 3 times
 *    ```
 *
 * 2. WAIT-FOR-ALL BEHAVIOR (Single Execution):
 *    ```typescript
 *    .addEdge(["quick_validate", "process_step3", "qa_step5"], "aggregate_results")
 *    // Result: aggregate_results runs ONCE after all complete
 *    ```
 *
 * GRAPH VISUALIZATION:
 * ```
 *                    start_pipeline
 *                          |
 *        +---------+-------+-------+---------+
 *        |         |       |       |         |
 *   quick_validate | process_s1 |  qa_step1  | external_s1
 *        |         |       |       |         |
 *        ⇓         |  process_s2 | qa_step2  | external_s2
 *        |         |       |       |         |
 *        |         |  process_s3 | qa_step3  | [conditional]
 *        |         |       |       |         |
 *        |         |       ⇓       | qa_step4 | external_s3?
 *        |         |       |       |         |
 *        |         |       |       | qa_step5 | external_s4?
 *        |         |       |       |         |
 *        |         |       |       |    ⇓    |      ⇓
 *        +---------+-------+-------+---------+
 *                          |
 *                  [WAIT FOR ALL]
 *                          |
 *                  aggregate_results
 *                  (RUNS ONCE!)
 *                          |
 *                       __end__
 * ```
 */

import type { CompiledStateGraph, StateDefinition } from '@langchain/langgraph';
import { Annotation, MemorySaver, StateGraph } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Data structure interfaces
 */
interface TransformedData {
  userId: string;
  transactionId: string;
  amount: number;
  items: string[];
  processed: boolean;
}

interface ApiResponse {
  status?: string;
  data?: string;
  extra?: string;
}

/**
 * State Definition
 *
 * Same structure as before, but the aggregation_count will show
 * that the aggregation node only runs ONCE
 */
const PipelineState = Annotation.Root({
  // Input data
  inputData: Annotation<Record<string, unknown>>,

  // Messages with reducer
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Execution timeline
  executionTimeline: Annotation<
    Array<{
      timestamp: string;
      node: string;
      branch: string;
      message: string;
    }>
  >({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Track aggregation executions (should be 1!)
  aggregationCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),

  // Track completed branches
  completedBranches: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Branch results
  quickValidationResult: Annotation<{
    isValid: boolean;
    issues: string[];
    completedAt: string;
  }>,

  dataProcessingResult: Annotation<{
    transformedData: TransformedData;
    processingSteps: string[];
    completedAt: string;
  }>,

  qualityAssuranceResult: Annotation<{
    qaChecks: Record<string, boolean>;
    qaScore: number;
    recommendations: string[];
    completedAt: string;
  }>,

  externalIntegrationResult: Annotation<{
    apiCalls: string[];
    responses: ApiResponse[];
    completedAt: string;
  }>,

  // Control variable branch length
  externalIntegrationSteps: Annotation<number>,

  // Summary
  pipelineSummary: Annotation<string>,

  // Timing
  startTime: Annotation<number>,
  branchCompletionTimes: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

/**
 * Helper function
 */
function createTimelineEntry(node: string, branch: string, message: string) {
  return {
    timestamp: new Date().toISOString(),
    node,
    branch,
    message,
  };
}

/**
 * Start Pipeline Node
 */
async function startPipeline(_state: typeof PipelineState.State) {
  const startTime = Date.now();

  const inputData = {
    userId: 'user123',
    transactionId: 'tx456',
    amount: 150.0,
    items: ['item1', 'item2', 'item3'],
  };

  // For simplicity, fix external steps to 3
  const externalSteps = 3;

  console.log('\n🚀 STARTING PARALLEL PIPELINE WITH WAIT-FOR-ALL AGGREGATION');
  console.log(`=${'='.repeat(60)}`);
  console.log('📋 Configuration:');
  console.log(`- Quick Validation: 1 node`);
  console.log(`- Data Processing: 3 nodes`);
  console.log(`- Quality Assurance: 5 nodes`);
  console.log(`- External Integration: ${externalSteps} nodes`);
  console.log('\n✨ SPECIAL BEHAVIOR: The aggregation node will wait for ALL branches!');
  console.log('It will execute ONLY ONCE after all 4 branches complete.');
  console.log(`=${'='.repeat(60)}\n`);

  return {
    inputData,
    startTime,
    externalIntegrationSteps: externalSteps,
    messages: [new AIMessage('Pipeline initialized with wait-for-all aggregation')],
    executionTimeline: [createTimelineEntry('start_pipeline', 'MAIN', 'Pipeline started')],
  };
}

/**
 * BRANCH 1: Quick Validation (1 node)
 */
async function quickValidate(state: typeof PipelineState.State) {
  const branchStart = Date.now();
  console.log('⚡ [QUICK] Starting validation...');

  await new Promise((resolve) => setTimeout(resolve, 300));

  const issues: string[] = [];
  const amount = state.inputData['amount'] as number;
  if (amount > 1000) {
    issues.push('High value transaction');
  }

  console.log(`✅ [QUICK] Validation complete (${issues.length} issues found)`);
  console.log(`   → Branch complete, but aggregation will WAIT for other branches`);

  return {
    quickValidationResult: {
      isValid: issues.length === 0,
      issues,
      completedAt: new Date().toISOString(),
    },
    completedBranches: ['quick'],
    branchCompletionTimes: {
      quick: Date.now() - branchStart,
    },
    messages: [new AIMessage(`Quick validation completed`)],
    executionTimeline: [
      createTimelineEntry('quick_validate', 'QUICK', `Completed (${issues.length} issues)`),
    ],
  };
}

/**
 * BRANCH 2: Data Processing (3 nodes)
 */
async function processStep1(_state: typeof PipelineState.State) {
  console.log('🔄 [PROCESS] Step 1/3: Data normalization...');
  await new Promise((resolve) => setTimeout(resolve, 400));

  return {
    executionTimeline: [createTimelineEntry('process_step1', 'PROCESS', 'Data normalized')],
  };
}

async function processStep2(_state: typeof PipelineState.State) {
  console.log('🔄 [PROCESS] Step 2/3: Transformation...');
  await new Promise((resolve) => setTimeout(resolve, 400));

  return {
    executionTimeline: [createTimelineEntry('process_step2', 'PROCESS', 'Data transformed')],
  };
}

async function processStep3(state: typeof PipelineState.State) {
  const branchStart = Date.now() - 800;
  console.log('🔄 [PROCESS] Step 3/3: Finalization...');
  await new Promise((resolve) => setTimeout(resolve, 400));

  console.log('✅ [PROCESS] Data processing complete');
  console.log(`   → Branch complete, but aggregation will WAIT for other branches`);

  return {
    dataProcessingResult: {
      transformedData: { ...state.inputData, processed: true } as TransformedData,
      processingSteps: ['normalize', 'transform', 'finalize'],
      completedAt: new Date().toISOString(),
    },
    completedBranches: ['process'],
    branchCompletionTimes: {
      process: Date.now() - branchStart,
    },
    messages: [new AIMessage('Data processing completed')],
    executionTimeline: [createTimelineEntry('process_step3', 'PROCESS', 'Processing complete')],
  };
}

/**
 * BRANCH 3: Quality Assurance (5 nodes)
 */
async function qaStep1(_state: typeof PipelineState.State) {
  console.log('🔍 [QA] Step 1/5: Schema validation...');
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    executionTimeline: [createTimelineEntry('qa_step1', 'QA', 'Schema validated')],
  };
}

async function qaStep2(_state: typeof PipelineState.State) {
  console.log('🔍 [QA] Step 2/5: Business rules...');
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    executionTimeline: [createTimelineEntry('qa_step2', 'QA', 'Business rules verified')],
  };
}

async function qaStep3(_state: typeof PipelineState.State) {
  console.log('🔍 [QA] Step 3/5: Data integrity...');
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    executionTimeline: [createTimelineEntry('qa_step3', 'QA', 'Data integrity confirmed')],
  };
}

async function qaStep4(_state: typeof PipelineState.State) {
  console.log('🔍 [QA] Step 4/5: Security scan...');
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    executionTimeline: [createTimelineEntry('qa_step4', 'QA', 'Security scan passed')],
  };
}

async function qaStep5(_state: typeof PipelineState.State) {
  const branchStart = Date.now() - 800;
  console.log('🔍 [QA] Step 5/5: Final report...');
  await new Promise((resolve) => setTimeout(resolve, 200));

  const qaScore = 100;

  console.log(`✅ [QA] Quality assurance complete (Score: ${qaScore}%)`);
  console.log(`   → Branch complete, aggregation is waiting for all branches`);

  return {
    qualityAssuranceResult: {
      qaChecks: {
        schema: true,
        businessRules: true,
        dataIntegrity: true,
        security: true,
        performance: true,
      },
      qaScore,
      recommendations: ['All checks passed'],
      completedAt: new Date().toISOString(),
    },
    completedBranches: ['qa'],
    branchCompletionTimes: {
      qa: Date.now() - branchStart,
    },
    messages: [new AIMessage(`QA completed with score: ${qaScore}%`)],
    executionTimeline: [createTimelineEntry('qa_step5', 'QA', `QA complete (${qaScore}%)`)],
  };
}

/**
 * BRANCH 4: External Integration (3 nodes for this example)
 */
async function externalStep1(_state: typeof PipelineState.State) {
  console.log(`🌐 [EXTERNAL] Step 1/3: Auth check...`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    executionTimeline: [createTimelineEntry('external_step1', 'EXTERNAL', 'Auth verified')],
  };
}

async function externalStep2(_state: typeof PipelineState.State) {
  console.log(`🌐 [EXTERNAL] Step 2/3: Primary API...`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    executionTimeline: [createTimelineEntry('external_step2', 'EXTERNAL', 'Primary API success')],
  };
}

async function externalStep3(_state: typeof PipelineState.State) {
  const branchStart = Date.now() - 1000;
  console.log(`🌐 [EXTERNAL] Step 3/3: Secondary API...`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('✅ [EXTERNAL] Integration complete');
  console.log(`   → Branch complete, aggregation is still waiting for QA branch`);

  return {
    externalIntegrationResult: {
      apiCalls: ['auth', 'primary', 'secondary'],
      responses: [{ status: 'ok' }, { data: 'processed' }, { extra: 'data' }],
      completedAt: new Date().toISOString(),
    },
    completedBranches: ['external'],
    branchCompletionTimes: {
      external: Date.now() - branchStart,
    },
    messages: [new AIMessage('External integration completed')],
    executionTimeline: [createTimelineEntry('external_step3', 'EXTERNAL', 'Integration complete')],
  };
}

/**
 * AGGREGATION NODE - RUNS ONLY ONCE!
 *
 * Because we use the array syntax in addEdge, this node will:
 * - Wait for ALL specified branches to complete
 * - Execute ONLY ONCE when all branches are done
 * - Have access to all branch results immediately
 */
async function aggregateResults(state: typeof PipelineState.State) {
  const currentExecution = state.aggregationCount + 1;
  const totalTime = Date.now() - state.startTime;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 AGGREGATION NODE EXECUTION (SINGLE EXECUTION!)`);
  console.log('='.repeat(60));
  console.log(`⏱️  Time since start: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`✅ ALL branches have completed before this execution`);
  console.log(`📊 Branches completed: ${state.completedBranches.join(', ')}`);

  // All results are guaranteed to be available
  console.log(`\n📋 All results available in single execution:`);
  console.log(`   - Quick Validation ✓ (${state.quickValidationResult.issues.length} issues)`);
  console.log(
    `   - Data Processing ✓ (${state.dataProcessingResult.processingSteps.length} steps)`,
  );
  console.log(
    `   - External Integration ✓ (${state.externalIntegrationResult.apiCalls.length} APIs)`,
  );
  console.log(`   - Quality Assurance ✓ (${state.qualityAssuranceResult.qaScore}% score)`);

  const summary = `
FINAL AGGREGATION (Single Execution)
====================================
Time: ${(totalTime / 1000).toFixed(2)}s
Execution Count: ${currentExecution} (This should be 1!)

Branch Results:
- Quick Validation: ${state.quickValidationResult.isValid ? 'PASSED' : 'FAILED'} (${state.quickValidationResult.issues.length} issues)
- Data Processing: ${state.dataProcessingResult.processingSteps.length} steps completed
- External Integration: ${state.externalIntegrationResult.apiCalls.length} API calls made
- Quality Assurance: ${state.qualityAssuranceResult.qaScore}% score

Branch Completion Times:
- Quick: ${(state.branchCompletionTimes['quick']! / 1000).toFixed(2)}s
- Process: ${(state.branchCompletionTimes['process']! / 1000).toFixed(2)}s
- External: ${(state.branchCompletionTimes['external']! / 1000).toFixed(2)}s
- QA: ${(state.branchCompletionTimes['qa']! / 1000).toFixed(2)}s

Key Insight: By using addEdge with an array of nodes,
the aggregation waited for ALL branches to complete
before executing ONCE with all results available!
`;

  console.log(summary);
  console.log(`${'='.repeat(60)}\n`);

  return {
    aggregationCount: 1,
    pipelineSummary: summary,
    messages: [new AIMessage(`Aggregation completed in single execution`)],
  };
}

/**
 * Type Definitions
 */
type PipelineStateType = typeof PipelineState.State;
type PipelineUpdateType = Partial<PipelineStateType>;
type PipelineNodes =
  | 'start_pipeline'
  | 'quick_validate'
  | 'process_step1'
  | 'process_step2'
  | 'process_step3'
  | 'qa_step1'
  | 'qa_step2'
  | 'qa_step3'
  | 'qa_step4'
  | 'qa_step5'
  | 'external_step1'
  | 'external_step2'
  | 'external_step3'
  | 'aggregate_results'
  | '__start__';

export type WaitForAllGraph = CompiledStateGraph<
  PipelineStateType,
  PipelineUpdateType,
  PipelineNodes,
  typeof PipelineState.spec,
  typeof PipelineState.spec,
  StateDefinition
>;

/**
 * Create the Graph with Wait-For-All Aggregation
 *
 * THE KEY DIFFERENCE IS HERE:
 * Instead of multiple individual edges, we use ONE edge with an array
 */
export function createWaitForAllGraph(): WaitForAllGraph {
  const workflow = new StateGraph(PipelineState)
    // Initialize
    .addNode('start_pipeline', startPipeline)

    // Branch 1: Quick Validation
    .addNode('quick_validate', quickValidate)

    // Branch 2: Data Processing
    .addNode('process_step1', processStep1)
    .addNode('process_step2', processStep2)
    .addNode('process_step3', processStep3)

    // Branch 3: Quality Assurance
    .addNode('qa_step1', qaStep1)
    .addNode('qa_step2', qaStep2)
    .addNode('qa_step3', qaStep3)
    .addNode('qa_step4', qaStep4)
    .addNode('qa_step5', qaStep5)

    // Branch 4: External Integration
    .addNode('external_step1', externalStep1)
    .addNode('external_step2', externalStep2)
    .addNode('external_step3', externalStep3)

    // Aggregation
    .addNode('aggregate_results', aggregateResults)

    // === EDGES ===

    // Start flow
    .addEdge('__start__', 'start_pipeline')

    // FAN-OUT: All branches start simultaneously
    .addEdge('start_pipeline', 'quick_validate')
    .addEdge('start_pipeline', 'process_step1')
    .addEdge('start_pipeline', 'qa_step1')
    .addEdge('start_pipeline', 'external_step1')

    // Branch flows
    .addEdge('process_step1', 'process_step2')
    .addEdge('process_step2', 'process_step3')

    .addEdge('qa_step1', 'qa_step2')
    .addEdge('qa_step2', 'qa_step3')
    .addEdge('qa_step3', 'qa_step4')
    .addEdge('qa_step4', 'qa_step5')

    .addEdge('external_step1', 'external_step2')
    .addEdge('external_step2', 'external_step3')

    // ⭐ THE CRITICAL DIFFERENCE: WAIT-FOR-ALL PATTERN ⭐
    // Using an array of nodes makes aggregate_results wait for ALL of them
    .addEdge(['quick_validate', 'process_step3', 'qa_step5', 'external_step3'], 'aggregate_results')

    // End
    .addEdge('aggregate_results', '__end__');

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Demonstration Runner
 */
async function runDemo() {
  console.log('='.repeat(70));
  console.log('🚀 LANGGRAPH WAIT-FOR-ALL AGGREGATION PATTERN');
  console.log('='.repeat(70));
  console.log('\nThis example shows how to make an aggregation node wait for');
  console.log('ALL branches to complete before executing, using the array');
  console.log("syntax: .addEdge([...nodes], 'aggregate')");
  console.log('\nKey difference from default behavior:');
  console.log('- Default: aggregate runs multiple times (once per branch)');
  console.log('- This pattern: aggregate runs ONCE after all branches complete');
  console.log('='.repeat(70));

  const graph = createWaitForAllGraph();
  const threadId = `wait-for-all-${Date.now()}`;

  try {
    const result = await graph.invoke(
      {
        messages: [new HumanMessage('Start pipeline with wait-for-all aggregation')],
      },
      {
        configurable: { thread_id: threadId },
      },
    );

    console.log(`\n${'='.repeat(70)}`);
    console.log('✨ DEMONSTRATION COMPLETE');
    console.log('='.repeat(70));
    console.log('\n📊 RESULTS:');
    console.log(`- The aggregation node ran ${result.aggregationCount} time(s)`);
    console.log(`- All branch results were available in the single execution`);
    console.log(`- Total execution time: ${((Date.now() - result.startTime) / 1000).toFixed(2)}s`);
    console.log('\n💡 KEY PATTERN:');
    console.log("Use .addEdge(['node1', 'node2', ...], 'target') when you need");
    console.log('the target node to wait for ALL specified nodes to complete.');
    console.log('This is perfect for final aggregation, report generation,');
    console.log('or any operation that requires all parallel results.');
    console.log('='.repeat(70));
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * WAIT-FOR-ALL PATTERN REFERENCE
 *
 * SYNTAX:
 * ```typescript
 * .addEdge(["node1", "node2", "node3"], "target_node")
 * ```
 *
 * BEHAVIOR:
 * - target_node waits for ALL nodes in the array to complete
 * - target_node executes ONCE when all are done
 * - All results are available in the single execution
 *
 * USE CASES:
 * 1. Final aggregation after parallel processing
 * 2. Report generation requiring all data
 * 3. Validation that needs results from all branches
 * 4. Cleanup operations after parallel tasks
 * 5. Final state persistence after all updates
 *
 * COMPARISON WITH DEFAULT:
 *
 * Default (Multiple Edges):
 * ```typescript
 * .addEdge("branch1", "aggregate")
 * .addEdge("branch2", "aggregate")
 * .addEdge("branch3", "aggregate")
 * // Result: aggregate runs 3 times
 * ```
 *
 * Wait-For-All (Array Syntax):
 * ```typescript
 * .addEdge(["branch1", "branch2", "branch3"], "aggregate")
 * // Result: aggregate runs 1 time
 * ```
 *
 * HANDLING DYNAMIC BRANCHES:
 * If you have conditional branches, you might need to:
 * 1. Use multiple array edges for different scenarios
 * 2. Have intermediate collection nodes
 * 3. Use conditional edges to route to different aggregators
 *
 * Example with conditional branch:
 * ```typescript
 * // Fixed branches
 * const fixedBranches = ["quick", "process", "qa"];
 *
 * // For a branch that might end at different nodes
 * .addConditionalEdges("external_step2",
 *   (state) => state.needsStep3 ? "external_step3" : "aggregate_ready",
 *   {
 *     "external_step3": "external_step3",
 *     "aggregate_ready": "aggregate_ready"
 *   }
 * )
 *
 * // Then use multiple array edges
 * .addEdge([...fixedBranches, "external_step3"], "aggregate_results")
 * .addEdge([...fixedBranches, "aggregate_ready"], "aggregate_results")
 * ```
 */

// Export for reuse
export { PipelineState, createTimelineEntry };

// Run demo if executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}
