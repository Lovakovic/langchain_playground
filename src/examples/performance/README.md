# Performance

Benchmarking graph compilation time and memory usage.

## Example

### langgraph-performance
Comprehensive benchmarking script measuring React agent compilation speed and serialized size. Tests with/without MemorySaver checkpointer.

**Execution modes:**
- **Sequential** (default) - N iterations, statistical analysis (mean/min/max/stddev)
- **Parallel** - Stress test with N concurrent compilations, throughput calculation

**Metrics:**
- Compilation time (high-resolution via `perf_hooks`)
- Serialized size (V8 serialize + recursive deep-size with circular ref handling)
- Checkpointer overhead (time/size differential)

```bash
yarn run-example src/examples/performance/langgraph-performance/langgraph-performance.ts
yarn run-example src/examples/performance/langgraph-performance/langgraph-performance.ts parallel
```
