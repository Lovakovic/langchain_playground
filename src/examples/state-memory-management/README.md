# LangGraph State Memory Management Examples

This directory contains examples demonstrating various memory management patterns in LangGraph when processing large datasets.

## Examples

### 1. `index.ts` - Comprehensive Memory Management Patterns
Shows multiple patterns for managing memory in LangGraph:
- Memory-limited reducers for arrays
- Clearable reducers for temporary data
- Subgraph state segmentation
- Batch processing patterns

Run: `npx ts-node src/examples/state-memory-management/index.ts`

### 2. `memory-demo.ts` - Real Memory Behavior with Garbage Collection
Demonstrates actual memory behavior with forced garbage collection:
- Shows the problem of unbounded memory growth
- Window-based memory management
- Stage-based cleanup
- Streaming patterns

Run with GC exposed for accurate results:
```bash
node --expose-gc -r ts-node/register src/examples/state-memory-management/memory-demo.ts
```

## Key Memory Management Patterns

### 1. Memory-Limited Reducer
Prevents unbounded array growth by keeping only the last N items:

```typescript
const memoryLimitedReducer = (maxItems: number) => {
  return (current: any[], update: any[]) => {
    const combined = current.concat(update);
    if (combined.length <= maxItems) {
      return combined;
    }
    return combined.slice(-maxItems);
  };
};
```

### 2. Clearable Reducer
Allows clearing data by sending a "CLEAR" signal:

```typescript
const clearableReducer = (current: any, update: any) => {
  if (update === "CLEAR") return null;
  return update;
};
```

### 3. Subgraph State Segmentation
Use input/output schemas to control what data subgraphs can access:

```typescript
const Stage1 = new StateGraph({
  input: InputSchema,    // What it can read
  output: OutputSchema,  // What it can write
  stateSchema: InternalSchema  // Internal working state
});
```

### 4. Batch Processing
Process large datasets in manageable chunks:

```typescript
// Process data in batches, clearing each batch after processing
for (const batch of batches) {
  const result = await processBatch(batch);
  // batch goes out of scope and can be GC'd
}
```

## Best Practices

1. **Extract Features, Not Raw Data**: Instead of keeping large buffers, extract and store only the essential information (statistics, features, summaries).

2. **Use Window-Based Reducers**: For logs, messages, or any accumulating data, use reducers that limit the maximum items kept.

3. **Clear Between Stages**: Use clearable reducers for temporary data that's only needed within a stage.

4. **Monitor Memory Usage**: Log memory usage at key points to understand your pipeline's behavior.

5. **Use Streaming When Possible**: Process data in chunks rather than loading everything into memory.

6. **Force GC in Tests**: When testing memory behavior, use `--expose-gc` flag to see immediate effects.

## Memory Monitoring

All examples include memory logging helpers:

```typescript
function logMemoryUsage(label: string) {
  const used = process.memoryUsage();
  console.log(`💾 [${label}] Memory Usage:`);
  console.log(`   - RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - External: ${(used.external / 1024 / 1024).toFixed(2)} MB`);
}
```

## Important Notes

- Node.js doesn't immediately release memory back to the OS
- RSS (Resident Set Size) may remain high even after cleanup
- External memory usage better reflects actual data in memory
- Use `--expose-gc` flag to force garbage collection in demos
- In production, let Node.js manage GC automatically