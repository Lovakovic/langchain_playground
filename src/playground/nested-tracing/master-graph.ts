import { END, START, StateGraph } from '@langchain/langgraph';
import { MasterGraphState } from './states';
import { MockMenuItem, MockFileMetadata } from './types';
import { createExtractionSubgraph } from './extraction-subgraph';
import { 
  createCategoryEnrichmentSubgraph, 
  createAllergenEnrichmentSubgraph, 
  createTranslationEnrichmentSubgraph 
} from './enrichment-subgraphs';

/**
 * Master Graph Implementation
 * 
 * This graph replicates the high-level architecture from monkey-ai's master graph.
 * It demonstrates the complex orchestration patterns that the NestedTracer is designed to handle:
 * 
 * 1. Sequential processing phases (setup -> extraction -> deduplication)
 * 2. Parallel enrichment phases (fan-out/fan-in patterns)
 * 3. Nested subgraph integration (extraction subgraph, enrichment subgraphs)
 * 4. State management across multiple processing stages
 * 
 * The key architectural pattern here is that subgraphs are added as nodes to the master graph,
 * creating the nested structure that requires sophisticated tracing.
 */

/**
 * Initial setup node - Entry point for the processing pipeline
 * 
 * This simulates the setup and validation that occurs before actual processing.
 * In monkey-ai, this might include file validation, credential checks, etc.
 */
async function initialSetupNode(state: typeof MasterGraphState.State): Promise<Partial<typeof MasterGraphState.State>> {
  console.log(`🚀 Starting menu processing for menuId: ${state.menuId}`);
  console.log(`📁 Input files: ${state.inputFiles?.length || 0}`);
  
  // Simulate initial validation and setup work
  await new Promise(resolve => setTimeout(resolve, 50));
  
  return {}; // No state changes, just setup
}

/**
 * Deduplication node - Processes results from the extraction subgraph
 * 
 * This demonstrates how master graph nodes process data that was generated
 * by nested subgraphs. The tracer should show this node's relationship
 * to the extraction results it's processing.
 */
async function deduplicationNode(state: typeof MasterGraphState.State): Promise<Partial<typeof MasterGraphState.State>> {
  const items = state.extractedItems || [];
  console.log(`🔍 Deduplicating ${items.length} extracted items...`);
  
  // Simple deduplication by name (for demo purposes)
  const uniqueItems = items.filter((item, index, arr) => 
    arr.findIndex(i => i.name === item.name) === index
  );
  
  if (uniqueItems.length < items.length) {
    console.log(`  📝 Removed ${items.length - uniqueItems.length} duplicate items`);
  }
  
  return { extractedItems: uniqueItems };
}

/**
 * Phase 1 enrichment merger - Synchronization point for parallel processing
 * 
 * This node demonstrates the "fan-in" pattern where results from parallel
 * enrichment processes are collected and merged. The tracer should show
 * how this node relates to the parallel enrichment subgraphs.
 */
async function mergePhase1EnrichmentsNode(state: typeof MasterGraphState.State): Promise<Partial<typeof MasterGraphState.State>> {
  console.log('🔗 Merging Phase 1 enrichment results...');
  
  const categoryCount = state.categorizedItems?.length || 0;
  console.log(`  📊 Category enrichments: ${categoryCount}`);
  
  // Simulate merging enrichment data - in real implementation this would
  // combine results from multiple parallel enrichment processes
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return {}; // Results are already in state from parallel nodes
}

/**
 * Phase 2 preparation node - Sets up for the second wave of parallel processing
 * 
 * This demonstrates multi-phase processing where later phases depend on
 * earlier phases completing. Common in complex pipelines like monkey-ai.
 */
async function preparePhase2EnrichmentNode(state: typeof MasterGraphState.State): Promise<Partial<typeof MasterGraphState.State>> {
  console.log('⚙️  Preparing Phase 2 enrichment...');
  
  // Simulate preparation work for the next phase
  await new Promise(resolve => setTimeout(resolve, 50));
  
  return {}; // Preparation complete, ready for Phase 2
}

/**
 * Final assembly node - Combines all processing results
 * 
 * This demonstrates the final stage where all enrichment results are
 * combined into the final output. Shows how complex state aggregation
 * works in nested graph architectures.
 */
async function finalAssemblyNode(state: typeof MasterGraphState.State): Promise<Partial<typeof MasterGraphState.State>> {
  console.log('🏗️  Assembling final menu structure...');
  
  const items = state.extractedItems || [];
  const categories = state.categorizedItems || [];
  const allergens = state.allergenInfo || [];
  const translations = state.translatedItems || [];
  
  // Create final menu structure by combining all enrichment results
  const finalMenuStructure = {
    menuId: state.menuId,
    totalItems: items.length,
    sections: state.menuStructure || [],
    enrichments: {
      categories: categories.length,
      allergens: allergens.length,
      translations: translations.length
    },
    processedAt: new Date().toISOString()
  };
  
  // Calculate completeness score based on how much enrichment was successful
  const completenessScore = Math.min(
    (categories.length / Math.max(items.length, 1)) * 0.4 +
    (allergens.length / Math.max(items.length, 1)) * 0.3 +
    (translations.length / Math.max(items.length, 1)) * 0.3,
    1.0
  );
  
  console.log(`  📈 Completeness score: ${Math.round(completenessScore * 100)}%`);
  console.log(`  🎯 Final structure: ${items.length} items across ${(state.menuStructure || []).length} sections`);
  
  return { 
    finalMenuStructure,
    completenessScore: Math.round(completenessScore * 100) / 100
  };
}

/**
 * Create the master graph with nested subgraph integration
 * 
 * This function demonstrates the key architectural pattern that makes nested tracing valuable:
 * subgraphs are composed as nodes within the master graph, creating deep nesting that
 * requires sophisticated context tracking.
 * 
 * Graph Structure:
 * ```
 * initial_setup -> extraction (SUBGRAPH) -> deduplication -> category_enrichment (SUBGRAPH)
 *                                                                        ↓
 *                  final_assembly <- allergen_enrichment (SUBGRAPH) <- prepare_phase2_enrichment
 *                                 <- translation_enrichment (SUBGRAPH)
 * ```
 * 
 * The fan-out/fan-in pattern in Phase 2 is particularly important for testing
 * the tracer's ability to handle parallel subgraph execution.
 */
export function createMasterGraph() {
  // === SUBGRAPH CREATION ===
  // Each of these creates a complete StateGraph that will be nested within the master graph
  const extractionSubgraph = createExtractionSubgraph();
  const categoryEnrichmentSubgraph = createCategoryEnrichmentSubgraph();
  const allergenEnrichmentSubgraph = createAllergenEnrichmentSubgraph();
  const translationEnrichmentSubgraph = createTranslationEnrichmentSubgraph();

  // === MASTER GRAPH CONSTRUCTION ===
  const workflow = new StateGraph(MasterGraphState)
    // Simple master graph nodes
    .addNode('initial_setup', initialSetupNode)
    .addNode('deduplication', deduplicationNode)
    .addNode('merge_phase1_enrichments', mergePhase1EnrichmentsNode)
    .addNode('prepare_phase2_enrichment', preparePhase2EnrichmentNode)
    .addNode('final_assembly', finalAssemblyNode)
    
    // === NESTED SUBGRAPH NODES ===
    // These are complete subgraphs added as single nodes to the master graph
    // This creates the nested structure that the tracer needs to understand
    .addNode('extraction', extractionSubgraph)                    // Multi-node extraction pipeline
    .addNode('category_enrichment', categoryEnrichmentSubgraph)   // Category analysis subgraph
    .addNode('allergen_enrichment', allergenEnrichmentSubgraph)   // Allergen analysis subgraph  
    .addNode('translation_enrichment', translationEnrichmentSubgraph); // Translation subgraph

  // === GRAPH FLOW DEFINITION ===
  
  // Sequential startup phase
  workflow.addEdge(START, 'initial_setup');
  workflow.addEdge('initial_setup', 'extraction');        // Calls nested extraction subgraph
  workflow.addEdge('extraction', 'deduplication');        // Process extraction results
  
  // Phase 1: Single enrichment (could be parallel, kept simple for clarity)
  workflow.addEdge('deduplication', 'category_enrichment');
  workflow.addEdge('category_enrichment', 'merge_phase1_enrichments');
  
  // Phase 2: Parallel enrichment pattern (fan-out/fan-in)
  workflow.addEdge('merge_phase1_enrichments', 'prepare_phase2_enrichment');
  
  // Fan out to parallel enrichment subgraphs
  workflow.addEdge('prepare_phase2_enrichment', 'allergen_enrichment');
  workflow.addEdge('prepare_phase2_enrichment', 'translation_enrichment');
  
  // Fan in from parallel enrichment to final assembly
  // This is the pattern that tests the tracer's ability to handle parallel completion
  workflow.addEdge(['allergen_enrichment', 'translation_enrichment'], 'final_assembly');
  
  // Final completion
  workflow.addEdge('final_assembly', END);

  return workflow.compile();
}