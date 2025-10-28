# Graph Patterns

Parallel execution, input/output schemas, and fan-in aggregation patterns.

## Examples

### input-output-schema
Solves INVALID_CONCURRENT_GRAPH_UPDATE error for parallel subgraphs. Three parallel content analyzers (Reddit, Twitter, News) each write to unique state channels via output schemas.

**Files:**
- `input-output-schema.ts` - Fixed version with proper schemas
- `broken-example.ts` - Shows the failure case (educational)

### parallel-execution
Two fan-in aggregation patterns:

**Files:**
- `parallel-graph-execution.ts` - Default behavior: aggregation runs **4 times** (once per branch completion). Demonstrates streaming pattern.
- `wait-for-all-branches.ts` - Array syntax: `addEdge(["n1", "n2", "n3"], "agg")` runs aggregation **once** after all branches complete.

**Key difference:** Default = real-time streaming updates, Array syntax = final synchronization
