/**
 * LangGraph Execution Control: Comprehensive Abort & Timeout Examples
 *
 * This expanded example demonstrates all the ways to cancel/abort/timeout
 * a running graph execution in LangGraph:
 *
 * 1. Manual abort with AbortController
 * 2. Time-based timeouts with AbortSignal.timeout()
 * 3. Manual timeout implementation
 * 4. Combined recursion limit + timeout
 * 5. Progressive timeout strategies
 * 6. Resource-based cancellation
 * 7. User-cancellable operations with timeout fallback
 *
 * IMPORTANT: Abort support requires @langchain/core>=0.2.20
 */

import {Annotation, GraphRecursionError, MemorySaver, StateGraph} from "@langchain/langgraph";
import {AIMessage, BaseMessage, HumanMessage} from "@langchain/core/messages";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * State definition for our processing pipeline
 */
const ProcessingState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  currentStep: Annotation<string>,
  processedData: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  isComplete: Annotation<boolean>,
  // New fields for timeout examples
  iterationCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  }),
  resourcesUsed: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  })
});

/**
 * Node 1: Simulates data fetching that takes time
 */
async function fetchData(state: typeof ProcessingState.State) {
  console.log("📡 [Step 1] Starting data fetch...");

  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`   Fetching batch ${i}/5...`);
  }

  console.log("✅ Data fetch complete!");

  return {
    currentStep: "fetched",
    processedData: ["batch1", "batch2", "batch3", "batch4", "batch5"],
    messages: [new AIMessage("Data fetching completed successfully")],
    resourcesUsed: state.resourcesUsed + 5
  };
}

/**
 * Node 2: Processes the fetched data
 */
async function processData(state: typeof ProcessingState.State) {
  console.log("⚙️  [Step 2] Starting data processing...");

  for (let i = 0; i < state.processedData.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`   Processing ${state.processedData[i]}...`);
  }

  console.log("✅ Data processing complete!");

  return {
    currentStep: "processed",
    processedData: state.processedData.map(d => `processed_${d}`),
    messages: [new AIMessage("Data processing completed successfully")],
    resourcesUsed: state.resourcesUsed + state.processedData.length
  };
}

/**
 * Node 3: Saves the processed results
 */
async function saveResults(state: typeof ProcessingState.State) {
  console.log("💾 [Step 3] Saving results...");

  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log("   Writing to database...");

  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log("   Updating cache...");

  console.log("✅ Results saved!");

  return {
    currentStep: "completed",
    isComplete: true,
    messages: [new AIMessage("Results saved successfully")],
    resourcesUsed: state.resourcesUsed + 2
  };
}

/**
 * Creates the basic processing graph
 */
function createProcessingGraph() {
  const workflow = new StateGraph(ProcessingState)
    .addNode("fetch_data", fetchData)
    .addNode("process_data", processData)
    .addNode("save_results", saveResults)
    .addEdge("__start__", "fetch_data")
    .addEdge("fetch_data", "process_data")
    .addEdge("process_data", "save_results")
    .addEdge("save_results", "__end__");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Creates a looping graph for demonstrating recursion limits
 */
function createLoopingGraph() {
  async function incrementNode(state: typeof ProcessingState.State) {
    console.log(`🔄 Iteration ${state.iterationCount + 1}`);
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
      iterationCount: state.iterationCount + 1,
      messages: [new AIMessage(`Completed iteration ${state.iterationCount + 1}`)]
    };
  }

  function shouldContinue(state: typeof ProcessingState.State) {
    // This creates an infinite loop unless stopped by recursion limit
    return state.iterationCount < 100 ? "increment" : "__end__";
  }

  const workflow = new StateGraph(ProcessingState)
    .addNode("increment", incrementNode)
    .addEdge("__start__", "increment")
    .addConditionalEdges("increment", shouldContinue, {
      increment: "increment",
      __end__: "__end__"
    });

  return workflow.compile({ checkpointer: new MemorySaver() });
}

/**
 * EXAMPLE 1: Basic timeout with AbortSignal.timeout()
 *
 * The simplest way to add a timeout - using the built-in static method
 */
async function example1_basicTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 1: Basic Timeout with AbortSignal.timeout()");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const threadId = `timeout-basic-${Date.now()}`;
  const timeoutMs = 6000; // 6 seconds - will timeout during processing

  console.log(`⏰ Setting timeout to ${timeoutMs}ms`);
  console.log("Expected: Should timeout during data processing step\n");

  const startTime = Date.now();

  try {
    // Using AbortSignal.timeout() - the simplest approach
    const result = await graph.invoke(
      { messages: [new HumanMessage("Start processing")] },
      {
        configurable: { thread_id: threadId },
        signal: AbortSignal.timeout(timeoutMs) // <-- Simple timeout!
      }
    );

    console.log("\n✨ Execution completed before timeout");

  } catch (error: any) {
    const duration = Date.now() - startTime;

    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message === 'Aborted') {
      console.log(`\n⏱️  Execution timed out after ${(duration / 1000).toFixed(2)}s`);
      console.log("This is expected behavior - the timeout worked!");
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * EXAMPLE 2: Manual timeout with AbortController
 *
 * More control - can clear timeout on success
 */
async function example2_manualTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 2: Manual Timeout with AbortController");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const threadId = `timeout-manual-${Date.now()}`;
  const timeoutMs = 8000; // 8 seconds - might complete or timeout

  console.log(`⏰ Setting manual timeout to ${timeoutMs}ms`);
  console.log("Expected: Might complete or timeout during save step\n");

  const controller = new AbortController();
  const startTime = Date.now();

  // Set up timeout
  const timeoutId = setTimeout(() => {
    console.log("\n⚠️  Timeout triggered!");
    controller.abort(new Error("Operation timed out"));
  }, timeoutMs);

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage("Start processing")] },
      {
        configurable: { thread_id: threadId },
        signal: controller.signal
      }
    );

    // Important: Clear timeout on success!
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    console.log(`\n✨ Completed successfully in ${(duration / 1000).toFixed(2)}s`);

  } catch (error: any) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError' || error.message === 'Operation timed out' || error.message === 'Aborted') {
      console.log(`\n⏱️  Timed out after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * EXAMPLE 3: Combining recursion limit with timeout
 *
 * Shows how to use both step-based and time-based limits
 */
async function example3_combinedLimits() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 3: Combined Recursion Limit + Timeout");
  console.log("=".repeat(60) + "\n");

  const graph = createLoopingGraph();
  const threadId = `combined-${Date.now()}`;

  console.log("⏰ Timeout: 3000ms");
  console.log("🔢 Recursion limit: 10 steps");
  console.log("Expected: Should hit recursion limit first\n");

  const startTime = Date.now();

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage("Start loop")] },
      {
        configurable: { thread_id: threadId },
        signal: AbortSignal.timeout(3000), // 3 second timeout
        recursionLimit: 10 // Maximum 10 iterations
      }
    );

    console.log("\n✨ Completed successfully");
    console.log(`Final iteration count: ${result.iterationCount}`);

  } catch (error: any) {
    const duration = Date.now() - startTime;

    if (error instanceof GraphRecursionError) {
      console.log(`\n🔢 Hit recursion limit after ${(duration / 1000).toFixed(2)}s`);
      console.log("The step limit was reached before the timeout");
    } else if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message === 'Aborted') {
      console.log(`\n⏱️  Hit timeout after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * EXAMPLE 4: Progressive timeout strategy
 *
 * Retries with increasing timeouts
 */
async function example4_progressiveTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 4: Progressive Timeout Strategy");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const baseTimeout = 2000; // Start with 2 seconds
  const maxAttempts = 3;

  console.log(`📈 Progressive timeouts: ${baseTimeout}ms, ${baseTimeout * 2}ms, ${baseTimeout * 4}ms`);
  console.log("Expected: First attempts fail, last one succeeds\n");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeout = baseTimeout * Math.pow(2, attempt - 1);
    const threadId = `progressive-${Date.now()}-attempt${attempt}`;

    console.log(`\n🔄 Attempt ${attempt}/${maxAttempts} with timeout ${timeout}ms`);

    const startTime = Date.now();

    try {
      const result = await graph.invoke(
        { messages: [new HumanMessage("Start processing")] },
        {
          configurable: { thread_id: threadId },
          signal: AbortSignal.timeout(timeout)
        }
      );

      const duration = Date.now() - startTime;
      console.log(`✅ Success on attempt ${attempt} after ${(duration / 1000).toFixed(2)}s`);
      break; // Success, exit loop

    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message === 'Aborted') {
        console.log(`⏱️  Attempt ${attempt} timed out after ${(duration / 1000).toFixed(2)}s`);

        if (attempt === maxAttempts) {
          console.log("\n❌ All attempts exhausted");
        }
      } else {
        console.error("❌ Unexpected error:", error);
        break;
      }
    }
  }
}

/**
 * EXAMPLE 5: User-cancellable with timeout fallback
 *
 * Combines manual cancellation with automatic timeout
 */
async function example5_userCancellableWithTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 5: User-Cancellable + Timeout Fallback");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const threadId = `user-cancel-${Date.now()}`;

  console.log("🔘 User can cancel at any time");
  console.log("⏰ Automatic timeout after 15 seconds");
  console.log("Expected: Will simulate user cancellation after 4 seconds\n");

  // Create separate controllers
  const userController = new AbortController();
  const timeoutSignal = AbortSignal.timeout(15000); // 15 second fallback

  // Simulate user pressing cancel after 4 seconds
  setTimeout(() => {
    console.log("\n👤 USER PRESSED CANCEL!");
    userController.abort(new Error("User cancelled"));
  }, 4000);

  const startTime = Date.now();

  try {
    // Combine signals - aborts if either triggers
    const combinedSignal = AbortSignal.any([
      userController.signal,
      timeoutSignal
    ]);

    const result = await graph.invoke(
      { messages: [new HumanMessage("Start processing")] },
      {
        configurable: { thread_id: threadId },
        signal: combinedSignal
      }
    );

    console.log("\n✨ Completed successfully");

  } catch (error: any) {
    const duration = Date.now() - startTime;

    if (userController.signal.aborted) {
      console.log(`\n👤 User cancelled after ${(duration / 1000).toFixed(2)}s`);
    } else if (error.name === 'TimeoutError') {
      console.log(`\n⏱️  Automatic timeout after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * EXAMPLE 6: Resource-based cancellation
 *
 * Cancel when resource usage exceeds limit
 */
async function example6_resourceBasedCancellation() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 6: Resource-Based Cancellation");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const threadId = `resource-${Date.now()}`;

  const resourceLimit = 8;
  console.log(`📊 Resource limit: ${resourceLimit} units`);
  console.log("Expected: Should cancel when resources exceed limit\n");

  const resourceController = new AbortController();
  const checkInterval = 500; // Check every 500ms

  // Monitor resource usage
  let lastResourceCheck = 0;
  const resourceMonitor = setInterval(async () => {
    try {
      const state = await graph.getState({
        configurable: { thread_id: threadId }
      });

      if (state && state.values && typeof state.values.resourcesUsed === 'number') {
        lastResourceCheck = state.values.resourcesUsed;
        if (state.values.resourcesUsed > resourceLimit) {
          console.log(`\n📊 Resource limit exceeded: ${state.values.resourcesUsed}/${resourceLimit}`);
          resourceController.abort(new Error("Resource limit exceeded"));
          clearInterval(resourceMonitor);
        }
      }
    } catch (error) {
      // State might not exist yet
    }
  }, checkInterval);

  const startTime = Date.now();

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage("Start processing")] },
      {
        configurable: { thread_id: threadId },
        signal: resourceController.signal
      }
    );

    clearInterval(resourceMonitor);
    console.log("\n✨ Completed within resource limits");
    console.log(`Resources used: ${result.resourcesUsed || 0}`);

  } catch (error: any) {
    clearInterval(resourceMonitor);
    const duration = Date.now() - startTime;

    if (error.message === "Resource limit exceeded") {
      console.log(`\n📊 Cancelled due to resource limit after ${(duration / 1000).toFixed(2)}s`);
    } else if (error.name === 'AbortError' || error.message === 'Aborted') {
      console.log(`\n📊 Cancelled due to resource limit after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * EXAMPLE 7: Streaming with timeout
 *
 * Shows timeout works with streaming too
 */
async function example7_streamingWithTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 7: Streaming with Timeout");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const threadId = `streaming-timeout-${Date.now()}`;
  const timeoutMs = 7000;

  console.log(`⏰ Streaming with ${timeoutMs}ms timeout`);
  console.log("Expected: Should receive some chunks before timeout\n");

  const startTime = Date.now();

  try {
    const stream = await graph.stream(
      { messages: [new HumanMessage("Start processing")] },
      {
        configurable: { thread_id: threadId },
        signal: AbortSignal.timeout(timeoutMs)
      }
    );

    console.log("📡 Streaming results:\n");

    for await (const chunk of stream) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Received chunk:`, Object.keys(chunk)[0]);
    }

    console.log("\n✨ Stream completed successfully");

  } catch (error: any) {
    const duration = Date.now() - startTime;

    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message === 'Aborted') {
      console.log(`\n⏱️  Stream timed out after ${(duration / 1000).toFixed(2)}s`);
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * Utility: Create a timeout manager class for reusable timeout logic
 */
class TimeoutManager {
  private activeOperations: Map<string, { controller: AbortController; timeout?: NodeJS.Timeout }> = new Map();

  async runWithTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: {
      timeoutMs?: number;
      operationId?: string;
      onTimeout?: () => void;
    } = {}
  ): Promise<T> {
    const {
      timeoutMs = 30000,
      operationId = randomUUID(),
      onTimeout
    } = options;

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error("Timeout"));
        if (onTimeout) onTimeout();
      }, timeoutMs);
    }

    this.activeOperations.set(operationId, { controller, timeout: timeoutId });

    try {
      const result = await operation(controller.signal);
      this.cleanup(operationId);
      return result;
    } catch (error) {
      this.cleanup(operationId);
      throw error;
    }
  }

  cancel(operationId: string) {
    const operation = this.activeOperations.get(operationId);
    if (operation) {
      operation.controller.abort(new Error("Manually cancelled"));
      this.cleanup(operationId);
    }
  }

  cancelAll() {
    for (const [id, operation] of this.activeOperations) {
      operation.controller.abort(new Error("All operations cancelled"));
    }
    this.activeOperations.clear();
  }

  private cleanup(operationId: string) {
    const operation = this.activeOperations.get(operationId);
    if (operation) {
      if (operation.timeout) clearTimeout(operation.timeout);
      this.activeOperations.delete(operationId);
    }
  }
}

/**
 * EXAMPLE 8: Using the TimeoutManager utility
 */
async function example8_timeoutManager() {
  console.log("\n" + "=".repeat(60));
  console.log("📋 EXAMPLE 8: TimeoutManager Utility Class");
  console.log("=".repeat(60) + "\n");

  const graph = createProcessingGraph();
  const manager = new TimeoutManager();

  console.log("🛠️  Using reusable TimeoutManager");
  console.log("Expected: Clean timeout handling with automatic cleanup\n");

  try {
    const result = await manager.runWithTimeout(
      async (signal) => {
        return await graph.invoke(
          { messages: [new HumanMessage("Start processing")] },
          {
            configurable: { thread_id: `manager-${Date.now()}` },
            signal
          }
        );
      },
      {
        timeoutMs: 5000,
        operationId: "my-operation",
        onTimeout: () => console.log("\n⚠️  TimeoutManager: Operation timed out!")
      }
    );

    console.log("\n✨ Operation completed successfully");

  } catch (error: any) {
    if (error.message === "Timeout" || error.name === 'AbortError' || error.message === 'Aborted') {
      console.log("\n⏱️  Handled by TimeoutManager");
    } else {
      console.error("\n❌ Unexpected error:", error);
    }
  }
}

/**
 * Main demo runner
 */
async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("🚀 LANGGRAPH EXECUTION CONTROL: COMPREHENSIVE EXAMPLES");
  console.log("=".repeat(70));
  console.log("\nThis demonstration shows all the ways to control graph execution:");
  console.log("- Timeouts (various strategies)");
  console.log("- Manual cancellation");
  console.log("- Recursion limits");
  console.log("- Combined approaches");
  console.log("=".repeat(70));

  // Run all examples
  await example1_basicTimeout();
  await example2_manualTimeout();
  await example3_combinedLimits();
  await example4_progressiveTimeout();
  await example5_userCancellableWithTimeout();
  await example6_resourceBasedCancellation();
  await example7_streamingWithTimeout();
  await example8_timeoutManager();

  console.log("\n" + "=".repeat(70));
  console.log("✨ ALL EXAMPLES COMPLETE");
  console.log("=".repeat(70));
  console.log("\n💡 KEY TAKEAWAYS:");
  console.log("1. Use AbortSignal.timeout() for simple time-based limits");
  console.log("2. Use AbortController for more control (can cancel manually)");
  console.log("3. Use recursionLimit for step-based limits");
  console.log("4. Combine multiple strategies for robust control");
  console.log("5. Always clean up timeouts and event listeners");
  console.log("6. Consider progressive timeouts for unreliable operations");
  console.log("7. AbortSignal.any() combines multiple signals effectively");
  console.log("=".repeat(70) + "\n");
  
  // Give some time for any lingering async operations to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Run if this is the main module
if (require.main === module) {
  runAllExamples().catch(console.error);
}

// Export for reuse
export {
  createProcessingGraph,
  createLoopingGraph,
  ProcessingState,
  TimeoutManager
};
