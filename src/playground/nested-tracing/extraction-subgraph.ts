import dotenv from 'dotenv';
import { END, START, StateGraph } from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { ExtractionState } from './states';
import { MockFileMetadata, MockMenuItem, CustomEventTypes, ProgressEventData } from './types';
import { createStructureAnalysisTool, createItemExtractionTool } from './tools';

dotenv.config();

/**
 * Extraction Subgraph Implementation
 * 
 * This subgraph demonstrates the multi-node processing pipeline that exists within
 * the monkey-ai extraction phase. It shows how complex business logic is broken down
 * into sequential and parallel processing steps within a single subgraph.
 * 
 * The key tracing challenge here is that LLM calls and tool calls happen deep within
 * this subgraph, and the tracer must associate them with both:
 * 1. The immediate subgraph node (e.g., structure_analysis_node)
 * 2. The parent master graph node (e.g., extraction)
 * 
 * This creates the nested context that the NestedTracer is designed to handle.
 */

/**
 * Create a Vertex AI model instance
 * 
 * This helper function demonstrates how LLM models are configured within subgraphs.
 * The tracer will capture these model configurations and associate them with
 * the specific nodes that use them.
 */
function createVertexAIModel(config: { model: string; temperature: number }) {
  return new ChatVertexAI({
    model: config.model,
    temperature: config.temperature,
  });
}

/**
 * File processing node - Entry point for the extraction subgraph
 * 
 * This node simulates the complex file processing that occurs in monkey-ai.
 * It doesn't use LLMs directly, but prepares data for downstream nodes that do.
 * 
 * The tracer should show this node as nested within the master graph's 'extraction' node.
 */
async function fileProcessingNode(state: typeof ExtractionState.State): Promise<Partial<typeof ExtractionState.State>> {
  try {
    // Dispatch custom event: Subgraph entry
    await dispatchCustomEvent(CustomEventTypes.SUBGRAPH_ENTERED, {
      subgraph: 'extraction',
      node: 'file_processing_node',
      inputFileCount: state.inputFiles?.length || 0
    });

    if (!state.inputFiles || state.inputFiles.length === 0) {
      await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
        error: 'No input files provided to extraction subgraph',
        node: 'file_processing_node'
      });
      return { errorLog: ['No input files provided to extraction subgraph'] };
    }

    // Dispatch validation success
    await dispatchCustomEvent(CustomEventTypes.DATA_VALIDATED, {
      fileCount: state.inputFiles.length,
      totalSize: state.inputFiles.reduce((sum, f) => sum + f.content.length, 0),
      node: 'file_processing_node'
    });

    // Simulate file processing by concatenating content
    const processedContent = state.inputFiles
      .map(file => `FILE: ${file.fileName}\n${file.content}`)
      .join('\n\n');

    console.log(`📄 Processing ${state.inputFiles.length} files in extraction subgraph`);
    
    // Dispatch progress event
    await dispatchCustomEvent(CustomEventTypes.DATA_TRANSFORMED, {
      operation: 'file_concatenation',
      inputFiles: state.inputFiles.length,
      outputLength: processedContent.length,
      processingComplete: true
    });
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return { processedContent };
  } catch (e) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: (e as Error).message,
      node: 'file_processing_node',
      stack: (e as Error).stack
    });
    return { errorLog: [`File processing failed: ${(e as Error).message}`] };
  }
}

/**
 * Structure analysis node - CRITICAL for tool call tracing
 * 
 * This node demonstrates LLM calls with tool usage within a nested subgraph.
 * The tracer must capture:
 * 1. The LLM call happening in this node
 * 2. The tool call (analyze_menu_structure) made by the LLM
 * 3. Association with both this node AND the parent 'extraction' master graph node
 * 
 * This is the core pattern that the NestedTracer is designed to handle.
 */
async function structureAnalysisNode(state: typeof ExtractionState.State): Promise<Partial<typeof ExtractionState.State>> {
  if (!state.processedContent) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: 'No processed content for structure analysis',
      node: 'structure_analysis_node',
      expectedInput: 'processedContent'
    });
    return { errorLog: ['No processed content for structure analysis'], menuStructure: [] };
  }

  try {
    // Dispatch custom event: Starting LLM analysis
    await dispatchCustomEvent(CustomEventTypes.ANALYSIS_STARTED, {
      node: 'structure_analysis_node',
      analysisType: 'menu_structure',
      inputContentLength: state.processedContent.length,
      modelUsed: 'gemini-2.5-flash'
    });

    const structureTool = createStructureAnalysisTool();
    const model = createVertexAIModel({ model: 'gemini-2.5-flash', temperature: 0.0 })
      .bindTools([structureTool], { tool_choice: 'any' });

    const messages = [
      new SystemMessage('Analyze the menu content and identify its structural sections. Use the tool to save your analysis.'),
      new HumanMessage({ content: state.processedContent }),
    ];

    console.log('🔍 Analyzing menu structure with LLM...');
    
    // Custom event: LLM invocation started
    await dispatchCustomEvent('llm_invocation_started', {
      node: 'structure_analysis_node',
      toolsBound: ['analyze_menu_structure'],
      messageCount: messages.length
    });

    const response = await model.invoke(messages);
    const toolCall = response.tool_calls?.[0];

    if (toolCall?.name === 'analyze_menu_structure' && toolCall.args.sections) {
      // Dispatch success event
      await dispatchCustomEvent(CustomEventTypes.ANALYSIS_COMPLETED, {
        node: 'structure_analysis_node',
        analysisType: 'menu_structure',
        sectionsFound: toolCall.args.sections.length,
        toolCallSuccessful: true,
        sections: toolCall.args.sections.map((s: any) => ({ name: s.name, itemCount: s.itemCount }))
      });

      console.log(`📋 Found ${toolCall.args.sections.length} menu sections`);
      return { menuStructure: toolCall.args.sections };
    }

    // Tool call failed
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: 'Structure analysis tool call failed',
      node: 'structure_analysis_node',
      toolCallName: toolCall?.name || 'none',
      toolCallArgs: toolCall?.args || null
    });

    return { errorLog: ['Structure analysis tool call failed'], menuStructure: [] };
  } catch (e) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: (e as Error).message,
      node: 'structure_analysis_node',
      analysisType: 'menu_structure',
      stack: (e as Error).stack
    });
    return { errorLog: [`Structure analysis failed: ${(e as Error).message}`], menuStructure: [] };
  }
}

/**
 * Item extraction node - Demonstrates parallel LLM calls within subgraphs
 * 
 * This node simulates the parallel processing pattern from monkey-ai where
 * multiple sections are processed simultaneously by different LLM calls.
 * 
 * Each LLM call will generate tool call events, and the tracer must:
 * 1. Associate each tool call with this specific node
 * 2. Maintain the connection to the parent extraction subgraph
 * 3. Track the parallel execution context
 * 
 * This tests the tracer's ability to handle concurrent nested operations.
 */
async function itemExtractionNode(state: typeof ExtractionState.State): Promise<Partial<typeof ExtractionState.State>> {
  const { menuStructure, processedContent } = state;
  
  if (!menuStructure || menuStructure.length === 0) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: 'No menu structure for item extraction',
      node: 'item_extraction_node',
      expectedInput: 'menuStructure'
    });
    return { extractedItems: [], errorLog: ['No menu structure for item extraction'] };
  }

  if (!processedContent) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: 'No processed content for item extraction', 
      node: 'item_extraction_node',
      expectedInput: 'processedContent'
    });
    return { extractedItems: [], errorLog: ['No processed content for item extraction'] };
  }

  try {
    // Dispatch custom event: Starting parallel extraction
    await dispatchCustomEvent(CustomEventTypes.ANALYSIS_STARTED, {
      node: 'item_extraction_node',
      analysisType: 'parallel_item_extraction',
      sectionCount: menuStructure.length,
      parallelProcessing: true,
      sections: menuStructure.map(s => s.name)
    });

    const itemTool = createItemExtractionTool();
    const model = createVertexAIModel({ model: 'gemini-2.5-flash', temperature: 0.3 })
      .bindTools([itemTool], { tool_choice: 'any' });

    console.log(`⚡ Processing ${menuStructure.length} sections in parallel...`);

    // Track progress across parallel operations
    let completedSections = 0;
    const totalSections = menuStructure.length;

    // Simulate parallel processing of sections (like monkey-ai)
    const sectionPromises = menuStructure.map(async (section, index) => {
      try {
        // Dispatch progress for this specific section
        await dispatchCustomEvent(CustomEventTypes.ITEMS_PROCESSED, {
          node: 'item_extraction_node',
          sectionName: section.name,
          sectionIndex: index,
          operation: 'starting_section_extraction'
        });

        // Simulate section-specific content extraction
        const sectionContent = `Section: ${section.name}\nContent: Sample menu items for ${section.name}`;
        
        const messages = [
          new SystemMessage(`Extract menu items from the "${section.name}" section. Use the tool to save extracted items.`),
          new HumanMessage({ content: sectionContent }),
        ];

        console.log(`  📝 Extracting items from section: ${section.name}`);
        const response = await model.invoke(messages);
        const toolCall = response.tool_calls?.[0];

        if (toolCall?.name === 'extract_menu_items' && toolCall.args.items) {
          // Add mock items for demonstration
          const mockItems: MockMenuItem[] = Array.from({ length: section.itemCount }, (_, i) => ({
            id: `${section.name}-item-${i + 1}`,
            name: `${section.name} Item ${i + 1}`,
            description: `Sample description for item ${i + 1}`,
            price: Math.round((Math.random() * 20 + 5) * 100) / 100,
            section: section.name
          }));

          // Update progress
          completedSections++;
          
          // Dispatch completion event for this section
          await dispatchCustomEvent(CustomEventTypes.ITEMS_PROCESSED, {
            node: 'item_extraction_node',
            sectionName: section.name,
            sectionIndex: index,
            itemsExtracted: mockItems.length,
            operation: 'section_extraction_complete'
          });

          // Dispatch overall progress
          await dispatchCustomEvent(CustomEventTypes.PROGRESS_UPDATE, {
            current: completedSections,
            total: totalSections,
            percentage: (completedSections / totalSections) * 100,
            operation: 'parallel_section_processing'
          } as ProgressEventData);

          console.log(`    ✅ Extracted ${mockItems.length} items from ${section.name}`);
          return mockItems;
        }

        return [];
      } catch (e) {
        await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
          error: (e as Error).message,
          node: 'item_extraction_node',
          sectionName: section.name,
          sectionIndex: index,
          operation: 'section_extraction_failed'
        });
        console.log(`    ❌ Failed to extract from ${section.name}: ${(e as Error).message}`);
        return [];
      }
    });

    const allResults = await Promise.all(sectionPromises);
    const extractedItems = allResults.flat();

    // Dispatch final completion event
    await dispatchCustomEvent(CustomEventTypes.ANALYSIS_COMPLETED, {
      node: 'item_extraction_node',
      analysisType: 'parallel_item_extraction',
      totalItemsExtracted: extractedItems.length,
      sectionsProcessed: menuStructure.length,
      parallelProcessingComplete: true,
      successfulSections: allResults.filter(result => result.length > 0).length
    });

    console.log(`🎯 Total items extracted: ${extractedItems.length}`);
    return { extractedItems };
  } catch (e) {
    await dispatchCustomEvent(CustomEventTypes.VALIDATION_FAILED, {
      error: (e as Error).message,
      node: 'item_extraction_node',
      analysisType: 'parallel_item_extraction',
      stack: (e as Error).stack
    });
    return { extractedItems: [], errorLog: [`Item extraction failed: ${(e as Error).message}`] };
  }
}

/**
 * Format output node - Final step in the extraction subgraph
 * 
 * This node demonstrates how subgraphs prepare their output for the master graph.
 * It doesn't use LLMs, but shows the data flow patterns that the tracer tracks.
 */
async function formatOutputNode(state: typeof ExtractionState.State): Promise<Partial<typeof ExtractionState.State>> {
  // Dispatch custom event: Subgraph exit
  await dispatchCustomEvent(CustomEventTypes.SUBGRAPH_EXITED, {
    subgraph: 'extraction',
    node: 'format_output_node',
    outputSummary: {
      extractedItems: state.extractedItems?.length || 0,
      menuStructure: state.menuStructure?.length || 0,
      errors: state.errorLog?.length || 0
    },
    subgraphComplete: true
  });

  console.log('📤 Formatting extraction subgraph output');
  
  // Dispatch data export event
  await dispatchCustomEvent(CustomEventTypes.DATA_EXPORTED, {
    node: 'format_output_node',
    destination: 'master_graph',
    dataTypes: ['extractedItems', 'menuStructure', 'errorLog'],
    itemCount: state.extractedItems?.length || 0,
    structureCount: state.menuStructure?.length || 0
  });

  return {
    extractedItems: state.extractedItems || [],
    menuStructure: state.menuStructure || [],
    errorLog: state.errorLog || []
  };
}

/**
 * Create the extraction subgraph
 * 
 * This function demonstrates how complex subgraphs are constructed and nested
 * within master graphs. The resulting subgraph will be added as a single node
 * to the master graph, creating the nested structure that requires sophisticated tracing.
 * 
 * Subgraph Structure:
 * ```
 * file_processing_node -> structure_analysis_node -> item_extraction_node -> format_output_node
 *                              ↓ (LLM + Tool)         ↓ (Multiple LLM + Tools)
 * ```
 * 
 * Each node with LLM calls will generate events that the tracer must associate
 * with both the immediate node and the parent 'extraction' context.
 */
export function createExtractionSubgraph() {
  const workflow = new StateGraph(ExtractionState)
    .addNode('file_processing_node', fileProcessingNode)
    .addNode('structure_analysis_node', structureAnalysisNode)
    .addNode('item_extraction_node', itemExtractionNode)
    .addNode('format_output_node', formatOutputNode);

  // Sequential flow: file processing -> structure analysis -> item extraction -> format output
  workflow.addEdge(START, 'file_processing_node');
  workflow.addEdge('file_processing_node', 'structure_analysis_node');
  workflow.addEdge('structure_analysis_node', 'item_extraction_node');
  workflow.addEdge('item_extraction_node', 'format_output_node');
  workflow.addEdge('format_output_node', END);

  return workflow.compile();
}