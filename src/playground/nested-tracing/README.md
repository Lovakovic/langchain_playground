# Nested Tracing Example

This example demonstrates advanced tracing patterns for complex LangGraph architectures with nested subgraphs, similar to the structure used in the monkey-ai project.

## 📚 Code Documentation

The codebase is extensively commented to explain the whats and whys of nested tracing:

- **`nested-tracer.ts`** - Comprehensive explanations of hierarchy tracking, tool call association, and event capture patterns
- **`master-graph.ts`** - Detailed comments on graph architecture, subgraph composition, and orchestration patterns  
- **`extraction-subgraph.ts`** - Explanations of nested LLM calls, tool usage within subgraphs, and parallel processing
- **`states.ts`** - Documentation of state management, data flow patterns, and channel usage across graph boundaries
- **`types.ts`** - Type definitions with explanations of processing phases, event structures, and schema patterns

The comments focus on the **tracing challenges** and **implementation patterns** that make this architecture valuable for understanding complex graph execution.

## Overview

This example replicates the complex multi-layered graph structure from monkey-ai to demonstrate:

- **Tool call association** with both subgraph nodes and parent graph nodes
- **Event capture** across multiple nesting levels
- **Node hierarchy tracking** for proper context attribution  
- **Phase mapping** for processing pipeline visibility
- **Parallel execution** tracing with fan-out/fan-in patterns

## Architecture

### Master Graph Structure
```
initial_setup → extraction → deduplication → category_enrichment → merge_phase1_enrichments → prepare_phase2_enrichment
                                                                                                          ↓
                                                                           final_assembly ← allergen_enrichment
                                                                                         ← translation_enrichment
```

### Extraction Subgraph (Nested within Master)
```
file_processing_node → structure_analysis_node → item_extraction_node → format_output_node
```

### Enrichment Subgraphs (Parallel Processing)
- **Category Enrichment**: `category_analysis_node`
- **Allergen Enrichment**: `allergen_analysis_node` 
- **Translation Enrichment**: `translation_node`

## Key Tracing Features

### 1. Node Hierarchy Tracking
The `NestedTracer` maintains a stack of active nodes and tracks:
- Current execution level (0 = master graph, 1 = subgraph, etc.)
- Parent-child relationships between nodes
- Full execution path from root to current node

### 2. Tool Call Association
Tool calls are captured from `onLLMEnd` events and associated with:
- **Current Node**: The immediate node executing the LLM call
- **Parent Node**: The node that invoked the current node
- **Master Graph Node**: The top-level node in the execution path
- **Subgraph Node**: The subgraph-level node (if applicable)
- **Execution Path**: Complete path from master to current node

### 3. Event Types
- `phase:start` / `phase:end` - Node execution lifecycle
- `tool:end` - Tool call capture with full context
- `llm:end` - LLM completion with token usage
- `phase:error` - Error tracking with context

### 4. Processing Phases
Events are mapped to processing phases:
- `FILE_PROCESSING` - File handling and preparation
- `EXTRACTION` - Content analysis and item extraction  
- `ENRICHMENT_1` - First phase parallel enrichment
- `ENRICHMENT_2` - Second phase parallel enrichment
- `ASSEMBLY` - Final result assembly
- `COMPLETED` / `FAILED` - Terminal states

## Running the Example

```bash
# From the langchain_playground root
npx ts-node src/examples/tracing/nested-tracing/index.ts
```

## Example Output

The demo will show real-time event capture:

```
🚀 Executing master graph with nested subgraphs...

[phase:start] file_processing: Setting up processing pipeline...
  [phase:start] extraction: Executing extraction subgraph...
    [phase:start] file_processing: Processing input files...
    [phase:end] file_processing: Processing input files...
    [phase:start] extraction: Analyzing menu structure...
    [tool:end] extraction: Tool call: analyze_menu_structure
      🔧 Tool: analyze_menu_structure
      📍 Node: structure_analysis_node
      🏗️ Master: extraction
      🔗 Subgraph: structure_analysis_node
      📊 Path: extraction -> structure_analysis_node
```

## Analysis Features

The tracer provides comprehensive analysis:

### Execution Summary
- Total events captured
- Tool call count and associations
- Token usage tracking
- Phase breakdown

### Tool Call Analysis
Each tool call shows:
- Which node executed it
- Which master graph node initiated the chain
- Which subgraph node (if any) was involved
- Complete execution path
- Model used and token consumption

### Phase Breakdown
Event counts per processing phase with tool call attribution.

## Key Learnings for monkey-ai Implementation

This example demonstrates how to:

1. **Track nested execution context** using run metadata and node stacks
2. **Associate tool calls** with both immediate and parent graph contexts
3. **Handle parallel subgraph execution** while maintaining proper attribution
4. **Filter system events** to focus on user-defined nodes
5. **Build execution paths** for complete context understanding
6. **Capture token usage** and associate it with graph components

The patterns shown here can be directly applied to enhance the monkey-ai TargetedTracer for better observability of the complex menu processing pipeline.

## Files

- `types.ts` - Core type definitions and processing phases
- `states.ts` - LangGraph state definitions using Annotation.Root()
- `tools.ts` - Mock tools that simulate complex processing operations
- `extraction-subgraph.ts` - Multi-node subgraph with LLM calls and tools
- `enrichment-subgraphs.ts` - Parallel processing subgraphs
- `master-graph.ts` - Main orchestration graph with fan-out/fan-in
- `nested-tracer.ts` - Enhanced tracer with hierarchy tracking
- `index.ts` - Demo execution and analysis reporting