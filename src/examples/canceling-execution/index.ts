/**
 * LangGraph Aborting Execution Example
 * 
 * This example demonstrates how to cancel/abort a running graph execution
 * using AbortController and signal support in LangGraph.
 * 
 * Key concepts covered:
 * 1. Using AbortController to create cancellable operations
 * 2. Passing abort signals to graph.invoke() and graph.stream()
 * 3. Handling abort errors gracefully
 * 4. Understanding when and how graph execution stops
 * 
 * The graph simulates a long-running process with multiple steps that can
 * be interrupted at any point during execution.
 * 
 * IMPORTANT: Abort support requires @langchain/core>=0.2.20
 */

import { 
  Annotation, 
  CompiledStateGraph, 
  MemorySaver, 
  StateGraph 
} from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

/**
 * State definition for our processing pipeline
 * 
 * This state tracks:
 * - messages: Communication history (with reducer for accumulation)
 * - currentStep: Which step we're currently on
 * - processedData: Data being processed (with reducer for accumulation)
 * - isComplete: Whether the entire pipeline has finished
 */
const ProcessingState = Annotation.Root({
  // Messages accumulate across all nodes
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Simple string to track current step
  currentStep: Annotation<string>,
  
  // Processed data accumulates as we go
  processedData: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Boolean flag for completion status
  isComplete: Annotation<boolean>
});

/**
 * Node 1: Simulates data fetching that takes time
 * 
 * This node demonstrates:
 * - Long-running operations (5 seconds total)
 * - Multiple async steps that can be interrupted
 * - State updates after completion
 * 
 * When aborted, execution will stop at the next await point
 */
async function fetchData(state: typeof ProcessingState.State) {
  console.log("📡 [Step 1] Starting data fetch...");
  
  // Simulate fetching data in 5 batches, 1 second each
  // The abort signal is checked between each await
  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`   Fetching batch ${i}/5...`);
  }
  
  console.log("✅ Data fetch complete!");
  
  // Return state updates
  return {
    currentStep: "fetched",
    processedData: ["batch1", "batch2", "batch3", "batch4", "batch5"],
    messages: [new AIMessage("Data fetching completed successfully")]
  };
}

/**
 * Node 2: Processes the fetched data
 * 
 * This node:
 * - Depends on data from the previous node
 * - Takes 4 seconds total (800ms per batch)
 * - Transforms the data by adding a prefix
 * 
 * Shows how abort works in the middle of a graph execution
 */
async function processData(state: typeof ProcessingState.State) {
  console.log("⚙️  [Step 2] Starting data processing...");
  
  // Process each batch with 800ms delay
  // Abort can interrupt between any of these operations
  for (let i = 0; i < state.processedData.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`   Processing ${state.processedData[i]}...`);
  }
  
  console.log("✅ Data processing complete!");
  
  // Transform the data and update state
  return {
    currentStep: "processed",
    processedData: state.processedData.map(d => `processed_${d}`),
    messages: [new AIMessage("Data processing completed successfully")]
  };
}

/**
 * Node 3: Saves the processed results
 * 
 * Final node that:
 * - Simulates database writes (2 seconds)
 * - Updates cache (1 second)
 * - Marks the pipeline as complete
 * 
 * If aborted here, partial results won't be saved
 */
async function saveResults(state: typeof ProcessingState.State) {
  console.log("💾 [Step 3] Saving results...");
  
  // Simulate database write - can be interrupted here
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log("   Writing to database...");
  
  // Simulate cache update - or here
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log("   Updating cache...");
  
  console.log("✅ Results saved!");
  
  // Mark pipeline as complete
  return {
    currentStep: "completed",
    isComplete: true,
    messages: [new AIMessage("Results saved successfully")]
  };
}

/**
 * Creates the processing graph
 * 
 * Simple linear graph structure:
 * __start__ -> fetch_data -> process_data -> save_results -> __end__
 * 
 * Each node can be interrupted when an abort signal is sent
 */
function createProcessingGraph() {
  const workflow = new StateGraph(ProcessingState)
    // Add nodes
    .addNode("fetch_data", fetchData)
    .addNode("process_data", processData)
    .addNode("save_results", saveResults)
    
    // Define linear flow
    .addEdge("__start__", "fetch_data")
    .addEdge("fetch_data", "process_data")
    .addEdge("process_data", "save_results")
    .addEdge("save_results", "__end__");

  // Add checkpointer for state persistence
  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * SCENARIO 1: Normal execution without interruption
 * 
 * Shows how the graph runs to completion when no abort signal is provided.
 * The entire pipeline takes about 12 seconds:
 * - Fetch: 5 seconds
 * - Process: 4 seconds  
 * - Save: 3 seconds
 */
async function runNormalExecution() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 SCENARIO 1: Normal Execution (No Interruption)");
  console.log("=".repeat(60) + "\n");
  
  const graph = createProcessingGraph();
  const threadId = `normal-${Date.now()}`;
  
  const startTime = Date.now();
  
  try {
    // Invoke the graph without any abort signal
    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Start processing")]
      },
      {
        configurable: { thread_id: threadId }
        // Note: No signal property here
      }
    );
    
    const duration = Date.now() - startTime;
    console.log(`\n✨ Execution completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`Final state: ${result.currentStep}`);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

/**
 * SCENARIO 2: Aborting execution with AbortController
 * 
 * Demonstrates how to:
 * 1. Create an AbortController instance
 * 2. Pass its signal to graph.invoke()
 * 3. Trigger abort after a specific time
 * 4. Handle the abort error gracefully
 * 
 * @param abortAfterMs - Milliseconds to wait before aborting
 */
async function runAbortedExecution(abortAfterMs: number) {
  console.log("\n" + "=".repeat(60));
  console.log(`📋 SCENARIO 2: Aborted Execution (Cancel after ${abortAfterMs}ms)`);
  console.log("=".repeat(60) + "\n");
  
  const graph = createProcessingGraph();
  const threadId = `aborted-${Date.now()}`;
  
  // Step 1: Create an AbortController
  // This is a standard Web API for cancellable operations
  const controller = new AbortController();
  
  // Step 2: Set a timeout to abort the execution
  // In real apps, this could be triggered by user action
  const abortTimeout = setTimeout(() => {
    console.log(`\n⚠️  ABORTING EXECUTION after ${abortAfterMs}ms...`);
    controller.abort(); // This sends the abort signal
  }, abortAfterMs);
  
  const startTime = Date.now();
  
  try {
    // Step 3: Pass the signal to graph.invoke()
    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Start processing")]
      },
      {
        configurable: { thread_id: threadId },
        signal: controller.signal  // <-- The key part!
      }
    );
    
    // If we reach here, execution completed before abort
    clearTimeout(abortTimeout);
    const duration = Date.now() - startTime;
    console.log(`\n✨ Execution completed before abort in ${(duration / 1000).toFixed(2)}s`);
    
  } catch (error: any) {
    clearTimeout(abortTimeout);
    const duration = Date.now() - startTime;
    
    // Step 4: Handle abort errors specifically
    if (error.name === 'AbortError' || error.message === 'Aborted') {
      console.log(`\n🛑 Execution successfully aborted after ${(duration / 1000).toFixed(2)}s`);
      console.log("The graph stopped processing as requested.");
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * SCENARIO 3: Aborting a streaming execution
 * 
 * Shows that abort signals work with streaming too!
 * Streaming is useful when you want to:
 * - Get intermediate results as nodes complete
 * - Show progress to users in real-time
 * - Cancel based on intermediate results
 * 
 * @param abortAfterMs - Milliseconds to wait before aborting
 */
async function runStreamingAbort(abortAfterMs: number) {
  console.log("\n" + "=".repeat(60));
  console.log(`📋 SCENARIO 3: Streaming with Abort (Cancel after ${abortAfterMs}ms)`);
  console.log("=".repeat(60) + "\n");
  
  const graph = createProcessingGraph();
  const threadId = `streaming-${Date.now()}`;
  
  const controller = new AbortController();
  
  const abortTimeout = setTimeout(() => {
    console.log(`\n⚠️  ABORTING STREAM after ${abortAfterMs}ms...`);
    controller.abort();
  }, abortAfterMs);
  
  const startTime = Date.now();
  
  try {
    console.log("🔄 Starting streaming execution...\n");
    
    // Use graph.stream() instead of graph.invoke()
    // Signal works the same way!
    const stream = await graph.stream(
      {
        messages: [new HumanMessage("Start processing")]
      },
      {
        configurable: { thread_id: threadId },
        signal: controller.signal  // Same signal pattern
      }
    );
    
    // Process stream chunks as they arrive
    for await (const chunk of stream) {
      console.log("📦 Received stream chunk:", Object.keys(chunk)[0]);
      // In real apps, you could update UI or check conditions here
    }
    
    clearTimeout(abortTimeout);
    const duration = Date.now() - startTime;
    console.log(`\n✨ Stream completed in ${(duration / 1000).toFixed(2)}s`);
    
  } catch (error: any) {
    clearTimeout(abortTimeout);
    const duration = Date.now() - startTime;
    
    // Handle abort errors (slightly different error messages in streaming)
    if (error.name === 'AbortError' || error.message === 'Aborted' || error.message === 'Abort') {
      console.log(`\n🛑 Stream successfully aborted after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * Main demo runner
 * 
 * Runs through all scenarios to demonstrate:
 * 1. Normal execution (baseline)
 * 2. Early abort (during fetch)
 * 3. Mid-execution abort (during processing)
 * 4. Streaming with abort
 */
async function runDemo() {
  console.log("=".repeat(70));
  console.log("🚀 LANGGRAPH ABORT EXECUTION DEMONSTRATION");
  console.log("=".repeat(70));
  console.log("\nThis example shows how to cancel long-running graph executions");
  console.log("using AbortController and signal support.");
  console.log("\nThe example graph has 3 steps:");
  console.log("1. Fetch Data (5 seconds)");
  console.log("2. Process Data (4 seconds)"); 
  console.log("3. Save Results (3 seconds)");
  console.log("Total: ~12 seconds if run to completion");
  console.log("=".repeat(70));
  
  // Scenario 1: Baseline - show normal execution time
  await runNormalExecution();
  
  // Scenario 2a: Abort early (during fetch step)
  await runAbortedExecution(2500);
  
  // Scenario 2b: Abort later (during process step)
  await runAbortedExecution(7000);
  
  // Scenario 3: Show abort works with streaming too
  await runStreamingAbort(3000);
  
  console.log("\n" + "=".repeat(70));
  console.log("✨ DEMONSTRATION COMPLETE");
  console.log("=".repeat(70));
  console.log("\n💡 KEY TAKEAWAYS:");
  console.log("- Use AbortController to create cancellable executions");
  console.log("- Pass the signal to graph.invoke() or graph.stream()");
  console.log("- Execution stops cleanly at the next opportunity");
  console.log("- Works with both regular invocation and streaming");
  console.log("- Useful for user-initiated cancellations or timeouts");
  console.log("=".repeat(70) + "\n");
}

/**
 * ADDITIONAL USAGE PATTERNS
 * 
 * 1. User-initiated cancellation:
 * ```typescript
 * const controller = new AbortController();
 * 
 * // Wire up to UI cancel button
 * cancelButton.onclick = () => controller.abort();
 * 
 * // Pass to graph
 * await graph.invoke(input, { signal: controller.signal });
 * ```
 * 
 * 2. Timeout pattern:
 * ```typescript
 * const controller = new AbortController();
 * const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
 * 
 * try {
 *   const result = await graph.invoke(input, { signal: controller.signal });
 *   clearTimeout(timeoutId);
 * } catch (error) {
 *   // Handle timeout
 * }
 * ```
 * 
 * 3. Conditional abort based on results:
 * ```typescript
 * const controller = new AbortController();
 * 
 * for await (const chunk of graph.stream(input, { signal: controller.signal })) {
 *   if (shouldAbort(chunk)) {
 *     controller.abort();
 *     break;
 *   }
 * }
 * ```
 * 
 * 4. Cleanup on abort:
 * ```typescript
 * controller.signal.addEventListener('abort', () => {
 *   // Perform cleanup
 *   console.log('Cleaning up resources...');
 * });
 * ```
 */

// Run the demo
if (require.main === module) {
  runDemo().catch(console.error);
}

// Export for reuse
export { createProcessingGraph, ProcessingState };