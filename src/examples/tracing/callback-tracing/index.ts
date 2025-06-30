/**
 * LangChain Callback Tracing Example with File Logging
 * 
 * This example demonstrates LangChain's callback system - a powerful feature
 * that allows you to hook into EVERY stage of execution for logging, monitoring,
 * debugging, and streaming.
 * 
 * KEY CONCEPTS:
 * 
 * 1. CALLBACKS ARE EVERYWHERE
 *    Every LangChain component (models, tools, chains, agents) supports callbacks.
 *    They fire for ALL operations, creating a complete trace of execution.
 * 
 * 2. TWO WAYS TO PASS CALLBACKS
 *    - Constructor: new ChatVertexAI({ callbacks: [handler] })
 *      Scoped to that specific object only
 *    - Runtime: model.invoke(input, { callbacks: [handler] })
 *      Inherited by ALL child operations (recommended)
 * 
 * 3. EVENT TYPES
 *    - Chain events: start/end/error for any Runnable
 *    - LLM events: start/end/error plus token streaming
 *    - Tool events: start/end/error for tool execution
 *    - Retriever events: for RAG applications
 * 
 * 4. RUN HIERARCHY
 *    Every operation creates a "Run" with parent-child relationships.
 *    This creates a trace tree showing exactly how your app executes.
 * 
 * 5. PRACTICAL USES
 *    - Debugging: See exact inputs/outputs at each step
 *    - Monitoring: Track performance, token usage, errors
 *    - Streaming: Show progress to users in real-time
 *    - Auditing: Log all LLM interactions for compliance
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { FileCallbackHandler } from "./FileCallbackHandler";
import dotenv from "dotenv";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Weather Tool - Simulates an external API call
 * 
 * When this tool is invoked, callbacks will fire:
 * 1. onToolStart - with the input arguments
 * 2. onToolEnd - with the output (or onToolError if it fails)
 * 
 * The tool name "get_weather" will appear in the breadcrumbs
 */
const WeatherSchema = z.object({
  location: z.string().describe("The location to get weather for")
});

const getWeatherTool = tool(
  async ({ location }) => {
    // Simulate API delay - you'll see this in the elapsed time
    await new Promise(resolve => setTimeout(resolve, 1000));
    const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temperature = Math.floor(Math.random() * 30) + 50;
    return `The weather in ${location} is ${condition} with a temperature of ${temperature}°F.`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a location",
    schema: WeatherSchema,
  }
);

/**
 * Calculator Tool - Demonstrates error handling
 * 
 * If this tool throws an error, onToolError will fire instead of onToolEnd
 */
const CalculatorSchema = z.object({
  expression: z.string().describe("Mathematical expression to evaluate")
});

const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // Simple eval for demo - in production use a proper math parser
      const result = eval(expression);
      return `The result of ${expression} is ${result}`;
    } catch (error) {
      throw new Error(`Failed to calculate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
  {
    name: "calculator",
    description: "Perform mathematical calculations",
    schema: CalculatorSchema,
  }
);

/**
 * Model Node - This is where LLM callbacks fire
 * 
 * When the model is invoked:
 * 1. onLLMStart - with the messages being sent
 * 2. onLLMEnd - with the response including token usage
 * 
 * The model name "ChatVertexAI" appears in breadcrumbs
 */
async function callModel(state: typeof MessagesAnnotation.State) {
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    streaming: true,
  });
  
  const modelWithTools = model.bindTools([getWeatherTool, calculatorTool]);
  const response = await modelWithTools.invoke(state.messages);
  
  return { messages: [response] };
}

/**
 * Routing Function - Creates "Branch" chain events
 * 
 * This function determines the next node in the graph.
 * You'll see "Branch<agent,tools,end>" in the trace showing
 * the conditional routing decision.
 */
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

/**
 * Create ReAct Agent
 * 
 * CRITICAL: Node names defined here appear in callback breadcrumbs!
 * - "agent" node -> appears as "chain:agent" in traces
 * - "tools" node -> appears as "chain:tools" in traces
 * 
 * The graph name comes from the compiled graph class: "LangGraph"
 */
async function createReActAgent(checkpointer?: any) {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)        // This "agent" name appears in breadcrumbs
    .addNode("tools", new ToolNode([getWeatherTool, calculatorTool]))  // This "tools" name appears
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  return workflow.compile(checkpointer ? { checkpointer } : {});
}

/**
 * Run Agent with File Logging
 * 
 * CRITICAL: We pass the callback handler at RUNTIME, not in constructor!
 * This ensures ALL operations (model, tools, chains) inherit the callback.
 * 
 * The callback parameter in streamEvents is how we hook into the system:
 * - All events flow through our FileCallbackHandler
 * - The handler writes detailed logs while we show clean UI
 */
async function runWithFileLogging(
  agent: any, 
  input: HumanMessage, 
  sessionId: string,
  fileHandler: FileCallbackHandler
) {
  console.log("\n🤔 Agent thinking...");
  
  // Pass callback handler here - it will be inherited by all child operations
  const eventStream = agent.streamEvents(
    { messages: [input] },
    { 
      version: "v2",
      configurable: { thread_id: sessionId },
      callbacks: [fileHandler]  // <-- THIS IS THE KEY! Runtime callbacks are inherited
    }
  );
  
  let fullResponse = "";
  let firstChunk = true;
  
  // Process streaming events for UI (separate from callback events)
  for await (const event of eventStream) {
    // These are streaming events, different from callback events
    // Callbacks fire for ALL operations, streaming events are selective
    
    if (event.event === "on_chat_model_stream") {
      const chunk = event.data?.chunk;
      if (chunk?.content) {
        if (firstChunk) {
          console.log("\n🤖 Assistant:");
          firstChunk = false;
        }
        process.stdout.write(chunk.content);
        fullResponse += chunk.content;
      }
    }
    
    if (event.event === "on_tool_start") {
      console.log("\n\n🛠️  Using tool:", event.name);
    }
    
    if (event.event === "on_tool_end") {
      console.log("✅ Tool completed");
      console.log("\n🤔 Processing result...");
      firstChunk = true;
    }
  }
  
  console.log("\n");
  return fullResponse;
}

/**
 * Main Application
 * 
 * Demonstrates the complete callback system:
 * 1. Create a custom callback handler (FileCallbackHandler)
 * 2. Pass it at runtime to capture all events
 * 3. Show clean UI while detailed logs go to file
 */
async function main() {
  console.log("=== LangChain Callback Tracing Example ===");
  console.log("Clean UI with detailed file logging\n");
  
  // Create our custom callback handler
  const logFile = path.join(logsDir, `trace-${new Date().toISOString().replace(/:/g, '-')}.log`);
  const fileHandler = new FileCallbackHandler(logFile);
  
  console.log(`📝 Logs: ${path.relative(process.cwd(), logFile)}`);
  console.log("\nAvailable tools: weather lookup, calculator");
  console.log("Type 'exit' to quit or 'logs' to see the log file path\n");
  
  // Initialize agent
  const checkpointer = new MemorySaver();
  const agent = await createReActAgent(checkpointer);
  const sessionId = `session-${Date.now()}`;
  
  // Setup readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });
  
  console.log("🤖 Assistant: Hello! I can help you check the weather or perform calculations. What would you like to know?");
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit') {
      console.log("\n👋 Goodbye!");
      fileHandler.close();
      rl.close();
      process.exit(0);
    }
    
    if (userInput.toLowerCase() === 'logs') {
      console.log(`\n📝 Logs are at: ${logFile}`);
      rl.prompt();
      return;
    }
    
    if (userInput) {
      const input = new HumanMessage(userInput);
      // Pass our callback handler with each request
      await runWithFileLogging(agent, input, sessionId, fileHandler);
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log("\n👋 Session ended.");
    fileHandler.close();
    process.exit(0);
  });
}

/**
 * UNDERSTANDING THE TRACE
 * 
 * Looking at our trace file, we can see the complete execution flow:
 * 
 * 1. ROOT CHAIN: "1:chain:LangGraph"
 *    The main graph execution starts
 * 
 * 2. INTERNAL ROUTING: "__start__" node
 *    LangGraph's entry point with ChannelWrite operations
 * 
 * 3. AGENT NODE: "5:chain:agent"
 *    Our agent node executes, which calls the LLM
 * 
 * 4. LLM INVOCATION: "6:llm:ChatVertexAI"
 *    The model decides to use the weather tool
 * 
 * 5. CONDITIONAL ROUTING: "8:chain:Branch<agent,tools,end>"
 *    Routes to "tools" based on the LLM's tool call
 * 
 * 6. TOOLS NODE: "9:chain:tools"
 *    Executes the tool call
 * 
 * 7. TOOL EXECUTION: "10:tool:get_weather"
 *    The actual weather tool runs (takes 1 second)
 * 
 * 8. BACK TO AGENT: "13:chain:agent"
 *    Agent processes the tool result
 * 
 * 9. FINAL LLM CALL: "14:llm:ChatVertexAI"
 *    Model generates the final response with weather info
 * 
 * 10. END ROUTING: "16:chain:Branch<agent,tools,end>"
 *     Routes to "end" to complete execution
 * 
 * The breadcrumbs preserve this entire hierarchy, making debugging easy!
 */

if (require.main === module) {
  main().catch(console.error);
}
