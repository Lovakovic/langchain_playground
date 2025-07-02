/**
 * Tool Call Tracing from onLLMEnd Events
 * 
 * This example demonstrates how to extract tool calls from LLM end events
 * rather than waiting for onToolEnd events. This is useful when you want
 * to capture tool calls as soon as the LLM decides to use them.
 */

import { BaseTracer, Run } from "@langchain/core/tracers/base";
import { StateGraph, MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as util from "util";
import dotenv from "dotenv";

dotenv.config();

/**
 * Tool Call Tracer that captures tool calls from onLLMEnd events
 * 
 * This tracer demonstrates the correct way to extract tool calls from LLM responses,
 * which allows you to see what tools the LLM decided to call before they're executed.
 */
export class LLMEndToolCallTracer extends BaseTracer {
  name = "llm_end_tool_call_tracer" as const;
  
  private currentNodeContext: string | null = null;
  private toolCallsFromLLM = 0;
  private toolExecutions = 0;
  
  constructor() {
    super();
  }

  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Track node context for better hierarchy understanding
   */
  onChainStart(run: Run): void {
    // Track user-defined nodes (exclude system nodes)
    const isUserNode = !run.name.includes("__") && 
                      !run.name.includes("<") && 
                      !run.name.includes("ChannelWrite") &&
                      run.name !== "tools";
    
    if (isUserNode) {
      this.currentNodeContext = run.name;
      console.log(`\n[Node Start] ${run.name}`);
    }
  }

  /**
   * Extract tool calls from LLM responses
   */
  onLLMEnd(run: Run): void {
    // Navigate to the tool calls in the output structure
    const message = run.outputs?.generations?.[0]?.[0]?.message;
    
    if (message?.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      console.log("\n" + "=".repeat(80));
      console.log("🤖 LLM TOOL DECISION CAPTURED");
      console.log("=".repeat(80));
      
      console.log(`Context Node: ${this.currentNodeContext || "unknown"}`);
      console.log(`Number of Tool Calls: ${message.tool_calls.length}`);
      console.log(`LLM Model: ${run.name}`);
      
      // Display each tool call decision
      message.tool_calls.forEach((toolCall: any, index: number) => {
        this.toolCallsFromLLM++;
        
        console.log(`\n📋 Tool Call #${index + 1}:`);
        console.log(`   Name: ${toolCall.name}`);
        console.log(`   ID: ${toolCall.id}`);
        console.log(`   Arguments:`);
        const argsString = util.inspect(toolCall.args, {
          depth: null,
          colors: true,
          maxArrayLength: null,
          breakLength: 80,
          compact: false
        });
        console.log(argsString.split('\n').map(line => '      ' + line).join('\n'));
      });
      
      // Also show token usage if available
      if (message.usage_metadata) {
        console.log(`\n📊 Token Usage:`);
        console.log(`   Input: ${message.usage_metadata.input_tokens}`);
        console.log(`   Output: ${message.usage_metadata.output_tokens}`);
        console.log(`   Total: ${message.usage_metadata.total_tokens}`);
      }
      
      console.log("\n" + "=".repeat(80) + "\n");
    }
  }

  /**
   * Track actual tool executions for comparison
   */
  onToolEnd(run: Run): void {
    this.toolExecutions++;
    
    console.log("\n" + "-".repeat(80));
    console.log("⚙️  TOOL EXECUTION COMPLETED");
    console.log("-".repeat(80));
    
    console.log(`Tool Name: ${run.name}`);
    if (run.end_time && run.start_time) {
      console.log(`Execution Time: ${run.end_time - run.start_time}ms`);
    }
    
    console.log("\n📤 Tool Output:");
    console.log(util.inspect(run.outputs?.output, {
      depth: null,
      colors: true,
      maxArrayLength: null,
      breakLength: 80,
      compact: false
    }));
    
    console.log("\n" + "-".repeat(80) + "\n");
  }

  getSummary() {
    return {
      toolCallsDetectedFromLLM: this.toolCallsFromLLM,
      toolsActuallyExecuted: this.toolExecutions,
      match: this.toolCallsFromLLM === this.toolExecutions
    };
  }
}

// Define state for our graph
const GraphState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  toolCallCount: Annotation<number>({
    reducer: (current, update) => (current || 0) + (update || 0),
    default: () => 0
  })
});

// Define tools
const calculateTool = tool(
  async ({ a, b, operation }: { a: number; b: number; operation: string }) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const operations: Record<string, (a: number, b: number) => number | string> = {
      add: (a, b) => a + b,
      subtract: (a, b) => a - b,
      multiply: (a, b) => a * b,
      divide: (a, b) => b !== 0 ? a / b : "Cannot divide by zero"
    };
    
    return operations[operation]?.(a, b) ?? "Unknown operation";
  },
  {
    name: "calculator",
    description: "Perform basic math operations",
    schema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
      operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("Math operation")
    })
  }
);

const weatherTool = tool(
  async ({ location }: { location: string }) => {
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Simulate weather data
    const weatherData: Record<string, any> = {
      "Tokyo": { temp: 72, conditions: "Sunny", humidity: 45 },
      "London": { temp: 55, conditions: "Rainy", humidity: 80 },
      "New York": { temp: 68, conditions: "Cloudy", humidity: 60 }
    };
    
    const data = weatherData[location] || { temp: 70, conditions: "Clear", humidity: 50 };
    
    return {
      location,
      temperature: data.temp,
      conditions: data.conditions,
      humidity: data.humidity,
      forecast: `${data.conditions} conditions expected to continue`
    };
  },
  {
    name: "get_weather",
    description: "Get current weather for a location",
    schema: z.object({
      location: z.string().describe("City name")
    })
  }
);

const searchTool = tool(
  async ({ query, limit }: { query: string; limit: number }) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    
    return {
      query,
      results: Array.from({ length: limit }, (_, i) => ({
        title: `Result ${i + 1} for "${query}"`,
        url: `https://example.com/result${i + 1}`,
        snippet: `This is a relevant snippet about ${query}...`
      })),
      totalResults: 100,
      searchTime: "0.2s"
    };
  },
  {
    name: "web_search",
    description: "Search the web for information",
    schema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().default(3).describe("Number of results")
    })
  }
);

/**
 * Create a multi-layer graph to demonstrate tool calling in nested contexts
 */
function createNestedGraph() {
  // Inner subgraph that actually calls tools
  function createToolCallingSubgraph() {
    async function analyzeRequest(state: typeof GraphState.State) {
      // Force specific tool calls based on the user's request
      const lastMessage = state.messages[state.messages.length - 1];
      const content = lastMessage.content as string;
      
      console.log(`[Analyzer] Processing request: "${content}"`);
      
      // Create AI message with tool calls
      const toolCalls = [];
      
      if (content.toLowerCase().includes("weather")) {
        toolCalls.push({
          name: "get_weather",
          args: { location: "Tokyo" },
          id: `weather_${Date.now()}`
        });
      }
      
      if (content.toLowerCase().includes("multiply") || content.toLowerCase().includes("times")) {
        toolCalls.push({
          name: "calculator",
          args: { a: 25, b: 4, operation: "multiply" },
          id: `calc_${Date.now()}`
        });
      }
      
      if (content.toLowerCase().includes("search")) {
        toolCalls.push({
          name: "web_search",
          args: { query: "LangChain tool calling", limit: 2 },
          id: `search_${Date.now()}`
        });
      }
      
      const aiMessage = new AIMessage({
        content: "",
        tool_calls: toolCalls
      });
      
      return { 
        messages: [aiMessage],
        toolCallCount: toolCalls.length
      };
    }
    
    function shouldCallTools(state: typeof GraphState.State) {
      const lastMessage = state.messages[state.messages.length - 1];
      if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
        return "tools";
      }
      return "summarize";
    }
    
    async function summarizeResults(state: typeof GraphState.State) {
      const toolMessages = state.messages.filter(m => m._getType() === "tool");
      return {
        messages: [new AIMessage(`Processed ${toolMessages.length} tool results`)]
      };
    }
    
    return new StateGraph(GraphState)
      .addNode("analyze", analyzeRequest)
      .addNode("tools", new ToolNode([calculateTool, weatherTool, searchTool]))
      .addNode("summarize", summarizeResults)
      .addEdge("__start__", "analyze")
      .addConditionalEdges("analyze", shouldCallTools)
      .addEdge("tools", "summarize")
      .addEdge("summarize", "__end__")
      .compile();
  }
  
  // Outer graph that contains the subgraph
  const toolSubgraph = createToolCallingSubgraph();
  
  async function coordinator(state: typeof GraphState.State) {
    console.log(`[Coordinator] Delegating to tool subgraph`);
    return {
      messages: [new AIMessage("Coordinating tool execution")]
    };
  }
  
  return new StateGraph(GraphState)
    .addNode("coordinator", coordinator)
    .addNode("tool_subgraph", toolSubgraph)
    .addEdge("__start__", "coordinator")
    .addEdge("coordinator", "tool_subgraph")
    .addEdge("tool_subgraph", "__end__")
    .compile();
}

/**
 * Alternative: Using real LLM for tool calling
 */
function createLLMGraph() {
  const model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0
  });
  
  const tools = [calculateTool, weatherTool, searchTool];
  const modelWithTools = model.bindTools(tools);
  
  async function callModel(state: typeof MessagesAnnotation.State) {
    const response = await modelWithTools.invoke(state.messages);
    return { messages: [response] };
  }
  
  async function shouldUseTool(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
      return "tools";
    }
    return "__end__";
  }
  
  return new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldUseTool)
    .addEdge("tools", "agent")
    .compile();
}

// Main execution
async function main() {
  console.log("🔍 Tool Call Tracing from onLLMEnd Events");
  console.log("=" + "=".repeat(79));
  console.log("\nThis example shows how to capture tool calls from LLM responses");
  console.log("before they are executed, using the onLLMEnd event.\n");
  
  const tracer = new LLMEndToolCallTracer();
  
  console.log("DEMO 1: Forced Tool Calls in Nested Graph");
  console.log("-".repeat(80));
  
  const nestedGraph = createNestedGraph();
  
  try {
    await nestedGraph.invoke(
      { messages: [new HumanMessage("What's 25 times 4, and what's the weather?")] },
      { callbacks: [tracer] }
    );
  } catch (error) {
    console.error(`Error: ${error}`);
  }
  
  console.log("\n\nDEMO 2: Real LLM Tool Calling");
  console.log("-".repeat(80));
  
  const llmGraph = createLLMGraph();
  
  try {
    await llmGraph.invoke(
      { messages: [new HumanMessage("Search for LangChain tool calling and multiply 25 by 4")] },
      { callbacks: [tracer] }
    );
  } catch (error) {
    console.error(`Error: ${error}`);
  }
  
  // Summary
  const summary = tracer.getSummary();
  console.log("\n\n📊 SUMMARY");
  console.log("=".repeat(80));
  console.log(`Tool calls detected from LLM: ${summary.toolCallsDetectedFromLLM}`);
  console.log(`Tools actually executed: ${summary.toolsActuallyExecuted}`);
  console.log(`Match: ${summary.match ? "✅ Yes" : "❌ No"}`);
  
  console.log("\n💡 Key Insight:");
  console.log("The onLLMEnd event lets you see tool decisions immediately when the LLM");
  console.log("makes them, before waiting for the actual tool execution to complete.");
}

if (require.main === module) {
  main().catch(console.error);
}