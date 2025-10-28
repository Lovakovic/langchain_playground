/**
 * LangGraph Performance Measurement Script
 *
 * This script measures the performance characteristics of LangGraph compilation:
 * 1. Compilation Time - How long it takes to compile a graph
 * 2. Compiled Graph Size - The serialized size of the compiled graph structure
 *
 * We use the React agent as a test case since it has:
 * - Multiple nodes (agent, tools)
 * - Conditional edges
 * - Tool integration
 * - State management
 *
 * Run with: npx ts-node src/examples/langgraph-performance/index.ts
 */

import { performance } from 'perf_hooks';
import { createReActAgent } from '../../agents/react-agent/react_agent';
import { MemorySaver } from '@langchain/langgraph';
import dotenv from 'dotenv';
import { serialize } from 'v8';

dotenv.config();

interface Statistics {
  mean: number;
  min: number;
  max: number;
  stdDev: number;
}

interface PropertyInfo {
  name: string;
  type: string;
  arrayLength?: number;
  objectType?: string;
  objectKeys?: number;
  functionLength?: number;
}

interface GraphStructure {
  type: string;
  properties: PropertyInfo[];
  propertyCount?: number;
  error?: string;
}

interface GraphSizeMetadata {
  nodes: number | string;
  hasCheckpointer: boolean;
  structure: GraphStructure;
  measurements: {
    v8Serialization: string;
    deepCalculation: string;
  };
}

interface GraphSizeResult {
  v8Size: number;
  deepSize: number;
  estimatedSize: number;
  kb: number;
  metadata: GraphSizeMetadata;
}

/**
 * Statistics utility to calculate mean, min, max, and standard deviation
 */
function calculateStats(values: number[]): Statistics {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return { mean, min, max, stdDev };
}

/**
 * Deep size calculator - recursively measures object size
 * Handles circular references and complex nested structures
 */
function calculateDeepSize(obj: unknown, seen = new WeakSet()): number {
  if (obj === null || obj === undefined) {
    return 0;
  }

  const type = typeof obj;

  // Primitives
  if (type === 'boolean') {
    return 4;
  }
  if (type === 'number') {
    return 8;
  }
  if (type === 'string') {
    return (obj as string).length * 2;
  } // UTF-16
  if (type === 'symbol') {
    return Symbol.keyFor(obj as symbol)?.length ?? 0;
  }

  // Avoid circular references
  if (type === 'object' || type === 'function') {
    if (seen.has(obj as object)) {
      return 0;
    }
    seen.add(obj as object);
  }

  // Functions - estimate size based on source code length
  if (type === 'function') {
    try {
      return (obj as Function).toString().length * 2;
    } catch {
      return 0;
    }
  }

  let size = 0;

  // Arrays
  if (Array.isArray(obj)) {
    size += obj.length * 8; // Array overhead
    for (const item of obj) {
      size += calculateDeepSize(item, seen);
    }
    return size;
  }

  // Objects
  if (type === 'object') {
    const objRecord = obj as Record<string, unknown>;
    // Object overhead
    size += 32;

    // Properties
    try {
      const keys = Object.keys(objRecord);
      for (const key of keys) {
        size += key.length * 2; // Key size
        try {
          size += calculateDeepSize(objRecord[key], seen);
        } catch {
          // Skip properties we can't access
        }
      }
    } catch {
      // Can't enumerate keys
    }
  }

  return size;
}

/**
 * Inspect graph structure to understand what it contains
 */
function inspectGraphStructure(graph: unknown): GraphStructure {
  const structure: GraphStructure = {
    type: (graph as Record<string, unknown>)?.constructor?.name || 'Unknown',
    properties: [],
  };

  try {
    const keys = Object.keys(graph as Record<string, unknown>);
    structure.propertyCount = keys.length;

    for (const key of keys) {
      try {
        const value = (graph as Record<string, unknown>)[key];
        const valueType = typeof value;
        const info: PropertyInfo = { name: key, type: valueType };

        if (valueType === 'object' && value !== null) {
          if (Array.isArray(value)) {
            info.arrayLength = value.length;
          } else {
            info.objectType = (value as { constructor?: { name?: string } }).constructor?.name;
            try {
              info.objectKeys = Object.keys(value as Record<string, unknown>).length;
            } catch {}
          }
        } else if (valueType === 'function') {
          info.functionLength = (value as Function).toString().length;
        }

        structure.properties.push(info);
      } catch {
        structure.properties.push({ name: key, type: 'inaccessible' });
      }
    }
  } catch (error) {
    structure.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return structure;
}

/**
 * Measure the size of a compiled graph using multiple approaches
 */
function measureGraphSize(graph: unknown): GraphSizeResult {
  let v8Size = 0;
  let deepSize = 0;

  // Approach 1: Try V8 serialization (most accurate for serializable parts)
  try {
    const serialized = serialize(graph);
    v8Size = serialized.length;
  } catch (error) {
    // V8 serialize might fail on some objects
    v8Size = -1;
  }

  // Approach 2: Deep recursive size calculation
  try {
    deepSize = calculateDeepSize(graph);
  } catch (error) {
    deepSize = -1;
  }

  // Approach 3: Inspect structure
  const structure = inspectGraphStructure(graph);

  // Use the best available measurement
  const estimatedSize = v8Size > 0 ? v8Size : deepSize > 0 ? deepSize : 0;

  const graphRecord = graph as Record<string, unknown>;
  return {
    v8Size,
    deepSize,
    estimatedSize,
    kb: estimatedSize / 1024,
    metadata: {
      nodes: graphRecord['nodes']
        ? Object.keys(graphRecord['nodes'] as Record<string, unknown>).length
        : 'N/A',
      hasCheckpointer: !!graphRecord['checkpointer'],
      structure,
      measurements: {
        v8Serialization: v8Size > 0 ? `${v8Size} bytes` : 'Failed',
        deepCalculation: deepSize > 0 ? `${deepSize} bytes` : 'Failed',
      },
    },
  };
}

/**
 * Run a single compilation benchmark
 */
async function runSingleBenchmark(withCheckpointer: boolean): Promise<{
  compilationTime: number;
  graphSize: ReturnType<typeof measureGraphSize>;
}> {
  const startTime = performance.now();

  // Create the React agent (this includes compilation)
  const checkpointer = withCheckpointer ? new MemorySaver() : undefined;
  const graph = await createReActAgent(checkpointer);

  const endTime = performance.now();
  const compilationTime = endTime - startTime;

  // Measure the compiled graph size
  const graphSize = measureGraphSize(graph);

  return {
    compilationTime,
    graphSize,
  };
}

/**
 * Run parallel compilation benchmark - compiles multiple graphs simultaneously
 */
async function runParallelBenchmark(count: number = 100, withCheckpointer: boolean = false) {
  console.log(
    `\n🚀 Parallel Compilation Benchmark: ${count} graphs ${withCheckpointer ? 'WITH' : 'WITHOUT'} checkpointer`,
  );
  console.log('─'.repeat(60));

  const startTime = performance.now();

  // Create array of compilation promises
  const compilationPromises = Array.from({ length: count }, () =>
    runSingleBenchmark(withCheckpointer),
  );

  // Run all compilations in parallel
  const results = await Promise.all(compilationPromises);

  const endTime = performance.now();
  const totalTime = endTime - startTime;

  // Extract individual compilation times
  const compilationTimes = results.map((r) => r.compilationTime);
  const stats = calculateStats(compilationTimes);

  // Calculate total graph size (all graphs combined)
  const totalGraphSize = results.reduce((sum, r) => sum + r.graphSize.estimatedSize, 0);
  const avgGraphSize = totalGraphSize / count;

  // Get detailed size info from first graph
  const firstGraphSize = results[0]?.graphSize;

  console.log(`\n⏱️  Total Time (Parallel): ${totalTime.toFixed(2)} ms`);
  console.log(`   Average per graph: ${(totalTime / count).toFixed(2)} ms`);
  console.log(`   Throughput: ${(count / (totalTime / 1000)).toFixed(2)} graphs/second`);

  console.log(`\n📊 Individual Compilation Times:`);
  console.log(`   Average: ${stats.mean.toFixed(2)} ms`);
  console.log(`   Min:     ${stats.min.toFixed(2)} ms`);
  console.log(`   Max:     ${stats.max.toFixed(2)} ms`);
  console.log(`   Std Dev: ${stats.stdDev.toFixed(2)} ms`);

  if (firstGraphSize) {
    console.log(`\n📦 Graph Size (per graph):`);
    console.log(
      `   V8 Serialization: ${firstGraphSize.v8Size > 0 ? `${firstGraphSize.v8Size.toLocaleString()} bytes (${(firstGraphSize.v8Size / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Deep Calculation: ${firstGraphSize.deepSize > 0 ? `${firstGraphSize.deepSize.toLocaleString()} bytes (${(firstGraphSize.deepSize / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Estimated Size:   ${avgGraphSize.toLocaleString()} bytes (${(avgGraphSize / 1024).toFixed(2)} KB)`,
    );
    console.log(
      `\n   Total (${count} graphs): ${totalGraphSize.toLocaleString()} bytes (${(totalGraphSize / 1024 / 1024).toFixed(2)} MB)`,
    );

    console.log(`\n🔍 Graph Structure:`);
    console.log(`   ${JSON.stringify(firstGraphSize.metadata.structure, null, 2)}`);
  }

  return {
    totalTime,
    avgTimePerGraph: totalTime / count,
    throughput: count / (totalTime / 1000),
    individualStats: stats,
    totalGraphSize,
    avgGraphSize,
    sizeDetails: firstGraphSize,
  };
}

/**
 * Run multiple iterations and collect statistics
 */
async function runPerformanceBenchmark(iterations: number = 10) {
  console.log('=== LangGraph Performance Benchmark ===\n');
  console.log(`Running ${iterations} iterations for each configuration...\n`);

  // Test without checkpointer
  console.log('📊 Benchmark 1: Graph WITHOUT Checkpointer');
  console.log('─'.repeat(60));

  const withoutCheckpointerTimes: number[] = [];
  let withoutCheckpointerSize: GraphSizeResult | null = null;

  for (let i = 0; i < iterations; i++) {
    process.stdout.write(`\rIteration ${i + 1}/${iterations}...`);
    const result = await runSingleBenchmark(false);
    withoutCheckpointerTimes.push(result.compilationTime);
    if (i === 0) {
      withoutCheckpointerSize = result.graphSize;
    }
  }
  process.stdout.write(`\r${' '.repeat(50)}\r`);

  const withoutCheckpointerStats = calculateStats(withoutCheckpointerTimes);

  console.log('\n⏱️  Compilation Time Statistics:');
  console.log(`   Average: ${withoutCheckpointerStats.mean.toFixed(2)} ms`);
  console.log(`   Min:     ${withoutCheckpointerStats.min.toFixed(2)} ms`);
  console.log(`   Max:     ${withoutCheckpointerStats.max.toFixed(2)} ms`);
  console.log(`   Std Dev: ${withoutCheckpointerStats.stdDev.toFixed(2)} ms`);

  if (withoutCheckpointerSize) {
    console.log('\n📦 Compiled Graph Size:');
    console.log(
      `   V8 Serialization: ${withoutCheckpointerSize.v8Size > 0 ? `${withoutCheckpointerSize.v8Size.toLocaleString()} bytes (${(withoutCheckpointerSize.v8Size / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Deep Calculation: ${withoutCheckpointerSize.deepSize > 0 ? `${withoutCheckpointerSize.deepSize.toLocaleString()} bytes (${(withoutCheckpointerSize.deepSize / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Estimated Size:   ${withoutCheckpointerSize.estimatedSize.toLocaleString()} bytes (${withoutCheckpointerSize.kb.toFixed(2)} KB)`,
    );

    console.log('\n🔍 Graph Structure:');
    console.log(`   ${JSON.stringify(withoutCheckpointerSize.metadata.structure, null, 2)}`);
  }

  // Test with checkpointer
  console.log('\n\n📊 Benchmark 2: Graph WITH Checkpointer (MemorySaver)');
  console.log('─'.repeat(60));

  const withCheckpointerTimes: number[] = [];
  let withCheckpointerSize: GraphSizeResult | null = null;

  for (let i = 0; i < iterations; i++) {
    process.stdout.write(`\rIteration ${i + 1}/${iterations}...`);
    const result = await runSingleBenchmark(true);
    withCheckpointerTimes.push(result.compilationTime);
    if (i === 0) {
      withCheckpointerSize = result.graphSize;
    }
  }
  process.stdout.write(`\r${' '.repeat(50)}\r`);

  const withCheckpointerStats = calculateStats(withCheckpointerTimes);

  console.log('\n⏱️  Compilation Time Statistics:');
  console.log(`   Average: ${withCheckpointerStats.mean.toFixed(2)} ms`);
  console.log(`   Min:     ${withCheckpointerStats.min.toFixed(2)} ms`);
  console.log(`   Max:     ${withCheckpointerStats.max.toFixed(2)} ms`);
  console.log(`   Std Dev: ${withCheckpointerStats.stdDev.toFixed(2)} ms`);

  if (withCheckpointerSize) {
    console.log('\n📦 Compiled Graph Size:');
    console.log(
      `   V8 Serialization: ${withCheckpointerSize.v8Size > 0 ? `${withCheckpointerSize.v8Size.toLocaleString()} bytes (${(withCheckpointerSize.v8Size / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Deep Calculation: ${withCheckpointerSize.deepSize > 0 ? `${withCheckpointerSize.deepSize.toLocaleString()} bytes (${(withCheckpointerSize.deepSize / 1024).toFixed(2)} KB)` : 'Failed'}`,
    );
    console.log(
      `   Estimated Size:   ${withCheckpointerSize.estimatedSize.toLocaleString()} bytes (${withCheckpointerSize.kb.toFixed(2)} KB)`,
    );

    console.log('\n🔍 Graph Structure:');
    console.log(`   ${JSON.stringify(withCheckpointerSize.metadata.structure, null, 2)}`);
  }

  // Summary comparison
  console.log('\n\n📈 Summary Comparison');
  console.log('─'.repeat(60));
  console.log(`Without Checkpointer: ${withoutCheckpointerStats.mean.toFixed(2)} ms avg`);
  console.log(`With Checkpointer:    ${withCheckpointerStats.mean.toFixed(2)} ms avg`);

  const timeDiff = withCheckpointerStats.mean - withoutCheckpointerStats.mean;
  const percentDiff = ((timeDiff / withoutCheckpointerStats.mean) * 100).toFixed(1);

  if (timeDiff > 0) {
    console.log(`\nCheckpointer adds ~${timeDiff.toFixed(2)} ms (${percentDiff}% slower)`);
  } else {
    console.log(
      `\nCheckpointer reduces time by ~${Math.abs(timeDiff).toFixed(2)} ms (${Math.abs(Number(percentDiff))}% faster)`,
    );
  }

  console.log('\n✅ Benchmark complete!\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    const mode = process.argv[2] || 'sequential';
    const count = process.argv[3] ? parseInt(process.argv[3]) : mode === 'parallel' ? 100 : 10;

    if (mode === 'parallel') {
      if (isNaN(count) || count < 1) {
        console.error('Error: Count must be a positive number');
        console.log(
          'Usage: npx ts-node src/examples/langgraph-performance/index.ts parallel [count]',
        );
        console.log(
          'Example: npx ts-node src/examples/langgraph-performance/index.ts parallel 100',
        );
        process.exit(1);
      }

      console.log('=== LangGraph Parallel Compilation Benchmark ===');

      // Run parallel benchmark without checkpointer
      const withoutResults = await runParallelBenchmark(count, false);

      // Run parallel benchmark with checkpointer
      const withResults = await runParallelBenchmark(count, true);

      // Comparison
      console.log('\n\n📈 Parallel Benchmark Comparison');
      console.log('─'.repeat(60));
      console.log(`Without Checkpointer: ${withoutResults.totalTime.toFixed(2)} ms total`);
      console.log(`                      ${withoutResults.throughput.toFixed(2)} graphs/sec`);
      console.log(`\nWith Checkpointer:    ${withResults.totalTime.toFixed(2)} ms total`);
      console.log(`                      ${withResults.throughput.toFixed(2)} graphs/sec`);

      const timeDiff = withResults.totalTime - withoutResults.totalTime;
      const percentDiff = ((timeDiff / withoutResults.totalTime) * 100).toFixed(1);

      if (timeDiff > 0) {
        console.log(`\nCheckpointer adds ~${timeDiff.toFixed(2)} ms (${percentDiff}% slower)`);
      } else {
        console.log(
          `\nCheckpointer reduces time by ~${Math.abs(timeDiff).toFixed(2)} ms (${Math.abs(Number(percentDiff))}% faster)`,
        );
      }

      console.log('\n✅ Benchmark complete!\n');
    } else if (mode === 'sequential' || !isNaN(parseInt(mode))) {
      // Sequential mode (original behavior)
      const iterations = !isNaN(parseInt(mode)) ? parseInt(mode) : count;

      if (isNaN(iterations) || iterations < 1) {
        console.error('Error: Iterations must be a positive number');
        console.log('Usage: npx ts-node src/examples/langgraph-performance/index.ts [iterations]');
        console.log('Example: npx ts-node src/examples/langgraph-performance/index.ts 20');
        process.exit(1);
      }

      await runPerformanceBenchmark(iterations);
    } else {
      console.log('Usage:');
      console.log(
        '  Sequential: npx ts-node src/examples/langgraph-performance/index.ts [iterations]',
      );
      console.log(
        '  Parallel:   npx ts-node src/examples/langgraph-performance/index.ts parallel [count]',
      );
      console.log('\nExamples:');
      console.log('  npx ts-node src/examples/langgraph-performance/index.ts 20');
      console.log('  npx ts-node src/examples/langgraph-performance/index.ts parallel 100');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runPerformanceBenchmark, measureGraphSize, calculateStats };
