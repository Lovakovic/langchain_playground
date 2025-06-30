/**
 * LangGraph Advanced Metrics Tracing Example
 * ==========================================
 * 
 * This example demonstrates how to build a custom tracer that captures detailed
 * performance metrics from complex LangGraph applications, including:
 * 
 * 1. **Multi-Model Support**: Track token usage across different LLM providers
 *    (Vertex AI, OpenAI, Anthropic, etc.) with exact model names
 * 
 * 2. **Hierarchical Tracking**: Capture metrics at both graph and node levels,
 *    including subgraphs with proper parent-child relationships
 * 
 * 3. **Comprehensive Token Metrics**: Track input/output tokens, total usage,
 *    and calculate averages per model and per node
 * 
 * 4. **Performance Timing**: Measure execution time for the entire graph and
 *    individual nodes to identify bottlenecks
 * 
 * ARCHITECTURE OVERVIEW:
 * 
 * Main Graph (Vertex AI)
 * ├── Planner Node → Analyzes request and decides if research is needed
 * ├── Research Subgraph (OpenAI) → Performs deep research when needed
 * │   ├── Research Node → Uses OpenAI to analyze the topic
 * │   └── Tools Node → Executes research tools
 * ├── Tool Node → Executes web search tool
 * └── Summarizer Node → Generates final answer using all gathered information
 * 
 * KEY FEATURES OF THE ENHANCED METRICS TRACER:
 * 
 * - Extracts exact model names from LangChain events (e.g., "gpt-4o-mini", "gemini-2.5-flash")
 * - Handles different token usage formats from various providers
 * - Attributes token usage to the correct parent nodes in the graph hierarchy
 * - Provides both console output and JSON export for further analysis
 */

import { z } from 'zod';
import { StateGraph, Annotation, CompiledStateGraph, StateDefinition, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import { BaseTracer, Run } from '@langchain/core/tracers/base';
import { RunnableConfig } from '@langchain/core/runnables';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

// ============================================================================
// SECTION 1: ENHANCED METRICS TRACER
// ============================================================================

/**
 * NodeMetrics Interface
 * 
 * Represents metrics collected for a single node in the graph.
 * Each node tracks its own token usage, execution time, and LLM calls.
 * The tokensByModel field allows tracking usage across multiple models
 * within a single node (useful for nodes that might call multiple LLMs).
 */
interface NodeMetrics {
  name: string;                    // Human-readable node name
  runId: string;                   // Unique identifier for this run
  startTime: number;               // Timestamp when node started
  durationMs?: number;             // Total execution time in milliseconds
  inputTokens: number;             // Total input tokens across all LLM calls
  outputTokens: number;            // Total output tokens across all LLM calls
  totalTokens: number;             // Combined input + output tokens
  invocations: number;             // How many times this node was invoked
  llmCalls: number;                // Number of LLM calls made by this node
  
  // Track tokens by model within this node
  // Key: model name (e.g., "gpt-4o-mini"), Value: token statistics
  tokensByModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calls: number;
  }>;
}

/**
 * EnhancedMetricsTracer Class
 * 
 * Extends LangChain's BaseTracer to intercept and analyze LLM events.
 * This tracer captures detailed metrics about token usage, execution time,
 * and model-specific statistics across complex graph executions.
 * 
 * HOW IT WORKS:
 * 1. onChainStart: Called when any node/chain starts execution
 * 2. onLLMStart: Called when an LLM is invoked (extracts model name)
 * 3. onLLMEnd: Called when LLM completes (extracts token usage)
 * 4. onChainEnd: Called when node/chain completes (calculates duration)
 */
export class EnhancedMetricsTracer extends BaseTracer {
  name = 'enhanced_metrics_tracer' as const;

  // ===== Overall Metrics =====
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalTokens = 0;
  private graphStartTime = 0;
  private graphEndTime = 0;

  // ===== Per-Model Aggregated Metrics =====
  // Tracks total token usage across all nodes for each model
  private tokensByModel = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calls: number;
  }>();

  // ===== Per-Node Metrics =====
  // Maps run ID to node metrics for detailed node-level tracking
  private nodeMetrics = new Map<string, NodeMetrics>();

  constructor() {
    super();
  }

  /**
   * Required by BaseTracer but not used in this implementation
   * since we're not persisting runs to a database
   */
  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Called when a chain/node starts execution
   * 
   * This method:
   * 1. Identifies the root graph execution (no parent_run_id)
   * 2. Filters out internal LangGraph machinery (ChannelWrite, etc.)
   * 3. Initializes metrics tracking for legitimate nodes
   */
  onChainStart(run: Run): void {
    // The root run (entire graph) has no parent
    if (run.parent_run_id === undefined) {
      this.graphStartTime = run.start_time;
    }

    // Ignore internal LangGraph nodes that aren't user-defined
    // These include ChannelWrite, ChannelRead, and other framework internals
    if (run.name.includes('<') || run.name.startsWith('__')) {
      return;
    }

    // Initialize metrics for this node
    this.nodeMetrics.set(run.id, {
      name: run.name,
      runId: run.id,
      startTime: run.start_time,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      invocations: 1,
      llmCalls: 0,
      tokensByModel: {}
    });
  }

  /**
   * Called when a chain/node completes execution
   * 
   * Calculates the duration of the node execution and updates
   * the graph end time if this was the root node
   */
  onChainEnd(run: Run): void {
    // Track graph completion
    if (run.parent_run_id === undefined) {
      this.graphEndTime = run.end_time ?? Date.now();
    }

    // Update node duration
    const metrics = this.nodeMetrics.get(run.id);
    if (metrics && run.end_time) {
      metrics.durationMs = run.end_time - metrics.startTime;
    }
  }

  /**
   * Called when an LLM starts processing
   * 
   * This is where we extract the model name from various possible locations
   * in the run object. Different LangChain integrations store this differently:
   * - serialized.kwargs.model: Most common location
   * - extra.invocation_params.model: Alternative location
   * - extra.metadata.ls_model_name: LangSmith metadata
   * 
   * We store the model name in run.extra for retrieval in onLLMEnd
   */
  onLLMStart(run: Run): void {
    let modelName: string | undefined;
    
    // Try serialized.kwargs.model (most reliable for most providers)
    const serialized = run.serialized as any;
    if (serialized?.kwargs?.model) {
      modelName = serialized.kwargs.model;
    }
    
    // Fallback to extra.invocation_params.model
    if (!modelName && run.extra?.invocation_params?.model) {
      modelName = run.extra.invocation_params.model;
    }
    
    // Fallback to extra.metadata.ls_model_name (LangSmith metadata)
    if (!modelName && run.extra?.metadata?.ls_model_name) {
      modelName = run.extra.metadata.ls_model_name;
    }
    
    if (modelName) {
      // Store model name for later use in onLLMEnd
      run.extra = { ...run.extra, modelName };
    }
  }

  /**
   * Called when an LLM completes processing
   * 
   * This is the most complex method as it:
   * 1. Retrieves the model name (including actual version for OpenAI)
   * 2. Extracts token usage from various possible formats
   * 3. Updates global and per-model statistics
   * 4. Attributes tokens to the parent node using the run hierarchy
   */
  onLLMEnd(run: Run): void {
    // ===== Step 1: Get Model Name =====
    let modelName = run.extra?.modelName;
    
    // For OpenAI, we can get the actual model version from response metadata
    // This gives us "gpt-4o-mini-2024-07-18" instead of just "gpt-4o-mini"
    if (!modelName || modelName.startsWith('gpt')) {
      const responseMetadata = run.outputs?.generations?.[0]?.[0]?.message?.kwargs?.response_metadata;
      if (responseMetadata?.model_name) {
        modelName = responseMetadata.model_name;
      }
    }
    
    // Fallback to extraction from run name
    if (!modelName) {
      modelName = this.extractModelName(run);
    }
    
    // ===== Step 2: Extract Token Usage =====
    // Different providers store token usage in different formats
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    // Path 1: Standard LangChain format (most providers)
    const tokenUsage = run.outputs?.llmOutput?.tokenUsage;
    if (tokenUsage) {
      inputTokens = tokenUsage.promptTokens ?? 0;
      outputTokens = tokenUsage.completionTokens ?? 0;
      totalTokens = tokenUsage.totalTokens ?? 0;
    }

    // Path 2: Vertex AI format
    const usageMetadata = run.outputs?.llmOutput?.usage_metadata;
    if (usageMetadata) {
      inputTokens = usageMetadata.input_tokens ?? 0;
      outputTokens = usageMetadata.output_tokens ?? 0;
      totalTokens = usageMetadata.total_tokens ?? 0;
    }

    // Path 3: OpenAI alternative format
    const usage = run.outputs?.llmOutput?.usage;
    if (usage) {
      inputTokens = usage.prompt_tokens ?? 0;
      outputTokens = usage.completion_tokens ?? 0;
      totalTokens = usage.total_tokens ?? 0;
    }

    // Skip if no token usage found
    if (totalTokens === 0) return;

    // ===== Step 3: Update Global Totals =====
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalTokens += totalTokens;

    // ===== Step 4: Update Per-Model Totals =====
    if (modelName) {
      const modelStats = this.tokensByModel.get(modelName) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0
      };
      
      modelStats.inputTokens += inputTokens;
      modelStats.outputTokens += outputTokens;
      modelStats.totalTokens += totalTokens;
      modelStats.calls += 1;
      
      this.tokensByModel.set(modelName, modelStats);
    }

    // ===== Step 5: Attribute Tokens to Parent Node =====
    // LLM runs are children of node runs. We need to walk up the
    // parent chain to find the node that initiated this LLM call
    let parentRunId = run.parent_run_id;
    let parentNodeMetrics: NodeMetrics | undefined;

    while (parentRunId) {
      const parentRun = this.runMap.get(parentRunId);
      if (parentRun && this.nodeMetrics.has(parentRun.id)) {
        parentNodeMetrics = this.nodeMetrics.get(parentRun.id);
        break; // Found the parent node
      }
      parentRunId = parentRun?.parent_run_id;
    }

    if (parentNodeMetrics) {
      // Update node-level totals
      parentNodeMetrics.inputTokens += inputTokens;
      parentNodeMetrics.outputTokens += outputTokens;
      parentNodeMetrics.totalTokens += totalTokens;
      parentNodeMetrics.llmCalls += 1;

      // Update per-model tokens for this specific node
      if (modelName) {
        const nodeModelStats = parentNodeMetrics.tokensByModel[modelName] || {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          calls: 0
        };
        
        nodeModelStats.inputTokens += inputTokens;
        nodeModelStats.outputTokens += outputTokens;
        nodeModelStats.totalTokens += totalTokens;
        nodeModelStats.calls += 1;
        
        parentNodeMetrics.tokensByModel[modelName] = nodeModelStats;
      }
    }
  }

  /**
   * Fallback method to extract model name from run metadata
   * Used when model name isn't found in the expected locations
   */
  private extractModelName(run: Run): string {
    const serialized = run.serialized as any;
    if (serialized?.kwargs?.model) return serialized.kwargs.model;
    if (serialized?.name) return serialized.name;
    
    // Last resort - check run name for provider hints
    if (run.name.includes('ChatVertexAI')) return 'Vertex AI (Unknown Model)';
    if (run.name.includes('ChatOpenAI')) return 'OpenAI (Unknown Model)';
    if (run.name.includes('ChatAnthropic')) return 'Anthropic (Unknown Model)';
    
    return 'Unknown';
  }

  /**
   * Displays comprehensive metrics in the console
   * 
   * Shows:
   * 1. Overall summary (duration, total tokens)
   * 2. Token usage broken down by model
   * 3. Per-node breakdown with timing and token information
   */
  public logMetrics(): void {
    console.log('\n\n📊 ================== Graph Performance Metrics ================== 📊');

    const totalDuration = this.graphEndTime - this.graphStartTime;
    console.log(`\n📈 Overall Summary:`);
    console.log(`  - Total Duration: ${totalDuration.toFixed(2)}ms`);
    console.log(`  - Total Tokens:   ${this.totalTokens} (Input: ${this.totalInputTokens}, Output: ${this.totalOutputTokens})`);

    // Show token usage by model
    if (this.tokensByModel.size > 0) {
      console.log('\n🤖 Token Usage by Model:');
      const modelData = Array.from(this.tokensByModel.entries()).map(([model, stats]) => ({
        'Model': model,
        'Calls': stats.calls,
        'Total Tokens': stats.totalTokens,
        'Input Tokens': stats.inputTokens,
        'Output Tokens': stats.outputTokens,
        'Avg Tokens/Call': Math.round(stats.totalTokens / stats.calls)
      }));
      console.table(modelData);
    }

    console.log('\n🔍 Per-Node Breakdown:');
    const tableData = Array.from(this.nodeMetrics.values()).map(m => ({
      'Node Name': m.name,
      'Duration (ms)': m.durationMs?.toFixed(2) ?? 'N/A',
      'LLM Calls': m.llmCalls,
      'Total Tokens': m.totalTokens,
      'Models Used': Object.keys(m.tokensByModel).join(', ') || 'None'
    }));

    if (tableData.length > 0) {
      console.table(tableData);
    }
    console.log('\n====================================================================\n');
  }

  /**
   * Exports metrics to a JSON file for further analysis
   * 
   * The JSON structure includes:
   * - Overall metrics with model breakdown
   * - Detailed per-node metrics including model usage
   * - Timing information for performance analysis
   */
  public writeMetricsToFile(filePath: string): void {
    const output = {
      overall: {
        totalDurationMs: this.graphEndTime - this.graphStartTime,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalTokens: this.totalTokens,
        tokensByModel: Object.fromEntries(this.tokensByModel)
      },
      nodes: Array.from(this.nodeMetrics.values())
    };

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
    console.log(`💾 Metrics saved to ${filePath}`);
  }
}

// ============================================================================
// SECTION 2: GRAPH STATE AND TOOL DEFINITIONS
// ============================================================================

/**
 * Main Graph State Definition
 * 
 * Uses LangGraph's Annotation system to define the state shape.
 * Each field can have a reducer function that determines how updates
 * are merged into the existing state.
 */
const GraphState = Annotation.Root({
  // Messages accumulate throughout the graph execution
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Fields set by specific nodes
  plan: Annotation<string>,              // Planner's analysis of the request
  research_needed: Annotation<boolean>,  // Whether deep research is required
  research_results: Annotation<string>,  // Results from the research subgraph
  tool_output: Annotation<string>        // Output from tool execution
});

/**
 * Research Subgraph State
 * 
 * Uses the built-in MessagesAnnotation for simplicity.
 * This provides automatic message accumulation without custom reducers.
 */
const ResearchState = MessagesAnnotation;

/**
 * Planner Output Schema
 * 
 * Defines the structured output expected from the planner LLM.
 * Using Zod schemas with LangChain ensures type safety and validation.
 */
const PlanSchema = z.object({
  plan: z.string().describe("A concise plan to address the user's request"),
  needs_research: z.boolean().describe("Whether additional research is needed"),
  research_query: z.string().optional().describe("The research query if needed"),
  tool_to_use: z.enum(['search_web', 'none']).describe("Tool to use after research")
});

/**
 * Web Search Tool
 * 
 * A simple tool that simulates web search functionality.
 * In production, this would call an actual search API.
 */
const searchWebTool = tool(
  async ({ query }: { query: string }) => {
    console.log(`\n🔍 Searching web for: "${query}"...`);
    await new Promise(res => setTimeout(res, 500)); // Simulate API delay
    
    // Mock responses based on query content
    if (query.toLowerCase().includes('langgraph')) {
      return 'LangGraph is a library for building stateful, multi-actor applications with LLMs. It provides graph-based orchestration for complex agent workflows.';
    } else if (query.toLowerCase().includes('token')) {
      return 'LLM tokens are the basic units of text that language models process. Different models count tokens differently.';
    }
    return 'General information about the topic.';
  },
  {
    name: 'search_web',
    description: 'Search the web for information',
    schema: z.object({ query: z.string() })
  }
);

/**
 * Deep Research Tool
 * 
 * Used by the research subgraph for more comprehensive information gathering.
 * This demonstrates how different parts of the graph can use different tools.
 */
const researchTool = tool(
  async ({ topic }: { topic: string }) => {
    console.log(`\n📚 Deep researching: "${topic}"...`);
    await new Promise(res => setTimeout(res, 800)); // Simulate longer processing
    return `In-depth research findings about ${topic}: This topic involves complex interactions between multiple components. Key insights include scalability, performance optimization, and best practices.`;
  },
  {
    name: 'deep_research',
    description: 'Perform deep research on a topic',
    schema: z.object({ topic: z.string() })
  }
);

// ============================================================================
// SECTION 3: SUBGRAPH DEFINITION (USES OPENAI)
// ============================================================================

/**
 * Research Node for the Subgraph
 * 
 * This node uses OpenAI (different from the main graph's Vertex AI)
 * to demonstrate multi-model tracking. The node:
 * 1. Configures OpenAI with specific parameters
 * 2. Binds the research tool for the model to use
 * 3. Processes the research query and returns findings
 */
async function researchWithOpenAI(state: typeof ResearchState.State, config?: RunnableConfig) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Configure OpenAI model with tool binding
  const model = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.7,
  }).bindTools([researchTool]);

  // Extract the research query from the last message
  const lastMessage = state.messages[state.messages.length - 1];
  const prompt = `You are a research assistant using OpenAI. The user needs research on: ${lastMessage.content}. 
  Use the deep_research tool to gather comprehensive information.`;

  // Invoke the model (token usage will be tracked by our tracer)
  const response = await model.invoke(prompt, config);
  return { messages: [response] };
}

/**
 * Routing function for the research subgraph
 * 
 * Determines whether to execute tools or end the subgraph execution
 * based on whether the model requested tool calls.
 */
function shouldContinueResearch(state: typeof ResearchState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

/**
 * Creates the research subgraph
 * 
 * This is a complete mini-graph that:
 * 1. Receives a research query
 * 2. Uses OpenAI to analyze it
 * 3. Executes research tools as needed
 * 4. Returns comprehensive findings
 */
export function createResearchSubgraph() {
  return new StateGraph(ResearchState)
    .addNode("research", researchWithOpenAI)
    .addNode("tools", new ToolNode([researchTool]))
    .addEdge("__start__", "research")
    .addConditionalEdges("research", shouldContinueResearch, {
      tools: "tools",
      end: "__end__"
    })
    .addEdge("tools", "__end__")
    .compile();
}

// ============================================================================
// SECTION 4: MAIN GRAPH NODES
// ============================================================================

/**
 * Planner Node
 * 
 * The entry point of our graph that:
 * 1. Analyzes the user's request using Vertex AI
 * 2. Decides whether deep research is needed
 * 3. Creates a plan for addressing the request
 * 
 * Uses structured output to ensure consistent response format
 */
const planner_node = async (state: typeof GraphState.State, config?: RunnableConfig) => {
  // Configure Vertex AI with structured output schema
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0,
  }).withStructuredOutput(PlanSchema);

  const prompt = `Analyze the user's request and create a plan. Determine if deep research is needed before answering.
  User Request: ${state.messages[state.messages.length - 1].content}`;

  // Invoke the model (token usage tracked by our tracer)
  const result = await model.invoke(prompt, config);

  return {
    plan: result.plan,
    research_needed: result.needs_research,
    messages: [
      new AIMessage(`I'll help you with that. ${result.plan}`)
    ]
  };
};

/**
 * Research Integration Node
 * 
 * This node:
 * 1. Checks if research is needed (set by planner)
 * 2. Creates and invokes the research subgraph if needed
 * 3. Extracts and formats the research findings
 * 
 * Demonstrates how to integrate subgraphs into a larger graph
 */
async function research_node(state: typeof GraphState.State, config?: RunnableConfig) {
  if (!state.research_needed) {
    return { research_results: "No research needed" };
  }

  console.log("\n🔬 Initiating research subgraph with OpenAI...");
  
  // Create and invoke the subgraph
  const researchSubgraph = createResearchSubgraph();
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage.content === 'string' ? lastMessage.content : 'Research query';
  
  // The subgraph will use its own state but inherit our config (including tracer)
  const result = await researchSubgraph.invoke(
    { messages: [new HumanMessage(query)] },
    config
  );

  // Extract research findings from subgraph output
  let findings = "";
  for (const msg of result.messages) {
    if (msg.content && typeof msg.content === 'string') {
      findings += msg.content + "\n";
    }
  }

  return {
    research_results: findings,
    messages: [new AIMessage("Research completed. " + findings)]
  };
}

/**
 * Tool Execution Node
 * 
 * Executes the web search tool based on the user's query.
 * This node demonstrates:
 * 1. Creating tool call messages programmatically
 * 2. Using ToolNode for automatic tool execution
 * 3. Extracting and storing tool output in state
 */
const toolNodeWithOutput = async (state: typeof GraphState.State, config?: RunnableConfig) => {
  const toolNode = new ToolNode([searchWebTool]);
  
  // Extract search query from the original user message
  const firstMessage = state.messages[0];
  const searchQuery = typeof firstMessage.content === 'string' ? firstMessage.content : 'general search';
  
  // Create a tool call message
  const toolCallMessage = new AIMessage({
    content: '',
    tool_calls: [{
      name: 'search_web',
      args: { query: searchQuery },
      id: `call_${Date.now()}`
    }]
  });

  // Add tool call to messages and invoke ToolNode
  const modifiedState = {
    ...state,
    messages: [...state.messages, toolCallMessage]
  };

  const result = await toolNode.invoke(modifiedState, config);
  
  // Extract tool output from the result
  const lastMessage = result.messages[result.messages.length - 1];
  const toolOutput = lastMessage.content || '';
  
  return {
    messages: result.messages,
    tool_output: toolOutput
  };
};

/**
 * Summarizer Node
 * 
 * The final node that:
 * 1. Gathers all information from previous nodes
 * 2. Generates a comprehensive answer using Vertex AI
 * 3. Returns the final response to the user
 */
const summarizer_node = async (state: typeof GraphState.State, config?: RunnableConfig) => {
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.1,
  });

  // Extract original request
  const firstMessage = state.messages[0];
  const originalRequest = typeof firstMessage.content === 'string' ? firstMessage.content : 'User request';
  
  // Compile all gathered information
  const prompt = `Generate a comprehensive answer based on:
  Original Request: ${originalRequest}
  Plan: ${state.plan}
  Research Results: ${state.research_results || 'None'}
  Tool Output: ${state.tool_output || 'None'}
  
  Provide a clear, concise answer.`;

  const response = await model.invoke(prompt, config);
  return { messages: [response] };
};

// ============================================================================
// SECTION 5: GRAPH ROUTING LOGIC
// ============================================================================

/**
 * Routing function after the planner node
 * 
 * Determines the next step based on whether research is needed:
 * - If research needed → research_node
 * - Otherwise → tool_node
 */
const route_after_plan = (state: typeof GraphState.State) => {
  if (state.research_needed) {
    return 'research_node';
  }
  return 'tool_node';
};

// ============================================================================
// SECTION 6: MAIN EXECUTION
// ============================================================================

/**
 * Main function that:
 * 1. Creates the tracer instance
 * 2. Builds the graph with all nodes and edges
 * 3. Executes the graph with a sample query
 * 4. Displays and saves the metrics
 */
async function main() {
  // Create our custom tracer
  const metricsTracer = new EnhancedMetricsTracer();

  // Build the graph structure
  const workflow = new StateGraph(GraphState)
    // Add all nodes
    .addNode('planner_node', planner_node)
    .addNode('research_node', research_node)
    .addNode('tool_node', toolNodeWithOutput)
    .addNode('summarizer_node', summarizer_node)

    // Define the flow
    .addEdge('__start__', 'planner_node')
    .addConditionalEdges('planner_node', route_after_plan, {
      research_node: 'research_node',
      tool_node: 'tool_node'
    })
    .addEdge('research_node', 'tool_node')
    .addEdge('tool_node', 'summarizer_node')
    .addEdge('summarizer_node', '__end__');

  // Compile the graph
  const graph = workflow.compile();

  console.log('🚀 Starting graph execution with subgraph and multi-model tracking...\n');

  // Create input that will trigger both research and tool usage
  const input = {
    messages: [new HumanMessage('What is LangGraph and how does token counting work in LLMs?')],
  };

  // Execute the graph with our tracer in the callbacks
  const result = await graph.invoke(input, {
    callbacks: [metricsTracer],
  });

  console.log('\n✅ Graph execution finished.');
  console.log('Final Answer:', result.messages.slice(-1)[0].content);

  // Display comprehensive metrics
  metricsTracer.logMetrics();

  // Save metrics to file for further analysis
  metricsTracer.writeMetricsToFile(
    path.join(__dirname, 'logs', `metrics-multimodel-${Date.now()}.json`)
  );
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}
