/**
 * LangGraph Parallel Execution Example: Understanding Fan-In Behavior
 * 
 * This example demonstrates a CRITICAL behavior of LangGraph's parallel execution:
 * When multiple branches converge into a single node (fan-in pattern), that node
 * executes MULTIPLE TIMES - once for each incoming branch that completes.
 * 
 * THIS IS BY DESIGN! LangGraph does NOT wait for all branches to complete before
 * executing the fan-in node. Instead, it executes immediately when ANY branch
 * reaches it, and executes again each time another branch completes.
 * 
 * KEY CONCEPTS DEMONSTRATED:
 * 
 * 1. FAN-OUT BEHAVIOR:
 *    - Multiple branches start simultaneously from a single node
 *    - Each branch executes independently and in parallel
 *    - Branches with different lengths complete at different times
 * 
 * 2. FAN-IN BEHAVIOR (CRITICAL TO UNDERSTAND):
 *    - The aggregation node runs MULTIPLE TIMES
 *    - It executes once for EACH incoming branch as it completes
 *    - State is updated incrementally with each execution
 *    - You'll see the aggregation node run N times for N branches
 * 
 * 3. BRANCH ARCHITECTURE:
 *    - Quick Analysis (1 node): Completes first, triggers aggregation #1
 *    - Data Processing (3 nodes): Completes second, triggers aggregation #2
 *    - External Integration (2-4 nodes): Triggers aggregation #3
 *    - Quality Assurance (5 nodes): Completes last, triggers aggregation #4
 * 
 * GRAPH VISUALIZATION:
 * ```
 *                    start_pipeline
 *                          |
 *        +---------+-------+-------+---------+
 *        |         |       |       |         |
 *   quick_validate | process_s1 |  qa_step1  | external_s1
 *        |         |       |       |         |
 *        |         |  process_s2 | qa_step2  | external_s2
 *        |         |       |       |         |
 *        |         |  process_s3 | qa_step3  | [conditional]
 *        |         |       |       |         |
 *        |         |       |       | qa_step4 | external_s3?
 *        |         |       |       |         |
 *        |         |       |       | qa_step5 | external_s4?
 *        |         |       |       |         |
 *        +---------+-------+-------+---------+
 *                          |
 *                  aggregate_results
 *                  (RUNS 4 TIMES!)
 *                          |
 *                       __end__
 * ```
 * 
 * EXPECTED BEHAVIOR:
 * 1. All 4 branches start simultaneously after start_pipeline
 * 2. Quick branch (1 node) finishes first → aggregate_results runs (1st time)
 * 3. Process branch (3 nodes) finishes → aggregate_results runs (2nd time)
 * 4. External branch finishes → aggregate_results runs (3rd time)
 * 5. QA branch (5 nodes) finishes last → aggregate_results runs (4th time)
 * 
 * This is NOT a bug - this is how LangGraph is designed to work!
 */

import {Annotation, CompiledStateGraph, MemorySaver, StateDefinition, StateGraph} from "@langchain/langgraph";
import {AIMessage, BaseMessage, HumanMessage} from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

/**
 * Pipeline State Definition
 * 
 * Notice how we track aggregation_count to clearly show how many times
 * the aggregation node has been executed.
 */
const PipelineState = Annotation.Root({
  // Input data to process
  inputData: Annotation<Record<string, any>>,
  
  // SHARED: Messages with reducer for concurrent updates
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // SHARED: Execution timeline with timestamps
  executionTimeline: Annotation<Array<{
    timestamp: string;
    node: string;
    branch: string;
    message: string;
  }>>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Track how many times aggregation has run (IMPORTANT!)
  aggregationCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  }),
  
  // Track which branches have completed
  completedBranches: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Branch-specific results
  quickValidationResult: Annotation<{
    isValid: boolean;
    issues: string[];
    completedAt: string;
  }>,
  
  dataProcessingResult: Annotation<{
    transformedData: any;
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
    responses: any[];
    completedAt: string;
  }>,
  
  // Variable branch control
  externalIntegrationSteps: Annotation<number>,
  
  // Final aggregated summary
  pipelineSummary: Annotation<string>,
  
  // Performance metrics
  startTime: Annotation<number>,
  branchCompletionTimes: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  })
});

/**
 * Helper function to create timeline entries
 */
function createTimelineEntry(node: string, branch: string, message: string) {
  return {
    timestamp: new Date().toISOString(),
    node,
    branch,
    message
  };
}

/**
 * Start Pipeline Node
 */
async function startPipeline(state: typeof PipelineState.State) {
  const startTime = Date.now();
  
  // Simulate input data
  const inputData = {
    userId: "user123",
    transactionId: "tx456",
    amount: 150.00,
    items: ["item1", "item2", "item3"],
    metadata: {
      source: "web",
      timestamp: new Date().toISOString()
    }
  };
  
  // Randomly determine external integration complexity (2-4 steps)
  const externalSteps = Math.floor(Math.random() * 3) + 2;
  
  console.log("\n🚀 STARTING PARALLEL PIPELINE EXECUTION");
  console.log("=" + "=".repeat(60));
  console.log("📋 Configuration:");
  console.log(`- Quick Validation: 1 node`);
  console.log(`- Data Processing: 3 nodes`);
  console.log(`- Quality Assurance: 5 nodes`);
  console.log(`- External Integration: ${externalSteps} nodes (dynamic)`);
  console.log("\n⚠️  IMPORTANT: Watch how the aggregation node runs MULTIPLE times!");
  console.log("This is expected behavior - it runs once for each completing branch.");
  console.log("=" + "=".repeat(60) + "\n");
  
  return {
    inputData,
    startTime,
    externalIntegrationSteps: externalSteps,
    messages: [new AIMessage("Pipeline initialized with parallel branches")],
    executionTimeline: [
      createTimelineEntry("start_pipeline", "MAIN", "Pipeline started")
    ]
  };
}

/**
 * BRANCH 1: Quick Validation (1 node)
 * This will complete first and trigger the FIRST aggregation
 */
async function quickValidate(state: typeof PipelineState.State) {
  const branchStart = Date.now();
  console.log("⚡ [QUICK] Starting validation...");
  
  // Simulate validation logic
  await new Promise(resolve => setTimeout(resolve, 300));
  
  const issues: string[] = [];
  if (state.inputData.amount > 1000) {
    issues.push("High value transaction requires additional review");
  }
  if (!state.inputData.userId) {
    issues.push("Missing user ID");
  }
  
  const completedAt = new Date().toISOString();
  console.log(`✅ [QUICK] Validation complete (${issues.length} issues found)`);
  console.log(`   → This will trigger aggregation execution #1`);
  
  return {
    quickValidationResult: {
      isValid: issues.length === 0,
      issues,
      completedAt
    },
    completedBranches: ["quick"],
    branchCompletionTimes: {
      quick: Date.now() - branchStart
    },
    messages: [new AIMessage(`Quick validation completed with ${issues.length} issues`)],
    executionTimeline: [
      createTimelineEntry("quick_validate", "QUICK", `Completed validation (${issues.length} issues)`)
    ]
  };
}

/**
 * BRANCH 2: Data Processing Pipeline (3 nodes)
 * This will complete second and trigger the SECOND aggregation
 */
async function processStep1(state: typeof PipelineState.State) {
  console.log("🔄 [PROCESS] Step 1/3: Data normalization...");
  await new Promise(resolve => setTimeout(resolve, 400));
  
  return {
    executionTimeline: [
      createTimelineEntry("process_step1", "PROCESS", "Data normalized")
    ]
  };
}

async function processStep2(state: typeof PipelineState.State) {
  console.log("🔄 [PROCESS] Step 2/3: Transformation...");
  await new Promise(resolve => setTimeout(resolve, 400));
  
  return {
    executionTimeline: [
      createTimelineEntry("process_step2", "PROCESS", "Data transformed")
    ]
  };
}

async function processStep3(state: typeof PipelineState.State) {
  const branchStart = Date.now() - 800; // Account for previous steps
  console.log("🔄 [PROCESS] Step 3/3: Finalization...");
  await new Promise(resolve => setTimeout(resolve, 400));
  
  const transformedData = {
    ...state.inputData,
    processed: true,
    normalizedAmount: state.inputData.amount / 100,
    itemCount: state.inputData.items.length
  };
  
  console.log("✅ [PROCESS] Data processing complete");
  console.log(`   → This will trigger aggregation execution #2`);
  
  return {
    dataProcessingResult: {
      transformedData,
      processingSteps: ["normalize", "transform", "finalize"],
      completedAt: new Date().toISOString()
    },
    completedBranches: ["process"],
    branchCompletionTimes: {
      process: Date.now() - branchStart
    },
    messages: [new AIMessage("Data processing pipeline completed")],
    executionTimeline: [
      createTimelineEntry("process_step3", "PROCESS", "Processing complete")
    ]
  };
}

/**
 * BRANCH 3: Quality Assurance (5 nodes)
 * This will complete last and trigger the FINAL aggregation
 */
async function qaStep1(state: typeof PipelineState.State) {
  console.log("🔍 [QA] Step 1/5: Schema validation...");
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return {
    executionTimeline: [
      createTimelineEntry("qa_step1", "QA", "Schema validated")
    ]
  };
}

async function qaStep2(state: typeof PipelineState.State) {
  console.log("🔍 [QA] Step 2/5: Business rules check...");
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return {
    executionTimeline: [
      createTimelineEntry("qa_step2", "QA", "Business rules verified")
    ]
  };
}

async function qaStep3(state: typeof PipelineState.State) {
  console.log("🔍 [QA] Step 3/5: Data integrity check...");
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return {
    executionTimeline: [
      createTimelineEntry("qa_step3", "QA", "Data integrity confirmed")
    ]
  };
}

async function qaStep4(state: typeof PipelineState.State) {
  console.log("🔍 [QA] Step 4/5: Security scan...");
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return {
    executionTimeline: [
      createTimelineEntry("qa_step4", "QA", "Security scan passed")
    ]
  };
}

async function qaStep5(state: typeof PipelineState.State) {
  const branchStart = Date.now() - 800; // Account for previous steps
  console.log("🔍 [QA] Step 5/5: Final QA report...");
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const qaChecks = {
    schemaValid: true,
    businessRulesPass: true,
    dataIntegrity: true,
    securityPass: true,
    performanceAcceptable: true
  };
  
  const qaScore = Object.values(qaChecks).filter(v => v).length / Object.keys(qaChecks).length * 100;
  
  console.log(`✅ [QA] Quality assurance complete (Score: ${qaScore}%)`);
  console.log(`   → This will trigger aggregation execution #4 (final)`);
  
  return {
    qualityAssuranceResult: {
      qaChecks,
      qaScore,
      recommendations: qaScore < 100 ? ["Review failed checks"] : ["All checks passed"],
      completedAt: new Date().toISOString()
    },
    completedBranches: ["qa"],
    branchCompletionTimes: {
      qa: Date.now() - branchStart
    },
    messages: [new AIMessage(`QA completed with score: ${qaScore}%`)],
    executionTimeline: [
      createTimelineEntry("qa_step5", "QA", `QA complete (Score: ${qaScore}%)`)
    ]
  };
}

/**
 * BRANCH 4: External Integration (2-4 nodes, dynamic)
 * This will complete third and trigger the THIRD aggregation
 */
async function externalStep1(state: typeof PipelineState.State) {
  console.log(`🌐 [EXTERNAL] Step 1/${state.externalIntegrationSteps}: Auth check...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return {
    executionTimeline: [
      createTimelineEntry("external_step1", "EXTERNAL", "Authentication verified")
    ]
  };
}

async function externalStep2(state: typeof PipelineState.State) {
  console.log(`🌐 [EXTERNAL] Step 2/${state.externalIntegrationSteps}: Primary API call...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const isLastStep = state.externalIntegrationSteps === 2;
  
  if (isLastStep) {
    const branchStart = Date.now() - 1000;
    console.log("✅ [EXTERNAL] Integration complete");
    console.log(`   → This will trigger aggregation execution #3`);
    
    return {
      externalIntegrationResult: {
        apiCalls: ["auth", "primary"],
        responses: [{ status: "ok" }, { data: "processed" }],
        completedAt: new Date().toISOString()
      },
      completedBranches: ["external"],
      branchCompletionTimes: {
        external: Date.now() - branchStart
      },
      messages: [new AIMessage("External integration completed (2 API calls)")],
      executionTimeline: [
        createTimelineEntry("external_step2", "EXTERNAL", "Integration complete")
      ]
    };
  }
  
  return {
    executionTimeline: [
      createTimelineEntry("external_step2", "EXTERNAL", "Primary API success")
    ]
  };
}

async function externalStep3(state: typeof PipelineState.State) {
  console.log(`🌐 [EXTERNAL] Step 3/${state.externalIntegrationSteps}: Secondary API call...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const isLastStep = state.externalIntegrationSteps === 3;
  
  if (isLastStep) {
    const branchStart = Date.now() - 1500;
    console.log("✅ [EXTERNAL] Integration complete");
    console.log(`   → This will trigger aggregation execution #3`);
    
    return {
      externalIntegrationResult: {
        apiCalls: ["auth", "primary", "secondary"],
        responses: [{ status: "ok" }, { data: "processed" }, { extra: "data" }],
        completedAt: new Date().toISOString()
      },
      completedBranches: ["external"],
      branchCompletionTimes: {
        external: Date.now() - branchStart
      },
      messages: [new AIMessage("External integration completed (3 API calls)")],
      executionTimeline: [
        createTimelineEntry("external_step3", "EXTERNAL", "Integration complete")
      ]
    };
  }
  
  return {
    executionTimeline: [
      createTimelineEntry("external_step3", "EXTERNAL", "Secondary API success")
    ]
  };
}

async function externalStep4(state: typeof PipelineState.State) {
  const branchStart = Date.now() - 2000;
  console.log(`🌐 [EXTERNAL] Step 4/${state.externalIntegrationSteps}: Webhook notification...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log("✅ [EXTERNAL] Integration complete");
  console.log(`   → This will trigger aggregation execution #3`);
  
  return {
    externalIntegrationResult: {
      apiCalls: ["auth", "primary", "secondary", "webhook"],
      responses: [{ status: "ok" }, { data: "processed" }, { extra: "data" }, { notified: true }],
      completedAt: new Date().toISOString()
    },
    completedBranches: ["external"],
    branchCompletionTimes: {
      external: Date.now() - branchStart
    },
    messages: [new AIMessage("External integration completed (4 API calls)")],
    executionTimeline: [
      createTimelineEntry("external_step4", "EXTERNAL", "Integration complete")
    ]
  };
}

/**
 * CRITICAL NODE: Aggregate Results
 * 
 * This node demonstrates the FAN-IN BEHAVIOR of LangGraph:
 * - It runs MULTIPLE TIMES (once for each branch that completes)
 * - It does NOT wait for all branches to complete before running
 * - Each execution has access to the current state (partial results)
 * 
 * In this example, it will run 4 times:
 * 1. When Quick Validation completes (fastest)
 * 2. When Data Processing completes
 * 3. When External Integration completes
 * 4. When Quality Assurance completes (slowest)
 */
async function aggregateResults(state: typeof PipelineState.State) {
  // Increment aggregation count to track executions
  const currentExecution = state.aggregationCount + 1;
  const totalTime = Date.now() - state.startTime;
  
  console.log("\n" + "=".repeat(60));
  console.log(`🔄 AGGREGATION NODE EXECUTION #${currentExecution} of 4`);
  console.log("=".repeat(60));
  console.log(`⏱️  Time since start: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`📊 Branches completed so far: ${state.completedBranches.join(", ")}`);
  
  // Show which results are available at this execution
  const availableResults = [];
  if (state.quickValidationResult) availableResults.push("Quick Validation ✓");
  if (state.dataProcessingResult) availableResults.push("Data Processing ✓");
  if (state.externalIntegrationResult) availableResults.push("External Integration ✓");
  if (state.qualityAssuranceResult) availableResults.push("Quality Assurance ✓");
  
  console.log(`📋 Available results at this execution:`);
  availableResults.forEach(r => console.log(`   - ${r}`));
  
  // Show what's still pending
  const pendingBranches = [];
  if (!state.quickValidationResult) pendingBranches.push("Quick Validation");
  if (!state.dataProcessingResult) pendingBranches.push("Data Processing");
  if (!state.externalIntegrationResult) pendingBranches.push("External Integration");
  if (!state.qualityAssuranceResult) pendingBranches.push("Quality Assurance");
  
  if (pendingBranches.length > 0) {
    console.log(`⏳ Still waiting for:`);
    pendingBranches.forEach(b => console.log(`   - ${b}`));
  }
  
  // Create a summary based on what's available
  const summary = `
Aggregation Execution #${currentExecution}
Time: ${(totalTime / 1000).toFixed(2)}s
Completed: ${availableResults.length}/4 branches

${state.quickValidationResult ? `✓ Quick Validation: ${state.quickValidationResult.isValid ? "PASSED" : "FAILED"} (${state.quickValidationResult.issues.length} issues)` : '⏳ Quick Validation: Pending'}
${state.dataProcessingResult ? `✓ Data Processing: ${state.dataProcessingResult.processingSteps.length} steps completed` : '⏳ Data Processing: Pending'}
${state.externalIntegrationResult ? `✓ External Integration: ${state.externalIntegrationResult.apiCalls.length} API calls made` : '⏳ External Integration: Pending'}
${state.qualityAssuranceResult ? `✓ Quality Assurance: ${state.qualityAssuranceResult.qaScore}% score` : '⏳ Quality Assurance: Pending'}
`;
  
  console.log(summary);
  
  if (currentExecution === 4) {
    console.log("🎉 This is the FINAL aggregation - all branches have completed!");
    console.log("=".repeat(60) + "\n");
  } else {
    console.log("📝 Note: This aggregation node will run again when the next branch completes.");
    console.log("=".repeat(60) + "\n");
  }
  
  return {
    aggregationCount: 1,
    pipelineSummary: summary,
    messages: [new AIMessage(`Aggregation execution #${currentExecution} completed`)]
  };
}

/**
 * Type Definitions
 */
type PipelineStateType = typeof PipelineState.State;
type PipelineUpdateType = Partial<PipelineStateType>;
type PipelineNodes = 
  | "start_pipeline"
  | "quick_validate"
  | "process_step1" | "process_step2" | "process_step3"
  | "qa_step1" | "qa_step2" | "qa_step3" | "qa_step4" | "qa_step5"
  | "external_step1" | "external_step2" | "external_step3" | "external_step4"
  | "aggregate_results"
  | "__start__";

export type ParallelPipelineGraph = CompiledStateGraph<
  PipelineStateType,
  PipelineUpdateType,
  PipelineNodes,
  typeof PipelineState.spec,
  typeof PipelineState.spec,
  StateDefinition
>;

/**
 * Create the Parallel Pipeline Graph
 * 
 * CRITICAL: Notice the FAN-IN pattern where all branches connect to aggregate_results.
 * This means aggregate_results will execute ONCE for EACH branch that completes,
 * NOT once after all branches complete!
 */
export function createParallelPipelineGraph(): ParallelPipelineGraph {
  const workflow = new StateGraph(PipelineState)
    // Initialize
    .addNode("start_pipeline", startPipeline)
    
    // Branch 1: Quick Validation (1 node)
    .addNode("quick_validate", quickValidate)
    
    // Branch 2: Data Processing (3 nodes)
    .addNode("process_step1", processStep1)
    .addNode("process_step2", processStep2)
    .addNode("process_step3", processStep3)
    
    // Branch 3: Quality Assurance (5 nodes)
    .addNode("qa_step1", qaStep1)
    .addNode("qa_step2", qaStep2)
    .addNode("qa_step3", qaStep3)
    .addNode("qa_step4", qaStep4)
    .addNode("qa_step5", qaStep5)
    
    // Branch 4: External Integration (2-4 nodes)
    .addNode("external_step1", externalStep1)
    .addNode("external_step2", externalStep2)
    .addNode("external_step3", externalStep3)
    .addNode("external_step4", externalStep4)
    
    // Aggregation - RUNS MULTIPLE TIMES!
    .addNode("aggregate_results", aggregateResults)
    
    // === EDGES ===
    
    // Start flow
    .addEdge("__start__", "start_pipeline")
    
    // FAN-OUT: All branches start simultaneously
    .addEdge("start_pipeline", "quick_validate")
    .addEdge("start_pipeline", "process_step1")
    .addEdge("start_pipeline", "qa_step1")
    .addEdge("start_pipeline", "external_step1")
    
    // Branch 1 flow (direct to aggregate)
    .addEdge("quick_validate", "aggregate_results")
    
    // Branch 2 flow (sequential steps)
    .addEdge("process_step1", "process_step2")
    .addEdge("process_step2", "process_step3")
    .addEdge("process_step3", "aggregate_results")
    
    // Branch 3 flow (sequential steps)
    .addEdge("qa_step1", "qa_step2")
    .addEdge("qa_step2", "qa_step3")
    .addEdge("qa_step3", "qa_step4")
    .addEdge("qa_step4", "qa_step5")
    .addEdge("qa_step5", "aggregate_results")
    
    // Branch 4 flow (conditional length)
    .addEdge("external_step1", "external_step2")
    .addConditionalEdges(
      "external_step2",
      (state) => state.externalIntegrationSteps === 2 ? "aggregate_results" : "external_step3",
      {
        "aggregate_results": "aggregate_results",
        "external_step3": "external_step3"
      }
    )
    .addConditionalEdges(
      "external_step3",
      (state) => state.externalIntegrationSteps === 3 ? "aggregate_results" : "external_step4",
      {
        "aggregate_results": "aggregate_results",
        "external_step4": "external_step4"
      }
    )
    .addEdge("external_step4", "aggregate_results")
    
    // End
    .addEdge("aggregate_results", "__end__");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Demonstration Runner
 */
async function runDemo() {
  console.log("=".repeat(70));
  console.log("🚀 LANGGRAPH FAN-IN BEHAVIOR DEMONSTRATION");
  console.log("=".repeat(70));
  console.log("\nThis example demonstrates a CRITICAL LangGraph behavior:");
  console.log("When multiple branches converge into a single node (fan-in),");
  console.log("that node executes MULTIPLE TIMES - once for each branch!");
  console.log("\nWatch carefully as the aggregation node runs 4 separate times.");
  console.log("=".repeat(70));
  
  const graph = createParallelPipelineGraph();
  const threadId = `parallel-demo-${Date.now()}`;
  
  try {
    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Start parallel pipeline execution")]
      },
      {
        configurable: { thread_id: threadId }
      }
    );
    
    console.log("\n" + "=".repeat(70));
    console.log("✨ DEMONSTRATION COMPLETE");
    console.log("=".repeat(70));
    console.log("\n📊 FINAL SUMMARY:");
    console.log(`- The aggregation node ran ${result.aggregationCount} times`);
    console.log(`- Each execution processed partial results as branches completed`);
    console.log(`- This is the intended behavior of LangGraph's fan-in pattern!`);
    console.log("\n💡 KEY TAKEAWAY:");
    console.log("In LangGraph, a fan-in node does NOT wait for all inputs.");
    console.log("It executes immediately when ANY input arrives, and again");
    console.log("for each subsequent input. Design your aggregation logic");
    console.log("accordingly to handle incremental updates!");
    console.log("=".repeat(70));
    
  } catch (error) {
    console.error("Error:", error);
  }
}

/**
 * UNDERSTANDING LANGGRAPH'S FAN-IN BEHAVIOR
 * 
 * This is a fundamental difference from other workflow engines:
 * 
 * 1. TRADITIONAL WORKFLOW ENGINES (Join/Barrier Pattern):
 *    - Fan-in nodes wait for ALL incoming branches
 *    - Execute ONCE when all branches complete
 *    - Example: "Wait for all parallel tasks to finish, then aggregate"
 * 
 * 2. LANGGRAPH (Streaming Pattern):
 *    - Fan-in nodes execute IMMEDIATELY when ANY branch arrives
 *    - Execute AGAIN for each additional branch
 *    - Example: "Process results as they arrive, update incrementally"
 * 
 * WHY THIS DESIGN?
 * - Enables real-time streaming of results
 * - Allows for progressive updates and partial results
 * - More flexible for different aggregation strategies
 * - Better for long-running processes where you want early feedback
 * 
 * IMPLICATIONS FOR YOUR DESIGN:
 * - Your aggregation nodes must handle partial data gracefully
 * - Use state to track which branches have completed
 * - Consider if you need to differentiate between partial and final results
 * - Leverage reducers for accumulating results across executions
 * 
 * COMMON PATTERNS:
 * 
 * 1. Incremental Aggregation:
 *    ```typescript
 *    function aggregate(state) {
 *      const completed = state.completedBranches.length;
 *      const total = 4; // known number of branches
 *      
 *      if (completed < total) {
 *        return { status: "partial", progress: `${completed}/${total}` };
 *      } else {
 *        return { status: "complete", finalResult: computeFinal(state) };
 *      }
 *    }
 *    ```
 * 
 * 2. Streaming Updates:
 *    ```typescript
 *    function aggregate(state) {
 *      // Process whatever is available
 *      const currentResults = processAvailableData(state);
 *      
 *      // Stream update to user
 *      return {
 *        streamUpdate: currentResults,
 *        isComplete: state.completedBranches.length === expectedBranches
 *      };
 *    }
 *    ```
 * 
 * 3. Conditional Final Processing:
 *    ```typescript
 *    function aggregate(state) {
 *      // Always update partial results
 *      updatePartialResults(state);
 *      
 *      // Only run expensive final processing when all complete
 *      if (allBranchesComplete(state)) {
 *        return runFinalProcessing(state);
 *      }
 *      
 *      return state;
 *    }
 *    ```
 */

// Export components for reuse
export { PipelineState, createTimelineEntry };

// Run demo if executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}
