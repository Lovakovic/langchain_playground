/**
 * LangGraph Memory Management Demo with Forced GC
 * 
 * This example demonstrates real memory management by forcing garbage collection
 * and showing how LangGraph state patterns can help control memory usage.
 * 
 * Run with: node --expose-gc -r ts-node/register src/examples/state-memory-management/memory-demo.ts
 */

import { Annotation, MemorySaver, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
import { randomBytes } from "crypto";

dotenv.config();

// Force garbage collection if available
function forceGC() {
  if (global.gc) {
    console.log("🔧 Running garbage collection...");
    global.gc();
  } else {
    console.log("⚠️  Garbage collection not exposed. Run with --expose-gc flag");
  }
}

// Helper to log memory usage
function logMemoryUsage(label: string) {
  const used = process.memoryUsage();
  console.log(`\n💾 [${label}] Memory Usage:`);
  console.log(`   - RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Total: ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - External: ${(used.external / 1024 / 1024).toFixed(2)} MB`);
}

// Generate large data that's compressible
function generateLargeData(sizeMB: number): Buffer {
  console.log(`🔄 Generating ${sizeMB}MB of data...`);
  const sizeBytes = sizeMB * 1024 * 1024;
  return randomBytes(sizeBytes);
}

/**
 * PROBLEM: Memory Explosion Without Management
 */
const UnmanagedState = Annotation.Root({
  // This will grow unbounded
  allData: Annotation<Buffer[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  })
});

async function unmanagedPipeline() {
  console.log("\n❌ UNMANAGED PIPELINE - Memory will grow unbounded");
  console.log("=".repeat(50));
  
  const workflow = new StateGraph(UnmanagedState)
    .addNode("process", async (state) => {
      const data = generateLargeData(50);
      return {
        allData: [data],
        messages: [new AIMessage(`Added ${data.length / 1024 / 1024}MB`)]
      };
    })
    .addEdge("__start__", "process")
    .addEdge("process", "__end__")
    .compile();
  
  logMemoryUsage("Start");
  
  // Process multiple times
  let state: typeof UnmanagedState.State = { allData: [], messages: [] };
  for (let i = 0; i < 5; i++) {
    console.log(`\n📦 Iteration ${i + 1}`);
    state = await workflow.invoke(state);
    logMemoryUsage(`After iteration ${i + 1}`);
    
    console.log(`Total data in state: ${state.allData.length} buffers`);
    const totalMB = state.allData.reduce((sum, buf) => sum + buf.length, 0) / 1024 / 1024;
    console.log(`Total memory held: ${totalMB.toFixed(2)}MB`);
  }
  
  forceGC();
  logMemoryUsage("After GC (data still referenced)");
  
  // Clear reference and GC again
  state = null as any;
  forceGC();
  logMemoryUsage("After clearing references and GC");
}

/**
 * SOLUTION 1: Window-Based Memory Management
 */
const windowReducer = (windowSize: number) => {
  return (current: any[], update: any[]) => {
    const combined = current.concat(update);
    if (combined.length <= windowSize) {
      return combined;
    }
    console.log(`🪟 Sliding window: keeping last ${windowSize} of ${combined.length} items`);
    return combined.slice(-windowSize);
  };
};

const WindowManagedState = Annotation.Root({
  // Keep only last N items
  recentData: Annotation<Buffer[]>({
    reducer: windowReducer(2),
    default: () => []
  }),
  
  // Keep summary statistics instead of raw data
  stats: Annotation<{ totalProcessed: number; avgSize: number }>({
    reducer: (current, update) => ({
      totalProcessed: current.totalProcessed + update.totalProcessed,
      avgSize: (current.avgSize * current.totalProcessed + update.avgSize * update.totalProcessed) 
               / (current.totalProcessed + update.totalProcessed)
    }),
    default: () => ({ totalProcessed: 0, avgSize: 0 })
  }),
  
  messages: Annotation<BaseMessage[]>({
    reducer: windowReducer(3),
    default: () => []
  })
});

async function windowManagedPipeline() {
  console.log("\n✅ WINDOW-MANAGED PIPELINE - Memory bounded by window size");
  console.log("=".repeat(50));
  
  const workflow = new StateGraph(WindowManagedState)
    .addNode("process", async (state) => {
      const data = generateLargeData(50);
      const sizeMB = data.length / 1024 / 1024;
      
      return {
        recentData: [data],
        stats: { totalProcessed: 1, avgSize: sizeMB },
        messages: [new AIMessage(`Processed ${sizeMB}MB`)]
      };
    })
    .addEdge("__start__", "process")
    .addEdge("process", "__end__")
    .compile();
  
  logMemoryUsage("Start");
  
  let state: typeof WindowManagedState.State = { recentData: [], stats: { totalProcessed: 0, avgSize: 0 }, messages: [] };
  for (let i = 0; i < 5; i++) {
    console.log(`\n📦 Iteration ${i + 1}`);
    state = await workflow.invoke(state);
    
    console.log(`Items in window: ${state.recentData.length}`);
    console.log(`Total processed: ${state.stats.totalProcessed}`);
    console.log(`Average size: ${state.stats.avgSize.toFixed(2)}MB`);
    
    forceGC();
    logMemoryUsage(`After iteration ${i + 1} + GC`);
  }
}

/**
 * SOLUTION 2: Stage-Based Cleanup
 */
const StageCleanupState = Annotation.Root({
  stage: Annotation<"generate" | "process" | "cleanup">,
  
  // Temporary data that gets cleared
  tempData: Annotation<Buffer | null>({
    reducer: (_, update) => update,
    default: () => null
  }),
  
  // Only keep extracted features
  features: Annotation<number[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  })
});

async function stageCleanupPipeline() {
  console.log("\n✅ STAGE-BASED CLEANUP - Clear data between stages");
  console.log("=".repeat(50));
  
  const workflow = new StateGraph(StageCleanupState)
    .addNode("generate", async (state) => {
      console.log("\n🔵 Stage: Generate");
      logMemoryUsage("Before generate");
      
      const data = generateLargeData(100);
      
      logMemoryUsage("After generate");
      return {
        stage: "process" as const,
        tempData: data
      };
    })
    
    .addNode("process", async (state) => {
      console.log("\n🟢 Stage: Process");
      if (!state.tempData) throw new Error("No data");
      
      // Extract features (small data) from large data
      const features = Array(10).fill(0).map(() => Math.random());
      
      return {
        stage: "cleanup" as const,
        features
      };
    })
    
    .addNode("cleanup", async (state) => {
      console.log("\n🧹 Stage: Cleanup");
      logMemoryUsage("Before cleanup");
      
      // Clear the temporary data
      const result = {
        stage: "generate" as const,
        tempData: null
      };
      
      // Force GC to show immediate effect
      forceGC();
      logMemoryUsage("After cleanup + GC");
      
      return result;
    })
    
    .addEdge("__start__", "generate")
    .addConditionalEdges("generate", (state) => state.stage)
    .addConditionalEdges("process", (state) => state.stage)
    .addConditionalEdges("cleanup", (state) => "__end__")
    .compile();
  
  const result = await workflow.invoke({
    stage: "generate" as const,
    tempData: null,
    features: []
  });
  
  console.log(`\n📊 Final features extracted: ${result.features.length}`);
  console.log(`Temp data cleared: ${result.tempData === null ? "✅" : "❌"}`);
}

/**
 * SOLUTION 3: Streaming with Immediate Cleanup
 */
async function* streamLargeData(sizeMB: number, chunkMB: number) {
  const totalChunks = Math.ceil(sizeMB / chunkMB);
  
  for (let i = 0; i < totalChunks; i++) {
    console.log(`\n📤 Generating chunk ${i + 1}/${totalChunks}`);
    const chunk = generateLargeData(chunkMB);
    yield { chunk, index: i };
    
    // Allow GC between chunks
    if (global.gc) {
      global.gc();
    }
  }
}

async function streamingPipeline() {
  console.log("\n✅ STREAMING PIPELINE - Process chunks without holding all in memory");
  console.log("=".repeat(50));
  
  const StreamState = Annotation.Root({
    processedChunks: Annotation<number>,
    totalSize: Annotation<number>,
    checksum: Annotation<number>
  });
  
  const workflow = new StateGraph(StreamState)
    .addNode("process_chunk", async (state) => {
      // In real scenario, chunk would come from input
      // Here we just update counters
      return {
        processedChunks: state.processedChunks + 1,
        totalSize: state.totalSize + 10, // 10MB per chunk
        checksum: state.checksum + Math.random()
      };
    })
    .addEdge("__start__", "process_chunk")
    .addEdge("process_chunk", "__end__")
    .compile();
  
  logMemoryUsage("Start");
  
  let state = { processedChunks: 0, totalSize: 0, checksum: 0 };
  
  // Process data stream
  for await (const { chunk, index } of streamLargeData(50, 10)) {
    console.log(`Processing chunk ${index + 1}`);
    
    // Process chunk
    const chunkSize = chunk.length / 1024 / 1024;
    state = await workflow.invoke(state);
    
    // Chunk goes out of scope here and can be GC'd
    logMemoryUsage(`After chunk ${index + 1}`);
  }
  
  console.log(`\n📊 Streaming complete:`);
  console.log(`- Chunks processed: ${state.processedChunks}`);
  console.log(`- Total size: ${state.totalSize}MB`);
  console.log(`- Never held more than one chunk in memory!`);
}

/**
 * Main Demo
 */
async function runMemoryDemo() {
  console.log("=== 🧠 Real Memory Management in LangGraph ===");
  console.log("\nThis demo shows actual memory behavior with garbage collection.");
  console.log("Run with: node --expose-gc -r ts-node/register <this-file>");
  
  if (!global.gc) {
    console.log("\n⚠️  WARNING: GC not exposed. Results may not show immediate cleanup.");
    console.log("    Add --expose-gc flag for accurate results.\n");
  }
  
  // Show the problem
  await unmanagedPipeline();
  
  // Wait and GC before next demo
  await new Promise(resolve => setTimeout(resolve, 1000));
  forceGC();
  
  // Show solutions
  await windowManagedPipeline();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  forceGC();
  
  await stageCleanupPipeline();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  forceGC();
  
  await streamingPipeline();
  
  console.log("\n\n🎯 Key Insights:");
  console.log("1. Node.js doesn't immediately release memory to OS");
  console.log("2. Use --expose-gc to force garbage collection in demos");
  console.log("3. Window-based reducers prevent unbounded growth");
  console.log("4. Stage-based cleanup with null assignments helps GC");
  console.log("5. Streaming patterns avoid holding all data at once");
  console.log("6. Extract summaries/features instead of keeping raw data");
}

if (require.main === module) {
  runMemoryDemo().catch(console.error);
}