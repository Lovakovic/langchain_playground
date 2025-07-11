import { BaseTracer, Run } from '@langchain/core/tracers/base';
import { EventEmitter } from 'events';
import { ProcessingPhase, ProcessingEvent } from './types';
import { AIMessage } from '@langchain/core/messages';
import { ToolCall } from '@langchain/core/dist/messages/tool';

/**
 * Node to phase mapping - Maps LangGraph node names to processing phases
 * 
 * This mapping is critical for understanding what business operation each node represents.
 * It allows us to categorize events by processing phase (extraction, enrichment, etc.)
 * rather than just tracking raw node names.
 * 
 * Similar to monkey-ai's nodeToPhaseMap, this provides semantic meaning to graph execution.
 */
const nodeToPhaseMap: Record<string, { phase: ProcessingPhase; message: string }> = {
  // Master graph nodes - top-level orchestration
  initial_setup: { phase: ProcessingPhase.FILE_PROCESSING, message: 'Setting up processing pipeline...' },
  extraction: { phase: ProcessingPhase.EXTRACTION, message: 'Executing extraction subgraph...' },
  deduplication: { phase: ProcessingPhase.EXTRACTION, message: 'Deduplicating extracted items...' },
  category_enrichment: { phase: ProcessingPhase.ENRICHMENT_1, message: 'Categorizing menu items...' },
  merge_phase1_enrichments: { phase: ProcessingPhase.ENRICHMENT_1, message: 'Merging Phase 1 enrichments...' },
  prepare_phase2_enrichment: { phase: ProcessingPhase.ENRICHMENT_2, message: 'Preparing Phase 2 enrichment...' },
  allergen_enrichment: { phase: ProcessingPhase.ENRICHMENT_2, message: 'Analyzing allergens...' },
  translation_enrichment: { phase: ProcessingPhase.ENRICHMENT_2, message: 'Translating content...' },
  final_assembly: { phase: ProcessingPhase.ASSEMBLY, message: 'Assembling final menu...' },

  // Extraction subgraph nodes - nested within extraction
  file_processing_node: { phase: ProcessingPhase.FILE_PROCESSING, message: 'Processing input files...' },
  structure_analysis_node: { phase: ProcessingPhase.EXTRACTION, message: 'Analyzing menu structure...' },
  item_extraction_node: { phase: ProcessingPhase.EXTRACTION, message: 'Extracting menu items...' },
  format_output_node: { phase: ProcessingPhase.EXTRACTION, message: 'Formatting extraction output...' },

  // Enrichment subgraph nodes - nested within their respective enrichment phases
  category_analysis_node: { phase: ProcessingPhase.ENRICHMENT_1, message: 'Analyzing item categories...' },
  allergen_analysis_node: { phase: ProcessingPhase.ENRICHMENT_2, message: 'Analyzing allergen content...' },
  translation_node: { phase: ProcessingPhase.ENRICHMENT_2, message: 'Translating item content...' },
};

/**
 * Enhanced event interface that captures complete execution context
 * 
 * Extends the base ProcessingEvent with detailed hierarchy information
 * needed for understanding tool call associations and execution flow.
 */
export interface CapturedEvent extends ProcessingEvent {
  timestamp: number;           // When the event occurred
  runId: string;               // LangChain run ID for this specific execution
  parentRunId?: string;        // Parent run ID for hierarchy tracking
  nodeName: string;            // Name of the node that generated this event
  parentNodeName?: string;     // Name of the parent node (if any)
  graphLevel: number;          // How deep in the nesting we are (0=master, 1=subgraph, etc.)
  executionPath: string[];     // Complete path from root to this node
}

/**
 * NestedTracer - Advanced tracer for complex LangGraph architectures
 * 
 * This tracer is designed to handle deeply nested subgraph architectures
 * and properly associate tool calls with their execution context.
 * 
 * Key capabilities:
 * 1. Tracks node hierarchy across multiple nesting levels
 * 2. Associates tool calls with both immediate nodes AND parent graph nodes
 * 3. Builds complete execution paths for full context understanding
 * 4. Filters out LangGraph system nodes to focus on business logic
 * 5. Tracks token usage and performance metrics
 */
export class NestedTracer extends BaseTracer {
  name = 'nested_tracer';
  ignoreCustomEvent = false; // We want to capture custom events

  /**
   * Node stack - tracks the current execution hierarchy
   * 
   * This stack represents the "call stack" of graph nodes. When we enter a subgraph,
   * we push its node onto the stack. When we exit, we pop it off.
   * This allows us to always know our current execution context.
   */
  private currentNodeStack: Array<{ name: string; runId: string; level: number }> = [];
  
  /**
   * Run metadata - stores detailed information about each LangChain run
   * 
   * LangChain creates a "run" for each node execution. We store metadata
   * about each run to understand the hierarchy and relationships.
   */
  private runMetadata = new Map<string, { 
    nodeName: string; 
    parentRunId?: string; 
    level: number;
    executionPath: string[];
  }>();
  
  /**
   * Captured events - stores all events we've captured during execution
   * This is our "trace" - the complete record of what happened.
   */
  private capturedEvents: CapturedEvent[] = [];

  // Token usage tracking - accumulates across all LLM calls
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalTokens = 0;

  constructor(
    private readonly emitter: EventEmitter,  // For real-time event broadcasting
    private readonly menuId: string          // ID of the menu being processed
  ) {
    super({
      ignoreCustomEvent: false, // Ensure we capture custom events
    });
  }

  /**
   * Required by BaseTracer - we don't persist to storage, just emit events
   */
  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Central event emission method
   * 
   * This enriches events with complete hierarchy context and broadcasts them.
   * Every event gets the full context of where it occurred in the graph.
   */
  private emit(event: Omit<ProcessingEvent, 'type'>, type: ProcessingEvent['type'], run: Run) {
    const capturedEvent: CapturedEvent = {
      type,
      ...event,
      timestamp: Date.now(),
      runId: run.id,
      parentRunId: run.parent_run_id || undefined,
      nodeName: run.name,
      parentNodeName: this.getParentNodeName(run),
      graphLevel: this.getGraphLevel(run),
      executionPath: this.getExecutionPath(run),
    };

    // Store for analysis
    this.capturedEvents.push(capturedEvent);
    
    // Broadcast for real-time monitoring
    this.emitter.emit('processingEvent', this.menuId, capturedEvent);
  }

  /**
   * Get the name of the parent node from our metadata
   * 
   * This is used to understand the immediate parent-child relationship.
   */
  private getParentNodeName(run: Run): string | undefined {
    if (!run.parent_run_id) return undefined;
    
    const parentMetadata = this.runMetadata.get(run.parent_run_id);
    return parentMetadata?.nodeName;
  }

  /**
   * Calculate the nesting level (graph depth) for a run
   * 
   * Level 0 = master graph
   * Level 1 = first-level subgraph  
   * Level 2 = subgraph within subgraph, etc.
   * 
   * We traverse up the parent chain counting user nodes (not system nodes).
   */
  private getGraphLevel(run: Run): number {
    let level = 0;
    let currentRunId = run.parent_run_id;
    
    while (currentRunId) {
      const parentMetadata = this.runMetadata.get(currentRunId);
      if (parentMetadata && this.isUserNode(parentMetadata.nodeName)) {
        level++;
      }
      currentRunId = this.runMetadata.get(currentRunId)?.parentRunId;
    }
    
    return level;
  }

  /**
   * Build the complete execution path from root to current node
   * 
   * This creates an array like ["extraction", "structure_analysis_node"] 
   * showing exactly how we got to the current node.
   * 
   * Critical for understanding tool call context in complex graphs.
   */
  private getExecutionPath(run: Run): string[] {
    const path: string[] = [];
    let currentRunId: string | undefined = run.id;
    
    // Walk up the parent chain, building the path
    while (currentRunId) {
      const metadata = this.runMetadata.get(currentRunId);
      if (metadata && this.isUserNode(metadata.nodeName)) {
        path.unshift(metadata.nodeName); // Add to beginning of array
      }
      currentRunId = metadata?.parentRunId;
    }
    
    return path;
  }

  /**
   * Filter out LangGraph system nodes
   * 
   * LangGraph creates many internal nodes for plumbing (ChannelWrite, etc.).
   * We only care about user-defined business logic nodes.
   * 
   * This is the same filtering approach used in monkey-ai.
   */
  private isUserNode(nodeName: string): boolean {
    return !nodeName.includes('<') && 
           !nodeName.includes('__') &&
           !nodeName.includes('ChannelWrite') &&
           !nodeName.includes('ChannelRead');
  }

  // =================== EVENT TRACKING METHODS ===================
  
  /**
   * Called when any LangChain component starts executing
   * 
   * This is where we track the node hierarchy and build our execution context.
   * For every user node that starts, we update our tracking structures.
   */
  onChainStart(run: Run): void {
    const isUserNode = this.isUserNode(run.name);
    
    if (isUserNode) {
      const level = this.getGraphLevel(run);
      const executionPath = this.getExecutionPath(run);
      
      // Store metadata about this run for later reference
      this.runMetadata.set(run.id, {
        nodeName: run.name,
        parentRunId: run.parent_run_id || undefined,
        level,
        executionPath: [...executionPath, run.name]
      });

      // Push onto our execution stack
      this.currentNodeStack.push({ 
        name: run.name, 
        runId: run.id, 
        level 
      });
    }

    // Emit phase start event if this node has a defined phase
    const phaseInfo = nodeToPhaseMap[run.name];
    if (phaseInfo) {
      this.emit({ 
        phase: phaseInfo.phase, 
        message: phaseInfo.message,
        metadata: { level: this.getGraphLevel(run) }
      }, 'phase:start', run);
    }
  }

  /**
   * Called when any LangChain component finishes executing
   * 
   * This is where we emit completion events and clean up our tracking structures.
   */
  onChainEnd(run: Run): void {
    const phaseInfo = nodeToPhaseMap[run.name];
    if (phaseInfo) {
      const duration = (run.end_time || Date.now()) - run.start_time;
      const message = run.error ? `Failed: ${run.error}` : `${phaseInfo.phase} complete.`;
      
      this.emit({
        phase: phaseInfo.phase,
        message: message,
        metadata: { 
          duration,
          level: this.getGraphLevel(run),
          success: !run.error
        },
      }, 'phase:end', run);
    }

    // Clean up our node stack when user nodes complete
    if (this.isUserNode(run.name)) {
      this.currentNodeStack = this.currentNodeStack.filter(node => node.runId !== run.id);
    }
  }

  /**
   * Called when any LangChain component encounters an error
   */
  onChainError(run: Run): void {
    const phaseInfo = nodeToPhaseMap[run.name] || { 
      phase: ProcessingPhase.FAILED, 
      message: 'An unknown error occurred' 
    };
    
    this.emit({
      phase: phaseInfo.phase,
      message: `Error in ${run.name}: ${run.error}`,
      metadata: { 
        error: run.error,
        level: this.getGraphLevel(run),
        executionPath: this.getExecutionPath(run)
      },
    }, 'phase:error', run);
  }

  // =================== LLM EVENT TRACKING ===================
  
  /**
   * Called when an LLM starts executing
   * 
   * We capture the model name for later attribution.
   */
  onLLMStart(run: Run): void {
    const serialized = run.serialized as any;
    if (serialized?.kwargs?.model) {
      run.extra = { ...run.extra, modelName: serialized.kwargs.model };
    }
  }

  /**
   * Called when an LLM finishes executing
   * 
   * This is THE CRITICAL METHOD for tool call association.
   * 
   * Here we:
   * 1. Track token usage and associate it with the current node
   * 2. Extract tool calls from the LLM response 
   * 3. Associate each tool call with complete execution context
   */
  onLLMEnd(run: Run): void {
    // === STEP 1: Track token usage ===
    const message = run.outputs?.generations?.[0]?.[0]?.message;
    const usageMetadata = message?.kwargs?.usage_metadata;

    // Try multiple possible locations for token usage (different providers)
    const tokenUsage =
      usageMetadata ||
      run.outputs?.llmOutput?.usage_metadata ||
      run.outputs?.llmOutput?.tokenUsage ||
      run.outputs?.tokenUsage ||
      run.outputs?.usage;

    if (tokenUsage) {
      // Normalize token field names across providers
      const inputTokens = tokenUsage.input_tokens || tokenUsage.promptTokens || 0;
      const outputTokens = tokenUsage.output_tokens || tokenUsage.completionTokens || 0;
      const totalTokens = tokenUsage.total_tokens || tokenUsage.totalTokens || inputTokens + outputTokens;

      // Accumulate totals
      this.totalInputTokens += inputTokens;
      this.totalOutputTokens += outputTokens;
      this.totalTokens += totalTokens;

      // Emit token usage event with node context
      this.emit({
        phase: this.getCurrentPhase(run),
        message: 'LLM call completed',
        metadata: {
          modelName: run.extra?.modelName || 'unknown',
          inputTokens,
          outputTokens,
          totalTokens: this.totalTokens,
          totalInputTokens: this.totalInputTokens,
          totalOutputTokens: this.totalOutputTokens,
          parentNode: this.getCurrentNodeName(),
          level: this.getGraphLevel(run)
        },
      }, 'llm:end', run);
    }

    // === STEP 2: Extract and associate tool calls ===
    // This is the key feature that makes this tracer valuable for monkey-ai
    const responseMessage = run.outputs?.generations?.[0]?.[0]?.message as AIMessage;

    if (responseMessage?.tool_calls && Array.isArray(responseMessage.tool_calls) && responseMessage.tool_calls.length > 0) {
      responseMessage.tool_calls.forEach((toolCall: ToolCall) => {
        // Get complete execution context
        const currentNode = this.getCurrentNodeName();
        const parentNode = this.getParentNodeFromStack();
        const executionPath = this.getExecutionPath(run);
        
        // Emit tool call event with COMPLETE context
        this.emit({
          phase: this.getCurrentPhase(run),
          message: `Tool call: ${toolCall.name}`,
          metadata: {
            // === CRITICAL CONTEXT INFORMATION ===
            // This is what makes nested tracing valuable - we know exactly
            // where each tool call happened in our complex graph hierarchy
            
            currentNode,                                    // Immediate node executing the tool
            parentNode,                                     // Parent of the current node
            masterGraphNode: this.getMasterGraphNode(),     // Top-level master graph node
            subgraphNode: this.getSubgraphNode(),          // First-level subgraph node
            executionPath,                                  // Complete path from root
            level: this.getGraphLevel(run),                // Nesting depth
            
            // === TOOL CALL DETAILS ===
            toolName: toolCall.name,
            toolInput: toolCall.args,
            toolCallId: toolCall.id,
            isFromLLM: true,                               // Flag indicating this came from LLM response
            
            // === TECHNICAL CONTEXT ===
            modelName: run.extra?.modelName || 'unknown',
          },
        }, 'tool:end', run);
      });
    }
  }

  // =================== HELPER METHODS FOR NODE ASSOCIATION ===================

  /**
   * Get the name of the currently executing node from our stack
   */
  private getCurrentNodeName(): string {
    return this.currentNodeStack[this.currentNodeStack.length - 1]?.name || 'unknown';
  }

  /**
   * Get the parent node from our execution stack
   */
  private getParentNodeFromStack(): string | undefined {
    return this.currentNodeStack[this.currentNodeStack.length - 2]?.name;
  }

  /**
   * Find the master graph node (level 0) in our execution stack
   * 
   * This tells us which top-level operation initiated this tool call.
   * Critical for understanding the business context.
   */
  private getMasterGraphNode(): string | undefined {
    return this.currentNodeStack.find(node => node.level === 0)?.name;
  }

  /**
   * Find the immediate subgraph node (level 1) in our execution stack
   * 
   * This tells us which subgraph the tool call is executing within.
   * Essential for monkey-ai style architecture with nested subgraphs.
   */
  private getSubgraphNode(): string | undefined {
    return this.currentNodeStack.find(node => node.level === 1)?.name;
  }

  /**
   * Determine the current processing phase based on node context
   */
  private getCurrentPhase(run: Run): ProcessingPhase {
    const currentNode = this.getCurrentNodeName();
    return nodeToPhaseMap[currentNode]?.phase || ProcessingPhase.EXTRACTION;
  }

  // =================== PUBLIC ANALYSIS METHODS ===================

  /**
   * Get all captured events (defensive copy)
   */
  public getCapturedEvents(): CapturedEvent[] {
    return [...this.capturedEvents];
  }

  /**
   * Filter events by processing phase
   */
  public getEventsByPhase(phase: ProcessingPhase): CapturedEvent[] {
    return this.capturedEvents.filter(event => event.phase === phase);
  }

  /**
   * Get only tool call events for analysis
   */
  public getToolCallEvents(): CapturedEvent[] {
    return this.capturedEvents.filter(event => event.type === 'tool:end');
  }

  /**
   * Get accumulated token usage statistics
   */
  public getTokenUsage(): { input: number; output: number; total: number } {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalTokens
    };
  }

  /**
   * Generate a comprehensive execution summary
   * 
   * This provides a high-level view of what happened during execution,
   * with emphasis on tool call associations - the key value of this tracer.
   */
  public getExecutionSummary(): string {
    const events = this.capturedEvents;
    const phases = Object.values(ProcessingPhase);
    const phaseStats = phases.map(phase => ({
      phase,
      count: events.filter(e => e.phase === phase).length
    }));

    const toolCalls = this.getToolCallEvents();
    const tokenUsage = this.getTokenUsage();

    return `
=== Execution Summary ===
Total Events: ${events.length}
Tool Calls: ${toolCalls.length}
Token Usage: ${tokenUsage.input} input, ${tokenUsage.output} output, ${tokenUsage.total} total

Phase Breakdown:
${phaseStats.map(stat => `  ${stat.phase}: ${stat.count} events`).join('\n')}

Tool Call Associations:
${toolCalls.map(tc => 
  `  ${tc.metadata?.toolName} -> ${tc.metadata?.currentNode} (${tc.metadata?.masterGraphNode} -> ${tc.metadata?.subgraphNode || 'direct'})`
).join('\n')}
    `.trim();
  }
}