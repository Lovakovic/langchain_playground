import { BaseTracer, type Run } from "@langchain/core/tracers/base";
import * as fs from "fs";
import * as util from "util";

/**
 * FileCallbackHandler - A Custom LangChain Callback Handler for File Logging
 * 
 * This handler extends BaseTracer to capture ALL events that occur during
 * LangChain execution and writes them to a log file. It's based on the
 * ConsoleCallbackHandler but outputs to a file instead of the console.
 * 
 * INHERITANCE HIERARCHY:
 * - BaseCallbackHandler (base class with all callback methods)
 *   └─> BaseTracer (adds run tracking and management)
 *       └─> FileCallbackHandler (our custom implementation)
 * 
 * KEY CONCEPTS:
 * 1. RUNS: Every operation in LangChain is a "Run" with a unique ID
 * 2. NESTING: Runs can have parent-child relationships (see breadcrumbs)
 * 3. TYPES: Different run types (chain, llm, tool, etc.) trigger different events
 */
export class FileCallbackHandler extends BaseTracer {
  /**
   * Handler name - used for identification in LangChain's callback system
   */
  name = "file_callback_handler" as const;
  
  /**
   * File stream for writing logs - using a stream for better performance
   * than individual fs.writeFile calls
   */
  private logStream: fs.WriteStream;

  constructor(logFilePath: string) {
    super();
    // 'a' flag = append mode, so logs accumulate rather than overwrite
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  }

  /**
   * Custom logging method that preserves JavaScript object types
   * 
   * CRITICAL: We use util.inspect instead of JSON.stringify because:
   * 1. It preserves constructor names (e.g., "HumanMessage" vs generic object)
   * 2. It handles circular references gracefully
   * 3. It provides better formatting for nested objects
   * 
   * This is essential for debugging as you can see the exact message types
   * being passed through the system (HumanMessage, AIMessage, ToolMessage, etc.)
   */
  private log(...args: any[]) {
    // Transform each argument to preserve type information
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        return util.inspect(arg, { 
          depth: null,           // Show full object depth
          colors: false,         // No ANSI colors in file
          maxArrayLength: null,  // Show all array items
          breakLength: 80,       // Line wrap at 80 chars
          compact: false         // Pretty print objects
        });
      }
      return arg;
    });
    
    // util.format handles string interpolation and formatting
    const message = util.format(...formattedArgs);
    this.logStream.write(`${message}\n`);
  }

  /**
   * Required by BaseTracer but not needed for file logging
   * 
   * This method is called by BaseTracer to persist runs to a database
   * or external storage. We just return a resolved promise since we're
   * only interested in logging, not persistence.
   */
  protected persistRun(_run: Run) {
    return Promise.resolve();
  }

  /**
   * Utility to format objects with preserved class names
   * Currently unused but kept for potential future use
   */
  private formatValue(obj: unknown, fallback: string): string {
    try {
      return util.inspect(obj, { 
        depth: null, 
        colors: false,
        maxArrayLength: null,
        breakLength: 80,
        compact: false
      });
    } catch (err) {
      return fallback;
    }
  }

  /**
   * Calculate and format elapsed time for a run
   * 
   * This helps identify performance bottlenecks:
   * - Tool calls might take 1000ms+ due to external APIs
   * - LLM calls vary based on prompt complexity
   * - Chain operations are usually fast (<10ms)
   */
  private elapsed(run: Run): string {
    if (!run.end_time) return "";
    const elapsed = run.end_time - run.start_time;
    if (elapsed < 1000) {
      return `${elapsed}ms`;
    }
    return `${(elapsed / 1000).toFixed(2)}s`;
  }

  /**
   * Generate breadcrumb trail showing the execution hierarchy
   * 
   * CRITICAL CONCEPT: The breadcrumb trail shows the complete execution path!
   * 
   * Example from the trace:
   * "1:chain:LangGraph > 5:chain:agent > 6:llm:ChatVertexAI"
   * 
   * This tells us:
   * - 1: Execution order (1st operation)
   * - chain: Run type (chain, llm, tool, etc.)
   * - LangGraph: The name of the component
   * 
   * The trail shows parent-child relationships:
   * - LangGraph is the root graph
   * - agent is a node within LangGraph (our "agent" node from the graph)
   * - ChatVertexAI is the LLM being invoked within the agent node
   * 
   * NAMING CONNECTIONS:
   * - Node names in the graph (like "agent", "tools") appear in breadcrumbs
   * - Tool names (like "get_weather") appear when tools are invoked
   * - Model class names (like "ChatVertexAI") appear for LLM calls
   * - Special nodes like "__start__" are LangGraph internals
   */
  private getBreadcrumbs(run: Run): string {
    const parents: Run[] = [];
    let currentRun = run;
    
    // Walk up the parent chain to build the full path
    while (currentRun.parent_run_id) {
      const parent = this.runMap.get(currentRun.parent_run_id);
      if (parent) {
        parents.push(parent);
        currentRun = parent;
      } else {
        break;
      }
    }
    
    // Format: "execution_order:run_type:name"
    // Example: "1:chain:LangGraph > 5:chain:agent > 6:llm:ChatVertexAI"
    return [...parents.reverse(), run]
      .map(parent => `${parent.execution_order}:${parent.run_type}:${parent.name}`)
      .join(" > ");
  }

  // ============================================
  // EVENT HANDLERS - Called by LangChain during execution
  // ============================================
  
  /**
   * CHAIN EVENTS - Triggered by any Runnable chain
   * In our trace, chains include:
   * - LangGraph (the main graph)
   * - agent (our agent node)
   * - tools (our tools node) 
   * - __start__ (LangGraph's entry point)
   * - ChannelWrite operations (LangGraph internals)
   * - Branch operations (conditional routing)
   */
  
  onChainStart(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[chain/start] [${crumbs}] Entering Chain run with input:`,
      run.inputs
    );
  }

  onChainEnd(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[chain/end] [${crumbs}] [${this.elapsed(run)}] Exiting Chain run with output:`,
      run.outputs
    );
  }

  onChainError(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[chain/error] [${crumbs}] [${this.elapsed(run)}] Chain run errored with error:`,
      run.error
    );
  }

  /**
   * LLM EVENTS - Triggered when a language model is invoked
   * In our trace, these show:
   * - Model name: "ChatVertexAI"
   * - Input messages with full type preservation
   * - Token usage statistics
   * - Tool call decisions
   */
  
  onLLMStart(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    // Handle both old-style prompts and new-style messages
    const inputs = "prompts" in run.inputs
      ? { prompts: (run.inputs.prompts as string[]).map((p) => p.trim()) }
      : run.inputs;
    this.log(
      `[llm/start] [${crumbs}] Entering LLM run with input:`,
      inputs
    );
  }

  onLLMEnd(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[llm/end] [${crumbs}] [${this.elapsed(run)}] Exiting LLM run with output:`,
      run.outputs
    );
  }

  onLLMError(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[llm/error] [${crumbs}] [${this.elapsed(run)}] LLM run errored with error:`,
      run.error
    );
  }

  /**
   * TOOL EVENTS - Triggered when tools are invoked
   * In our trace, we see:
   * - Tool name: "get_weather" (matches our tool definition)
   * - Input: The exact arguments passed to the tool
   * - Output: The tool's response as a ToolMessage
   * 
   * The breadcrumb shows the tool runs within the "tools" node:
   * "1:chain:LangGraph > 9:chain:tools > 10:tool:get_weather"
   */
  
  onToolStart(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[tool/start] [${crumbs}] Entering Tool run with input:`,
      run.inputs.input
    );
  }

  onToolEnd(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[tool/end] [${crumbs}] [${this.elapsed(run)}] Exiting Tool run with output:`,
      run.outputs?.output
    );
  }

  onToolError(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[tool/error] [${crumbs}] [${this.elapsed(run)}] Tool run errored with error:`,
      run.error
    );
  }

  /**
   * RETRIEVER EVENTS - For RAG applications (not used in our example)
   * These would fire when using vector stores or document retrievers
   */
  
  onRetrieverStart(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[retriever/start] [${crumbs}] Entering Retriever run with input:`,
      run.inputs
    );
  }

  onRetrieverEnd(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[retriever/end] [${crumbs}] [${this.elapsed(run)}] Exiting Retriever run with output:`,
      run.outputs
    );
  }

  onRetrieverError(run: Run) {
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[retriever/error] [${crumbs}] [${this.elapsed(run)}] Retriever run errored with error:`,
      run.error
    );
  }

  /**
   * AGENT EVENTS - For agent-specific actions
   * Note: This is for legacy agents, not LangGraph agents
   * LangGraph agents use chain events instead
   */
  
  onAgentAction(run: Run) {
    const agentRun = run as any;
    const crumbs = this.getBreadcrumbs(run);
    this.log(
      `[agent/action] [${crumbs}] Agent selected action:`,
      agentRun.actions?.[agentRun.actions.length - 1]
    );
  }

  /**
   * Cleanup - Always close file streams!
   */
  close() {
    this.logStream.end();
  }
}