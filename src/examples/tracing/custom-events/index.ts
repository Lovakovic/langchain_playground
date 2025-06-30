/**
 * LangChain Custom Events Example: Application-Specific Event Tracking
 * 
 * This example demonstrates how to dispatch and handle custom events in LangChain/LangGraph
 * for tracking application-specific metrics, progress, and debugging information.
 * 
 * WHAT ARE CUSTOM EVENTS?
 * Custom events are application-specific events you can dispatch during execution to:
 * - Track progress in long-running operations (e.g., "10 of 100 items processed")
 * - Monitor business metrics (e.g., "payment_processed", "user_registered")
 * - Debug complex workflows (e.g., "cache_miss", "api_retry")
 * - Provide real-time feedback to users (e.g., "generating_summary", "validating_data")
 * 
 * HOW CUSTOM EVENTS WORK:
 * 1. Events can only be dispatched from within a Runnable (your code)
 * 2. Each event has a name (string) and data (any JSON-serializable value)
 * 3. Events are attached to the Run that dispatches them (not as child runs)
 * 4. Events inherit the hierarchy of their parent run
 * 
 * THE RUN HIERARCHY:
 * LangChain automatically tracks parent-child relationships between operations:
 * 
 *   textAnalyzer (root run)
 *   └── 📢 processing_started (custom event attached to this run)
 *   └── 📢 analysis_complete (custom event attached to this run)
 * 
 *   dataPipeline (root run)
 *   ├── pipelineStart (child run)
 *   │   └── 📢 pipeline_started
 *   ├── dataFetcher (child run)
 *   │   ├── 📢 fetch_started
 *   │   └── 📢 fetch_completed
 *   └── dataProcessor (child run)
 *       ├── 📢 processing_started
 *       ├── 📢 item_processed (multiple events)
 *       └── 📢 processing_completed
 * 
 * CONSUMING CUSTOM EVENTS:
 * 1. Callback Handlers: Implement handleCustomEvent() to process events in real-time
 * 2. Stream Events API: Use streamEvents() and filter for "on_custom_event"
 * 3. Log Analysis: Parse the JSONL log files for post-processing
 * 
 * KEY BENEFITS:
 * - Zero Performance Impact: Events are handled asynchronously
 * - Rich Context: Each event includes full hierarchy path
 * - Flexible Data: Attach any JSON-serializable data to events
 * - Easy Integration: Works with existing monitoring/logging systems
 */

import {RunnableConfig, RunnableLambda, RunnableSequence} from "@langchain/core/runnables";
import {dispatchCustomEvent} from "@langchain/core/callbacks/dispatch";
import {MessagesAnnotation, StateGraph} from "@langchain/langgraph";
import {AIMessage, HumanMessage} from "@langchain/core/messages";
import {BaseTracer, Run} from "@langchain/core/tracers/base";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * HierarchyAwareEventHandler: Custom Event Handler with Run Hierarchy Tracking
 * 
 * This handler extends BaseTracer to:
 * 1. Capture ONLY custom events (not all LangChain events)
 * 2. Track the run hierarchy to show where events occur
 * 3. Enrich events with hierarchy paths (e.g., "pipeline > fetcher > validator")
 * 4. Write events as JSONL for easy parsing and analysis
 * 
 * Why extend BaseTracer instead of BaseCallbackHandler?
 * - BaseTracer gives us access to the full run hierarchy via onRunCreate
 * - We can track parent-child relationships between runs
 * - We can build hierarchy paths showing exactly where events occur
 * 
 * Output Format (JSONL - one JSON object per line):
 * {
 *   "timestamp": "2024-01-01T12:00:00Z",
 *   "eventName": "item_processed",
 *   "runId": "abc123...",
 *   "hierarchy": ["dataPipeline", "dataProcessor"],
 *   "depth": 2,
 *   "data": { "index": 0, "total": 10, "progress": 10 }
 * }
 */
class HierarchyAwareEventHandler extends BaseTracer {
  name = "hierarchy_aware_event_handler" as const;
  
  private logStream: fs.WriteStream;
  private runHierarchy: Map<string, { parentRunId?: string; name: string; type: string }> = new Map();
  private customEventCount = 0;

  constructor(logFilePath: string) {
    super();
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  }

  /**
   * Required by BaseTracer - we don't need persistence
   */
  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Track when ANY operation starts (chain, llm, tool) to build hierarchy map
   * This is called automatically by LangChain for every run
   */
  onRunCreate(run: Run): void {
    this.runHierarchy.set(run.id, {
      parentRunId: run.parent_run_id,
      name: run.name || "unnamed",
      type: run.run_type
    });
  }

  /**
   * Handle custom events - this is where we capture and enrich events
   * 
   * IMPORTANT: This method is ONLY called for custom events dispatched via
   * dispatchCustomEvent(), not for standard LangChain events
   */
  async handleCustomEvent(
    eventName: string,
    data: any,
    runId: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<any> {
    this.customEventCount++;
    
    // Build hierarchy path showing where this event was dispatched
    // Example: ["dataPipeline", "dataProcessor"] means the event was
    // dispatched from within the dataProcessor run, which is a child of dataPipeline
    const hierarchy = this.getHierarchyPath(runId);
    const depth = hierarchy.length;
    
    // Create enriched event object with all context
    const event = {
      timestamp: new Date().toISOString(),
      eventName,
      runId,
      hierarchy,
      depth,
      data,
      ...(tags && tags.length > 0 && { tags }),
      ...(metadata && Object.keys(metadata).length > 0 && { metadata })
    };
    
    // Write as JSONL (newline-delimited JSON)
    this.logStream.write(JSON.stringify(event) + '\n');
    
    // Console output with visual hierarchy
    const indent = "  ".repeat(depth - 1);
    console.log(`${indent}📢 Custom Event: ${eventName}`);
    console.log(`${indent}   Hierarchy: ${hierarchy.join(" > ")}`);
  }

  /**
   * Build the hierarchy path from current run to root
   * This shows the complete execution context of where the event was dispatched
   */
  private getHierarchyPath(runId: string): string[] {
    const path: string[] = [];
    let currentId: string | undefined = runId;
    
    while (currentId) {
      const runInfo = this.runHierarchy.get(currentId);
      if (runInfo) {
        path.unshift(runInfo.name);
        currentId = runInfo.parentRunId;
      } else {
        break;
      }
    }
    
    return path;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      totalEvents: this.customEventCount,
      uniqueRuns: this.runHierarchy.size
    };
  }

  close() {
    this.logStream.end();
  }
}

/**
 * Example 1: Basic Custom Event Dispatch
 * 
 * The simplest pattern - dispatch events from a single Runnable.
 * Events will be attached to the textAnalyzer run.
 * 
 * Use this pattern when:
 * - You have a single operation to track
 * - You want to mark start/end of processing
 * - You need to log results or metrics
 */
function createBasicExample() {
  return RunnableLambda.from(async (input: string) => {
    // Event 1: Mark the start of processing
    await dispatchCustomEvent("processing_started", {
      input,
      timestamp: new Date().toISOString()
    });
    
    // Do actual work
    const words = input.split(" ");
    const wordCount = words.length;
    
    // Event 2: Log results and metrics
    await dispatchCustomEvent("analysis_complete", {
      wordCount,
      characterCount: input.length,
      averageWordLength: input.length / wordCount
    });
    
    return `Analyzed: ${wordCount} words, ${input.length} characters`;
  }).withConfig({ runName: "textAnalyzer" });
}

/**
 * Example 2: Nested Operations with Progress Tracking
 * 
 * Shows how events maintain hierarchy in nested operations.
 * Each component dispatches its own events, creating a clear execution trace.
 * 
 * Hierarchy structure:
 * dataPipeline
 * ├── pipelineStart    → dispatches: pipeline_started
 * ├── dataFetcher      → dispatches: fetch_started, fetch_completed
 * ├── dataProcessor    → dispatches: processing_started, item_processed (x3), processing_completed
 * └── pipelineEnd      → dispatches: pipeline_completed
 * 
 * Use this pattern when:
 * - You have multi-step workflows
 * - You need progress tracking for long operations
 * - Different teams own different components
 */
function createNestedExample() {
  // Component 1: Data fetching with start/end events
  const dataFetcher = RunnableLambda.from(async (query: string) => {
    await dispatchCustomEvent("fetch_started", { 
      component: "dataFetcher",
      query 
    });
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const mockData = {
      query,
      results: ["result1", "result2", "result3"],
      fetchedAt: new Date().toISOString()
    };
    
    await dispatchCustomEvent("fetch_completed", { 
      component: "dataFetcher",
      resultCount: mockData.results.length 
    });
    
    return mockData;
  }).withConfig({ runName: "dataFetcher" });

  // Component 2: Data processing with progress events
  const dataProcessor = RunnableLambda.from(async (data: any) => {
    await dispatchCustomEvent("processing_started", { 
      component: "dataProcessor",
      itemCount: data.results.length 
    });
    
    // Process each item with progress tracking
    const processed = [];
    for (let i = 0; i < data.results.length; i++) {
      // Dispatch progress event for each item
      await dispatchCustomEvent("item_processed", {
        index: i,
        total: data.results.length,
        progress: ((i + 1) / data.results.length) * 100
      });
      
      processed.push({
        original: data.results[i],
        processed: data.results[i].toUpperCase(),
        index: i
      });
    }
    
    await dispatchCustomEvent("processing_completed", { 
      component: "dataProcessor",
      processedCount: processed.length 
    });
    
    return processed;
  }).withConfig({ runName: "dataProcessor" });

  // Main pipeline that orchestrates components
  return RunnableSequence.from([
    // Start of pipeline
    RunnableLambda.from(async (input: string) => {
      await dispatchCustomEvent("pipeline_started", { 
        input,
        steps: ["fetch", "process"] 
      });
      return input;
    }).withConfig({ runName: "pipelineStart" }),
    
    // Components execute in sequence
    dataFetcher,
    dataProcessor,
    
    // End of pipeline
    RunnableLambda.from(async (results: any) => {
      await dispatchCustomEvent("pipeline_completed", { 
        resultCount: results.length,
        success: true 
      });
      return results;
    }).withConfig({ runName: "pipelineEnd" })
  ]).withConfig({ runName: "dataPipeline" });
}

/**
 * Example 3: LangGraph with Custom Events
 * 
 * Demonstrates custom events within a graph structure, including
 * events from sub-chains created inside nodes.
 * 
 * Graph structure:
 * LangGraph
 * ├── analyzer (node)
 * │   ├── 📢 node_entered
 * │   ├── sentimentAnalyzer (sub-chain created within node)
 * │   │   ├── 📢 sentiment_analysis_started
 * │   │   └── 📢 sentiment_detected
 * │   └── 📢 node_completed
 * └── responder (node)
 *     ├── 📢 node_entered
 *     └── 📢 response_generated
 * 
 * Use this pattern when:
 * - Building stateful workflows
 * - Nodes create their own sub-chains
 * - You need to track graph execution flow
 */
async function createGraphExample() {
  const analyzeNode = async (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    // Event: Track node entry
    await dispatchCustomEvent("node_entered", {
      node: "analyzer",
      messageCount: state.messages.length,
      lastMessageType: lastMessage._getType()
    });
    
    // Create a sub-chain within the node - this creates a child run
    const sentimentAnalyzer = RunnableLambda.from(async (text: string) => {
      await dispatchCustomEvent("sentiment_analysis_started", {
        textLength: text.length
      });
      
      // Mock sentiment analysis
      const sentiment = text.includes("happy") || text.includes("good") ? "positive" :
                       text.includes("sad") || text.includes("bad") ? "negative" : 
                       "neutral";
      
      await dispatchCustomEvent("sentiment_detected", {
        sentiment,
        confidence: 0.85
      });
      
      return sentiment;
    }).withConfig({ runName: "sentimentAnalyzer" });
    
    // Invoke sub-chain - events will show deeper hierarchy
    const content = lastMessage.content as string;
    const sentiment = await sentimentAnalyzer.invoke(content);
    
    // Event: Track node completion
    await dispatchCustomEvent("node_completed", {
      node: "analyzer",
      results: { sentiment }
    });
    
    return { messages: [new AIMessage(`Analysis complete. Sentiment: ${sentiment}`)] };
  };

  const responseNode = async (state: typeof MessagesAnnotation.State) => {
    await dispatchCustomEvent("node_entered", {
      node: "responder",
      messageCount: state.messages.length
    });
    
    const response = new AIMessage("Thank you for your message. Analysis has been completed.");
    
    await dispatchCustomEvent("response_generated", {
      responseLength: response.content.toString().length
    });
    
    return { messages: [response] };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("analyzer", analyzeNode)
    .addNode("responder", responseNode)
    .addEdge("__start__", "analyzer")
    .addEdge("analyzer", "responder")
    .addEdge("responder", "__end__")
    .compile();
}

/**
 * Example 4: Error Tracking with Custom Events
 * 
 * Shows how to use custom events for error tracking and debugging.
 * Events are dispatched even when errors occur, providing a complete trace.
 * 
 * Event patterns:
 * - operation_started: Always dispatched
 * - validation_error: Dispatched when validation fails
 * - operation_completed: Only when successful
 * - operation_failed: Includes error details and stack trace
 * 
 * Use this pattern when:
 * - You need detailed error tracking
 * - Debugging production issues
 * - Monitoring error rates and types
 */
function createErrorTrackingExample() {
  return RunnableLambda.from(async (input: { value: number; operation: string }) => {
    try {
      // Always track operation start
      await dispatchCustomEvent("operation_started", {
        operation: input.operation,
        input: input.value
      });
      
      let result: number;
      switch (input.operation) {
        case "divide":
          if (input.value === 0) {
            // Track validation errors separately from execution errors
            await dispatchCustomEvent("validation_error", {
              error: "Division by zero",
              input: input.value
            });
            throw new Error("Cannot divide by zero");
          }
          result = 100 / input.value;
          break;
        case "sqrt":
          if (input.value < 0) {
            await dispatchCustomEvent("validation_error", {
              error: "Negative square root",
              input: input.value
            });
            throw new Error("Cannot take square root of negative number");
          }
          result = Math.sqrt(input.value);
          break;
        default:
          result = input.value;
      }
      
      // Track successful completion
      await dispatchCustomEvent("operation_completed", {
        operation: input.operation,
        input: input.value,
        result,
        success: true
      });
      
      return result;
    } catch (error) {
      // Track failures with full context
      await dispatchCustomEvent("operation_failed", {
        operation: input.operation,
        input: input.value,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }).withConfig({ runName: "mathOperation" });
}

/**
 * Main demonstration function
 */
async function main() {
  console.log("=== LangChain Custom Events with Hierarchy Tracking ===\n");
  
  // Create event handler with hierarchy tracking
  const logFile = path.join(logsDir, `custom-events-${new Date().toISOString().replace(/:/g, '-')}.jsonl`);
  const eventHandler = new HierarchyAwareEventHandler(logFile);
  
  console.log(`📝 Events log: ${path.relative(process.cwd(), logFile)}\n`);
  
  // Example 1: Basic custom events
  console.log("1️⃣  Example 1: Basic Custom Events");
  console.log("=" + "=".repeat(50) + "\n");
  
  const basicExample = createBasicExample();
  await basicExample.invoke("Hello world from LangChain", {
    callbacks: [eventHandler]
  });
  
  console.log("\n");
  
  // Example 2: Nested operations with progress
  console.log("2️⃣  Example 2: Nested Operations with Progress Tracking");
  console.log("=" + "=".repeat(50) + "\n");
  
  const nestedExample = createNestedExample();
  await nestedExample.invoke("test query", {
    callbacks: [eventHandler]
  });
  
  console.log("\n");
  
  // Example 3: LangGraph with custom events
  console.log("3️⃣  Example 3: LangGraph with Custom Events");
  console.log("=" + "=".repeat(50) + "\n");
  
  const graphExample = await createGraphExample();
  await graphExample.invoke(
    { messages: [new HumanMessage("I am feeling happy today!")] },
    { callbacks: [eventHandler] }
  );
  
  console.log("\n");
  
  // Example 4: Error tracking
  console.log("4️⃣  Example 4: Error Tracking with Custom Events");
  console.log("=" + "=".repeat(50) + "\n");
  
  const errorExample = createErrorTrackingExample();
  
  // Test successful operation
  try {
    await errorExample.invoke({ value: 25, operation: "sqrt" }, {
      callbacks: [eventHandler]
    });
    console.log("✅ Square root operation succeeded\n");
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  // Test error case
  try {
    await errorExample.invoke({ value: 0, operation: "divide" }, {
      callbacks: [eventHandler]
    });
  } catch (error) {
    console.error("❌ Expected error:", error instanceof Error ? error.message : error);
  }
  
  console.log("\n");
  
  // Example 5: Stream Events API
  console.log("5️⃣  Example 5: Using Stream Events API");
  console.log("=" + "=".repeat(50) + "\n");
  
  const streamExample = createBasicExample();
  const eventStream = await streamExample.streamEvents("Streaming test", {
    version: "v2"
  });
  
  console.log("Streaming custom events:");
  for await (const event of eventStream) {
    if (event.event === "on_custom_event") {
      console.log(`  📊 ${event.name}: ${JSON.stringify(event.data)}`);
    }
  }
  
  // Close handler and show summary
  const summary = eventHandler.getSummary();
  eventHandler.close();
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary:");
  console.log(`   Total custom events: ${summary.totalEvents}`);
  console.log(`   Unique runs tracked: ${summary.uniqueRuns}`);
  console.log(`   Log file: ${path.relative(process.cwd(), logFile)}`);
  console.log("\n💡 Run the visualizer to see the complete hierarchy:");
  console.log(`   npx ts-node src/examples/custom-events/visualize.ts`);
  console.log(`   npx ts-node src/examples/custom-events/visualize.ts ${path.basename(logFile)}`);
}

/**
 * Web Environment Support (for environments without async_hooks)
 * 
 * In web browsers or edge environments that don't support Node.js async_hooks,
 * you must manually propagate the RunnableConfig to maintain context.
 * 
 * Key differences:
 * 1. Import from @langchain/core/callbacks/dispatch/web
 * 2. Accept config as parameter in your Runnable
 * 3. Pass config to dispatchCustomEvent
 */
export async function mainWithWebImport() {
  console.log("=== Custom Events (Web Environment) ===\n");
  
  // Import web-specific dispatch function
  const { dispatchCustomEvent: dispatchCustomEventWeb } = await import(
    "@langchain/core/callbacks/dispatch/web"
  );
  
  // CRITICAL: Accept and propagate config parameter
  const webExample = RunnableLambda.from(
    async (value: string, config?: RunnableConfig) => {
      // Must pass config to maintain context
      await dispatchCustomEventWeb(
        "web_event",
        { value, timestamp: Date.now() },
        config  // <-- This is required in web environments
      );
      return value.toUpperCase();
    }
  );
  
  const logFile = path.join(logsDir, `custom-events-web-${Date.now()}.jsonl`);
  const eventHandler = new HierarchyAwareEventHandler(logFile);
  
  await webExample.invoke("web test", {
    callbacks: [eventHandler]
  });
  
  eventHandler.close();
  console.log("✅ Web example completed!");
}

/**
 * ===================================================================
 * COMMON PATTERNS AND BEST PRACTICES
 * ===================================================================
 * 
 * 1. EVENT NAMING CONVENTIONS
 *    Use descriptive, namespaced event names:
 *    ✅ "payment_processing_started"
 *    ✅ "user_validation_failed"
 *    ✅ "cache_hit"
 *    ❌ "started"
 *    ❌ "error"
 * 
 * 2. EVENT DATA STRUCTURE
 *    Include relevant context without sensitive information:
 *    ✅ { userId: "123", action: "login", timestamp: "..." }
 *    ❌ { password: "secret", creditCard: "1234..." }
 * 
 * 3. PROGRESS TRACKING PATTERN
 *    For long operations, dispatch regular progress events:
 *    await dispatchCustomEvent("progress", {
 *      current: i,
 *      total: items.length,
 *      percentage: (i / items.length) * 100,
 *      estimatedTimeRemaining: calculateETA()
 *    });
 * 
 * 4. ERROR TRACKING PATTERN
 *    Always dispatch events before operations that might fail:
 *    await dispatchCustomEvent("api_call_started", { endpoint, method });
 *    try {
 *      const result = await riskyOperation();
 *      await dispatchCustomEvent("api_call_succeeded", { endpoint, status: 200 });
 *    } catch (error) {
 *      await dispatchCustomEvent("api_call_failed", { endpoint, error: error.message });
 *      throw error;
 *    }
 * 
 * 5. PERFORMANCE CONSIDERATIONS
 *    - Events are processed asynchronously (no blocking)
 *    - Avoid dispatching events in tight loops without reason
 *    - Keep event data reasonably sized (< 1MB recommended)
 * 
 * 6. INTEGRATION WITH MONITORING SYSTEMS
 *    The JSONL format makes it easy to:
 *    - Stream to CloudWatch, Datadog, etc.
 *    - Process with jq or other JSON tools
 *    - Import into analytics databases
 *    - Create real-time dashboards
 * 
 * ===================================================================
 * DEBUGGING WITH CUSTOM EVENTS
 * ===================================================================
 * 
 * The hierarchy information helps debug complex flows:
 * 
 * Event log shows:           You can determine:
 * -------------------------  -------------------------------
 * hierarchy: ["A","B","C"]   Event was in C, which was called by B, which was called by A
 * depth: 3                   Event is 3 levels deep in the call stack
 * runId: "abc123..."         Exact run that dispatched the event
 * timestamp: "..."           Precise timing for performance analysis
 * 
 * Use the visualizer to see the complete execution tree:
 * npx ts-node src/examples/custom-events/visualize.ts
 * 
 * This will show:
 * - Complete run hierarchy as a tree
 * - All custom events attached to each run
 * - Timeline view with millisecond precision
 * - Statistics and insights
 */

if (require.main === module) {
  main().catch(console.error);
}
