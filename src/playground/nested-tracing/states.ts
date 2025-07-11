import { Annotation } from '@langchain/langgraph';
import { MockMenuItem, MockFileMetadata } from './types';

/**
 * State Management for Nested Graph Architecture
 * 
 * This file demonstrates the state management patterns used in complex LangGraph
 * architectures like monkey-ai. The key challenge for tracing is understanding
 * how state flows between master graphs and subgraphs, and how different nodes
 * modify shared state.
 * 
 * The NestedTracer captures events from nodes that read and modify this state,
 * providing visibility into the data flow patterns.
 */

/**
 * Master Graph State - Top-level state for the entire processing pipeline
 * 
 * This state is shared across all nodes in the master graph and passed down
 * to subgraphs. It mirrors the complex state structure from monkey-ai that
 * accumulates results from multiple processing phases.
 * 
 * The tracer can associate events with specific state channels to understand
 * what data each node is working with.
 */
export const MasterGraphState = Annotation.Root({
  // === INPUT CHANNELS ===
  // These channels provide the initial data for processing
  
  inputFiles: Annotation<MockFileMetadata[]>({
    reducer: (x, y) => y ?? x ?? [], // Use new value if provided, otherwise keep existing
  }),
  menuId: Annotation<string>({
    reducer: (x, y) => y ?? x, // Simple replacement reducer
  }),

  // === EXTRACTION OUTPUTS ===
  // These channels are populated by the extraction subgraph
  
  extractedItems: Annotation<MockMenuItem[]>({
    reducer: (x, y) => y ?? x ?? [],
    // The tracer can show when this channel is populated by the extraction subgraph
  }),
  menuStructure: Annotation<Array<{ name: string; itemCount: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Shows the structural analysis results from nested structure_analysis_node
  }),

  // === ENRICHMENT RESULTS ===
  // These channels are populated by various enrichment subgraphs
  // The tracer can show the parallel population of these channels
  
  categorizedItems: Annotation<Array<{ itemId: string; category: string; confidence: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Populated by category_enrichment subgraph
  }),
  allergenInfo: Annotation<Array<{ itemId: string; allergens: string[]; confidence: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Populated by allergen_enrichment subgraph (in parallel with translation)
  }),
  translatedItems: Annotation<Array<{ itemId: string; translatedName: string; translatedDescription?: string }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Populated by translation_enrichment subgraph (in parallel with allergen)
  }),

  // === FINAL OUTPUTS ===
  // These channels contain the final assembled results
  
  finalMenuStructure: Annotation<any>({
    reducer: (x, y) => y ?? x,
    // The complete menu structure assembled from all enrichment results
  }),
  completenessScore: Annotation<number>({
    reducer: (x, y) => y ?? x ?? 0,
    // Quality metric calculated from the enrichment coverage
  }),

  // === ERROR TRACKING ===
  // Error accumulation across all processing phases
  
  errorLog: Annotation<string[]>({
    reducer: (x, y) => {
      const combined = [...(x ?? []), ...(y ?? [])];
      return combined.slice(-50); // Keep last 50 errors like monkey-ai does
    },
    // This reducer demonstrates how errors accumulate across nested operations
    // The tracer can show which nodes contribute errors to this log
  }),
});

/**
 * Extraction Subgraph State - Specialized state for the extraction pipeline
 * 
 * This demonstrates how subgraphs can have their own state management while
 * still participating in the master graph's state flow. The extraction subgraph
 * receives input from the master state and produces output that flows back up.
 * 
 * The tracer shows how state transitions within this subgraph and how the
 * final output integrates with the master graph state.
 */
export const ExtractionState = Annotation.Root({
  // === INPUT FROM MASTER GRAPH ===
  inputFiles: Annotation<MockFileMetadata[]>({
    reducer: (x, y) => y ?? x ?? [],
    // Passed down from master graph state
  }),

  // === INTERNAL PROCESSING STATE ===
  // These channels are used internally within the extraction subgraph
  
  processedContent: Annotation<string>({
    reducer: (x, y) => y ?? x ?? '',
    // Intermediate result from file_processing_node
  }),
  menuStructure: Annotation<Array<{ name: string; itemCount: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Result from structure_analysis_node (with tool calls)
  }),
  extractedItems: Annotation<MockMenuItem[]>({
    reducer: (x, y) => y ?? x ?? [],
    // Result from item_extraction_node (with parallel tool calls)
  }),

  // === ERROR TRACKING ===
  errorLog: Annotation<string[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
    // Subgraph-specific error tracking
  }),
});

/**
 * Enrichment Subgraph States - Specialized states for parallel enrichment
 * 
 * These states demonstrate how parallel subgraphs can each have their own
 * specialized state while working on the same base data. The tracer shows
 * how these parallel operations execute simultaneously and contribute to
 * different channels in the master state.
 */

// Category enrichment subgraph state
export const CategoryEnrichmentState = Annotation.Root({
  extractedItems: Annotation<MockMenuItem[]>({
    reducer: (x, y) => y ?? x ?? [],
    // Input from master graph (items to categorize)
  }),
  categorizedItems: Annotation<Array<{ itemId: string; category: string; confidence: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Output: category analysis results (flows back to master)
  }),
  errorLog: Annotation<string[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
  }),
});

// Allergen enrichment subgraph state  
export const AllergenEnrichmentState = Annotation.Root({
  extractedItems: Annotation<MockMenuItem[]>({
    reducer: (x, y) => y ?? x ?? [],
    // Same input as category enrichment (parallel processing)
  }),
  allergenInfo: Annotation<Array<{ itemId: string; allergens: string[]; confidence: number }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Output: allergen analysis results (flows back to master)
  }),
  errorLog: Annotation<string[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
  }),
});

// Translation enrichment subgraph state
export const TranslationEnrichmentState = Annotation.Root({
  extractedItems: Annotation<MockMenuItem[]>({
    reducer: (x, y) => y ?? x ?? [],
    // Same input as other enrichment subgraphs (parallel processing)
  }),
  translatedItems: Annotation<Array<{ itemId: string; translatedName: string; translatedDescription?: string }>>({
    reducer: (x, y) => y ?? x ?? [],
    // Output: translation results (flows back to master)
  }),
  errorLog: Annotation<string[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
  }),
});

/**
 * State Flow Pattern Summary
 * 
 * The state management here demonstrates the key patterns that the NestedTracer tracks:
 * 
 * 1. **Hierarchical State Flow**: Master graph state flows down to subgraphs
 * 2. **Parallel Processing**: Multiple subgraphs work on the same input simultaneously  
 * 3. **Result Aggregation**: Subgraph outputs flow back up to master state channels
 * 4. **Error Accumulation**: Errors bubble up from nested operations
 * 
 * The tracer captures when each node reads from and writes to these state channels,
 * providing visibility into the complex data flow patterns in nested graph architectures.
 */