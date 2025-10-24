/**
 * LangGraph State Memory Management Example
 * 
 * This example demonstrates memory management techniques in LangGraph
 * using custom reducers and state patterns to prevent memory bloat.
 * 
 * Key Concepts Demonstrated:
 * 1. Memory-Limited Reducers - Prevent unbounded state growth
 * 2. Clearable Reducers - Clear data after processing
 * 3. Subgraph State Segmentation - Isolate memory between stages
 * 4. Batch Processing - Process data in manageable chunks
 * 5. Memory Usage Monitoring - Track memory throughout execution
 * 
 * The example shows multiple patterns you can use to manage memory
 * when processing large datasets through pipeline stages.
 */

import {Annotation, MemorySaver, StateGraph} from "@langchain/langgraph";
import {AIMessage, BaseMessage, HumanMessage} from "@langchain/core/messages";
import dotenv from "dotenv";
import {randomBytes} from "crypto";

dotenv.config();

// Helper to log memory usage
function logMemoryUsage(label: string) {
  const used = process.memoryUsage();
  console.log(`\n💾 [${label}] Memory Usage:`);
  console.log(`   - RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Total: ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - External: ${(used.external / 1024 / 1024).toFixed(2)} MB`);
}

// Helper to generate large data
function generateLargeData(sizeMB: number): Buffer {
  console.log(`\n🔄 Generating ${sizeMB}MB of test data...`);
  const sizeBytes = sizeMB * 1024 * 1024;
  return randomBytes(sizeBytes);
}

/**
 * PATTERN 1: Memory-Limited Reducer
 * 
 * This reducer limits array growth by keeping only the most recent N items.
 * Use this for logs, messages, or any accumulating data.
 * 
 * PROS:
 * - Prevents unbounded memory growth
 * - Simple to implement and understand
 * - Keeps most recent/relevant data
 * - Works well for logs, chat history, event streams
 * 
 * CONS:
 * - Loses older data (not suitable if you need full history)
 * - Fixed window size may not adapt to varying needs
 * - Still keeps N items in memory (choose N wisely)
 * 
 * WHEN TO USE:
 * - Chat message history
 * - Recent error logs
 * - Rolling metrics/statistics
 * - Any append-only data where recent items are most valuable
 */
const memoryLimitedReducer = (maxItems: number) => {
  return (current: any[], update: any[]) => {
    const combined = current.concat(update);
    if (combined.length <= maxItems) {
      return combined;
    }
    console.log(`\n⚠️  Memory limit: keeping only last ${maxItems} of ${combined.length} items`);
    return combined.slice(-maxItems);
  };
};

/**
 * PATTERN 2: Clearable Reducer
 * 
 * This reducer allows clearing data by sending a "CLEAR" signal.
 * Use this for temporary data that should be cleaned up between stages.
 * 
 * PROS:
 * - Explicit control over when memory is freed
 * - Can completely remove large objects from state
 * - Clear semantic meaning with "CLEAR" signal
 * - Helps garbage collector by removing references
 * 
 * CONS:
 * - Requires manual memory management
 * - Risk of clearing data too early if not careful
 * - Need to handle null checks in subsequent nodes
 * - "CLEAR" string is a magic value (could use enum/const)
 * 
 * WHEN TO USE:
 * - Stage-specific temporary data
 * - Large buffers/files that are processed and no longer needed
 * - Intermediate computation results
 * - Any data with a clear lifecycle
 */
const clearableReducer = (current: any, update: any) => {
  if (update === "CLEAR") {
    console.log("🧹 Clearing data from state");
    return null;
  }
  return update;
};

/**
 * Example 1: Simple Memory-Managed Pipeline
 * 
 * Shows basic patterns for managing memory in a linear pipeline.
 * 
 * APPROACH: Combines clearable and memory-limited reducers in a single pipeline
 * 
 * PROS:
 * - Simple to understand and implement
 * - Clear separation between temporary and persistent data
 * - Automatic cleanup between stages
 * - Good for linear workflows
 * 
 * CONS:
 * - All nodes share the same state structure
 * - No isolation between stages
 * - Manual coordination of when to clear data
 * - Not suitable for parallel processing
 * 
 * BEST FOR:
 * - Simple ETL pipelines
 * - Sequential data processing
 * - Workflows with clear stages
 */
const SimplePipelineState = Annotation.Root({
  stage: Annotation<string>,
  
  // Large data that gets cleared
  largeData: Annotation<Buffer | null>({
    reducer: clearableReducer,
    default: () => null
  }),
  
  // Results with memory limit
  results: Annotation<any[]>({
    reducer: memoryLimitedReducer(10),
    default: () => []
  }),
  
  // Message history with limit
  messages: Annotation<BaseMessage[]>({
    reducer: memoryLimitedReducer(5),
    default: () => []
  })
});

async function generateData(state: typeof SimplePipelineState.State) {
  console.log("\n📊 Generating large dataset...");
  logMemoryUsage("Before Generation");
  
  const data = generateLargeData(20);
  
  logMemoryUsage("After Generation");
  
  // NOTE: We're storing the entire buffer in state
  // This will persist until explicitly cleared
  return {
    stage: "process",
    largeData: data,
    messages: [new AIMessage("Generated 20MB of data")]
  };
}

async function processData(state: typeof SimplePipelineState.State) {
  console.log("\n⚙️  Processing data...");
  
  if (!state.largeData) {
    return { messages: [new AIMessage("No data to process")] };
  }
  
  // PATTERN: Extract features instead of keeping raw data
  // We process the 20MB buffer but only keep small results
  const results = [];
  for (let i = 0; i < 20; i++) {
    results.push({
      id: i,
      value: Math.random() * 100,
      timestamp: new Date().toISOString()
    });
  }
  
  // NOTE: largeData is still in state at this point!
  // The memory-limited reducer will keep only last 10 results
  return {
    stage: "cleanup",
    results,
    messages: [new AIMessage(`Processed data and extracted ${results.length} results`)]
  };
}

async function cleanupData(state: typeof SimplePipelineState.State) {
  console.log("\n🧹 Cleaning up large data...");
  logMemoryUsage("Before Cleanup");
  
  // CRITICAL: Send "CLEAR" signal to remove large buffer from state
  // Without this, the 20MB would stay in memory forever
  const newState = {
    stage: "done",
    largeData: "CLEAR" as const,
    messages: [new AIMessage("Cleaned up large data, kept only results")]
  };
  
  logMemoryUsage("After Cleanup");
  
  // NOTE: Memory won't immediately drop - Node.js GC is lazy
  // But the reference is gone, so GC can collect when needed
  return newState;
}

export function createSimplePipeline() {
  const workflow = new StateGraph(SimplePipelineState)
    .addNode("generate", generateData)
    .addNode("process", processData)
    .addNode("cleanup", cleanupData)
    
    .addEdge("__start__", "generate")
    .addConditionalEdges("generate", (state) => state.stage)
    .addConditionalEdges("process", (state) => state.stage)
    .addEdge("cleanup", "__end__");
    
  return workflow.compile({ checkpointer: new MemorySaver() });
}

/**
 * Example 2: Subgraph Memory Segmentation
 * 
 * Shows how to use subgraphs with input/output schemas to segment memory.
 * Each subgraph only sees and modifies specific parts of the state.
 * 
 * APPROACH: Use input/output schemas to control state access per subgraph
 * 
 * PROS:
 * - True memory isolation between stages
 * - Subgraphs can't accidentally access/modify unrelated state
 * - Internal state of subgraphs is hidden from parent
 * - Can run subgraphs in parallel without conflicts
 * - Easier to reason about data flow
 * - Reusable subgraph components
 * 
 * CONS:
 * - More complex setup with schemas
 * - Need to carefully design input/output interfaces
 * - Data transformation overhead between subgraphs
 * - Can be overkill for simple pipelines
 * 
 * BEST FOR:
 * - Complex multi-stage pipelines
 * - Parallel processing workflows
 * - When you need strict data isolation
 * - Reusable pipeline components
 * - Team development (clear interfaces)
 */
const MasterState = Annotation.Root({
  // Shared configuration
  config: Annotation<{ chunkSize: number }>,
  
  // Stage-specific data (cleared between stages)
  stageData: Annotation<any>({
    reducer: clearableReducer,
    default: () => null
  }),
  
  // Accumulated results
  summary: Annotation<{
    stage1Results: number;
    stage2Results: number;
    totalProcessed: number;
  }>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({
      stage1Results: 0,
      stage2Results: 0,
      totalProcessed: 0
    })
  }),
  
  messages: Annotation<BaseMessage[]>({
    reducer: memoryLimitedReducer(10),
    default: () => []
  })
});

// Stage 1 Subgraph: Only sees config, writes to stageData and summary
const Stage1InputSchema = Annotation.Root({
  config: Annotation<{ chunkSize: number }>
});

const Stage1OutputSchema = Annotation.Root({
  stageData: Annotation<any>,
  summary: Annotation<{ stage1Results: number }>,
  messages: Annotation<BaseMessage[]>
});

async function stage1Process(state: typeof Stage1InputSchema.State) {
  console.log("\n🔵 Stage 1: Processing with limited state access");
  logMemoryUsage("Stage 1 Start");
  
  // IMPORTANT: This 30MB buffer exists only in subgraph scope
  // Parent graph never sees this data!
  const localData = generateLargeData(30);
  
  // Process and extract only essential info
  const results = localData.length / (1024 * 1024);
  
  logMemoryUsage("Stage 1 End");
  
  // PATTERN: Return only what's defined in output schema
  // The 30MB localData is NOT passed to parent, only the size number
  return {
    stageData: { stage1Complete: true, size: results },
    summary: { stage1Results: results },
    messages: [new AIMessage(`Stage 1 processed ${results}MB`)]
  };
  // localData goes out of scope here and can be GC'd
}

function createStage1Subgraph() {
  const workflow = new StateGraph({
    input: Stage1InputSchema,
    output: Stage1OutputSchema,
    stateSchema: Stage1InputSchema
  })
    .addNode("process", stage1Process)
    .addEdge("__start__", "process")
    .addEdge("process", "__end__");
    
  return workflow.compile();
}

// Stage 2 Subgraph: Different input/output access
const Stage2InputSchema = Annotation.Root({
  stageData: Annotation<any>,
  summary: Annotation<any>
});

const Stage2OutputSchema = Annotation.Root({
  stageData: Annotation<"CLEAR">,  // Clear after processing
  summary: Annotation<{ stage2Results: number; totalProcessed: number }>,
  messages: Annotation<BaseMessage[]>
});

async function stage2Process(state: typeof Stage2InputSchema.State) {
  console.log("\n🟢 Stage 2: Processing with different state access");
  logMemoryUsage("Stage 2 Start");
  
  // Use data from stage 1
  const stage1Size = state.stageData?.size || 0;
  
  // Generate more data locally (again, isolated to this subgraph)
  const localData = generateLargeData(20);
  const results = localData.length / (1024 * 1024);
  
  logMemoryUsage("Stage 2 End");
  
  // PATTERN: Clear shared state while returning results
  // This prevents stageData from accumulating across stages
  return {
    stageData: "CLEAR" as "CLEAR",  // Clear the shared temporary data
    summary: {
      stage2Results: results,
      totalProcessed: stage1Size + results
    },
    messages: [new AIMessage(`Stage 2 processed ${results}MB`)]
  };
  // localData (20MB) is GC'd, stageData is cleared
}

function createStage2Subgraph() {
  const workflow = new StateGraph({
    input: Stage2InputSchema,
    output: Stage2OutputSchema,
    stateSchema: Stage2InputSchema
  })
    .addNode("process", stage2Process)
    .addEdge("__start__", "process")
    .addEdge("process", "__end__");
    
  return workflow.compile();
}

export function createSegmentedPipeline() {
  const stage1 = createStage1Subgraph();
  const stage2 = createStage2Subgraph();
  
  const workflow = new StateGraph(MasterState)
    .addNode("init", async (state) => ({
      config: { chunkSize: 5 },
      messages: [new AIMessage("Starting segmented pipeline")]
    }))
    
    .addNode("stage1", async (state) => {
      const result = await stage1.invoke(state);
      return result;
    })
    
    .addNode("stage2", async (state) => {
      const result = await stage2.invoke(state);
      return result;
    })
    
    .addNode("finalize", async (state) => {
      console.log("\n📊 Final Summary");
      logMemoryUsage("Final");
      
      return {
        messages: [new AIMessage(
          `Pipeline complete: Stage 1 (${state.summary.stage1Results}MB) + ` +
          `Stage 2 (${state.summary.stage2Results}MB) = ` +
          `${state.summary.totalProcessed}MB total`
        )]
      };
    })
    
    .addEdge("__start__", "init")
    .addEdge("init", "stage1")
    .addEdge("stage1", "stage2")
    .addEdge("stage2", "finalize")
    .addEdge("finalize", "__end__");
    
  return workflow.compile({ checkpointer: new MemorySaver() });
}

/**
 * Example 3: Batch Processing Pattern
 * 
 * Process data in batches to control memory usage.
 * 
 * APPROACH: Load and process data in fixed-size batches, clearing each after processing
 * 
 * PROS:
 * - Predictable memory usage (only one batch at a time)
 * - Can handle datasets larger than available memory
 * - Natural checkpoint boundaries (per batch)
 * - Easy to parallelize (process multiple batches concurrently)
 * - Good for progress tracking
 * 
 * CONS:
 * - Overhead of loading/unloading batches
 * - Need to manage batch boundaries and state
 * - May be slower than processing all at once
 * - Complex error handling (partial batch failures)
 * 
 * BEST FOR:
 * - Large file processing
 * - Database ETL operations
 * - Stream processing
 * - When data size exceeds memory
 * - Progress reporting requirements
 */
const BatchProcessingState = Annotation.Root({
  // Total items to process
  totalItems: Annotation<number>,
  batchSize: Annotation<number>,
  currentBatch: Annotation<number>,
  
  // Current batch data (cleared after each batch)
  batchData: Annotation<any[] | null>({
    reducer: clearableReducer,
    default: () => null
  }),
  
  // Accumulated results
  processedCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  }),
  
  messages: Annotation<BaseMessage[]>({
    reducer: memoryLimitedReducer(10),
    default: () => []
  })
});

async function loadBatch(state: typeof BatchProcessingState.State) {
  const batchStart = state.currentBatch * state.batchSize;
  const batchEnd = Math.min(batchStart + state.batchSize, state.totalItems);
  
  console.log(`\n📦 Loading batch ${state.currentBatch + 1}: items ${batchStart}-${batchEnd}`);
  
  // PATTERN: Load only what can fit in memory at once
  // If batchSize=3, we load 3MB instead of entire dataset
  const batchData = Array(batchEnd - batchStart).fill(0).map((_, i) => ({
    id: batchStart + i,
    data: generateLargeData(1) // 1MB per item
  }));
  
  // TRADE-OFF: More batches = less memory but more overhead
  return {
    batchData,
    messages: [new AIMessage(`Loaded batch with ${batchData.length} items`)]
  };
}

async function processBatch(state: typeof BatchProcessingState.State) {
  if (!state.batchData) {
    return { messages: [new AIMessage("No batch to process")] };
  }
  
  console.log(`⚙️  Processing ${state.batchData.length} items...`);
  
  // Process items (extract only essential data)
  let processed = 0;
  for (const item of state.batchData) {
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 10));
    processed++;
  }
  
  // CRITICAL: Clear batch data after processing
  // This ensures only one batch is in memory at a time
  return {
    processedCount: processed,  // Accumulate count
    batchData: "CLEAR" as const,  // Free the batch memory
    currentBatch: state.currentBatch + 1,
    messages: [new AIMessage(`Processed ${processed} items`)]
  };
  // Next iteration will load a fresh batch
}

export function createBatchProcessor() {
  const workflow = new StateGraph(BatchProcessingState)
    .addNode("load", loadBatch)
    .addNode("process", processBatch)
    
    .addEdge("__start__", "load")
    .addEdge("load", "process")
    .addConditionalEdges("process", (state) => {
      const hasMore = state.currentBatch * state.batchSize < state.totalItems;
      return hasMore ? "load" : "__end__";
    });
    
  return workflow.compile({ checkpointer: new MemorySaver() });
}

/**
 * Demo Runner
 */
async function runAllExamples() {
  console.log("=== 🧠 LangGraph Memory Management Examples ===\n");
  
  // Example 1: Simple Pipeline
  console.log("\n" + "=".repeat(60));
  console.log("📌 Example 1: Simple Memory-Managed Pipeline");
  console.log("=".repeat(60));
  
  const simplePipeline = createSimplePipeline();
  const result1 = await simplePipeline.invoke(
    { 
      stage: "start",
      messages: [new HumanMessage("Process data with memory management")] 
    },
    { configurable: { thread_id: "simple-demo" } }
  );
  
  console.log("\n✅ Simple Pipeline Complete");
  console.log(`- Large data cleared: ${result1.largeData === null ? "✅" : "❌"}`);
  console.log(`- Results kept: ${result1.results.length}`);
  console.log(`- Messages kept: ${result1.messages.length} (limited)`);
  
  // Example 2: Segmented Pipeline
  console.log("\n\n" + "=".repeat(60));
  console.log("📌 Example 2: Subgraph Memory Segmentation");
  console.log("=".repeat(60));
  
  const segmentedPipeline = createSegmentedPipeline();
  const result2 = await segmentedPipeline.invoke(
    { messages: [new HumanMessage("Process with subgraph segmentation")] },
    { configurable: { thread_id: "segmented-demo" } }
  );
  
  console.log("\n✅ Segmented Pipeline Complete");
  console.log(`- Stage data cleared: ${result2.stageData === null ? "✅" : "❌"}`);
  console.log(`- Total processed: ${result2.summary.totalProcessed}MB`);
  
  // Example 3: Batch Processing
  console.log("\n\n" + "=".repeat(60));
  console.log("📌 Example 3: Batch Processing Pattern");
  console.log("=".repeat(60));
  
  const batchProcessor = createBatchProcessor();
  const result3 = await batchProcessor.invoke(
    {
      totalItems: 10,
      batchSize: 3,
      currentBatch: 0,
      messages: [new HumanMessage("Process 10 items in batches of 3")]
    },
    { configurable: { thread_id: "batch-demo" } }
  );
  
  console.log("\n✅ Batch Processing Complete");
  console.log(`- Processed: ${result3.processedCount} items`);
  console.log(`- Batch data cleared: ${result3.batchData === null ? "✅" : "❌"}`);
  
  // Final memory state
  console.log("\n" + "=".repeat(60));
  logMemoryUsage("All Examples Complete");
  
  console.log("\n🎯 Key Takeaways:");
  console.log("1. Use memory-limited reducers for accumulating data");
  console.log("2. Use clearable reducers for temporary data");
  console.log("3. Use subgraphs to segment memory access");
  console.log("4. Process large datasets in batches");
  console.log("5. Monitor memory usage throughout execution");
  
  console.log("\n📊 Pattern Comparison:");
  console.log("┌─────────────────────┬────────────────┬─────────────────┬──────────────┐");
  console.log("│ Pattern             │ Memory Control │ Complexity      │ Best Use Case│");
  console.log("├─────────────────────┼────────────────┼─────────────────┼──────────────┤");
  console.log("│ Simple Pipeline     │ Medium         │ Low             │ Linear ETL   │");
  console.log("│ Subgraph Isolation  │ High           │ High            │ Complex/Team │");
  console.log("│ Batch Processing    │ Very High      │ Medium          │ Large Data   │");
  console.log("└─────────────────────┴────────────────┴─────────────────┴──────────────┘");
  
  console.log("\n💡 Memory Management Decision Tree:");
  console.log("1. Is your data larger than available memory?");
  console.log("   → YES: Use Batch Processing");
  console.log("   → NO: Continue to #2");
  console.log("2. Do you need stage isolation or parallel processing?");
  console.log("   → YES: Use Subgraph Segmentation");
  console.log("   → NO: Use Simple Pipeline with reducers");
  console.log("3. Always use memory-limited reducers for logs/messages");
  console.log("4. Always clear temporary data between stages");
}

if (require.main === module) {
  runAllExamples().catch(console.error);
}
