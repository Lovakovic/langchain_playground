/**
 * LangGraph ReAct Agent Example
 * 
 * This example demonstrates building a ReAct (Reasoning + Acting) agent using LangGraph.
 * The agent:
 * - Reasons about user requests
 * - Decides when to use tools
 * - Executes tools and processes results
 * - Maintains conversation memory
 * - Streams responses in real-time
 * 
 * Key concepts:
 * - Tool calling with Zod schemas
 * - Conditional edges for tool execution
 * - Memory persistence with checkpointers
 * - Event streaming for real-time output
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { geminiBase } from "../../shared/utils/models/vertexai";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch from "node-fetch";

/**
 * Tool Schema Definition
 * 
 * Using Zod for runtime validation and TypeScript type inference.
 * The schema describes what parameters the tool accepts.
 */
const CatPictureSchema = z.object({
  filename: z.string().optional().describe("Optional filename for the cat picture (without extension)")
});

/**
 * UI Elements for Better User Experience
 * 
 * These provide visual feedback during long-running operations
 */
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const catMessages = [
  "Summoning a feline from the internet void",
  "Convincing a cat to pose for your picture",
  "Opening a can of tuna to attract photogenic cats",
  "Negotiating with the cat overlords",
  "Deploying laser pointer to catch cat's attention",
  "Bribing cats with treats for the perfect shot",
  "Waiting for cat to finish its important nap",
  "Cat is considering your request... maybe"
];


/**
 * Tool Definition
 * 
 * Tools in LangGraph:
 * - Are async functions that perform actions
 * - Have schemas for parameter validation
 * - Return results that the LLM can use
 * 
 * This tool:
 * 1. Fetches a random cat image from an API
 * 2. Saves it to the user's Desktop
 * 3. Returns the file path for the LLM to reference
 */
const fetchCatPictureTool = tool(
  async ({ filename }) => {
    // Artificial delay to demonstrate streaming UI
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      // Fetch random cat image
      const response = await fetch('https://api.thecatapi.com/v1/images/search');
      const data = await response.json();
      const imageUrl = data[0].url;
      
      // Download the image
      const imageResponse = await fetch(imageUrl);
      const buffer = await imageResponse.buffer();
      
      // Save to Desktop
      const desktopPath = path.join(os.homedir(), 'Desktop');
      const extension = path.extname(new URL(imageUrl).pathname) || '.jpg';
      const finalFilename = filename || `cat_${Date.now()}`;
      const filePath = path.join(desktopPath, `${finalFilename}${extension}`);
      
      fs.writeFileSync(filePath, buffer);
      
      return `Successfully saved a cat picture to your Desktop as ${finalFilename}${extension}! 🐱\nFull path: ${filePath}`;
    } catch (error) {
      return `Failed to fetch cat picture: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: "fetch_cat_picture",
    description: "Fetch a random cat picture from the internet and save it to the user's Desktop",
    schema: CatPictureSchema,
  }
);

/**
 * Model Node
 * 
 * This node:
 * 1. Takes the current conversation state
 * 2. Invokes the LLM with tool capabilities
 * 3. Returns the model's response (which may include tool calls)
 * 
 * Note: We bind tools to the model so it knows what actions it can take
 */
async function callModel(state: typeof MessagesAnnotation.State) {
  const model = geminiBase({ model: 'gemini-2.5-flash', streaming: true });
  const modelWithTools = model.bindTools([fetchCatPictureTool]);
  
  const response = await modelWithTools.invoke(state.messages);
  
  return { messages: [response] };
}

/**
 * Routing Function
 * 
 * Determines the next step in the graph:
 * - If the model wants to use a tool -> route to "tools" node
 * - Otherwise -> end the graph execution
 * 
 * This implements the "Acting" part of ReAct - deciding when to take action
 */
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

/**
 * ReAct Agent Graph Construction
 * 
 * Graph flow:
 * 1. Start -> Agent (reasoning)
 * 2. Agent -> Tools (if tool needed) OR End (if done)
 * 3. Tools -> Agent (process tool results)
 * 
 * This creates a loop where the agent can:
 * - Think about what to do
 * - Use tools if needed
 * - Process results and think again
 * - Continue until task is complete
 */
export async function createReActAgent(checkpointer?: any) {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode([fetchCatPictureTool]))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  return workflow.compile(checkpointer ? { checkpointer } : {});
}

export { fetchCatPictureTool, callModel, shouldContinue };

/**
 * Streaming Execution Handler
 * 
 * This function demonstrates real-time streaming with LangGraph's streamEvents API:
 * 
 * 1. Event Types:
 *    - on_chat_model_stream: LLM token generation
 *    - on_tool_start: Tool execution begins
 *    - on_tool_end: Tool execution completes
 * 
 * 2. UI Feedback:
 *    - Live token streaming as the LLM generates
 *    - Animated spinner during tool execution
 *    - Clear status messages for each phase
 * 
 * 3. Session Management:
 *    - thread_id ensures conversation continuity
 *    - Messages accumulate in checkpointer memory
 */
async function runWithStreaming(agent: any, input: HumanMessage, sessionId: string) {
  console.log("\n🤔 Agent thinking...");
  
  // streamEvents provides granular control over output
  const eventStream = agent.streamEvents(
    { messages: [input] },
    { 
      version: "v2",
      configurable: { thread_id: sessionId }  // Links to memory checkpointer
    }
  );
  
  let fullResponse = "";
  let firstChunk = true;
  let spinnerInterval: NodeJS.Timeout | null = null;
  
  // Process events as they arrive
  for await (const event of eventStream) {
    // Handle LLM token streaming
    if (event.event === "on_chat_model_stream") {
      const chunk = event.data?.chunk;
      if (chunk?.content) {
        if (firstChunk) {
          console.log("\n🤖 Assistant: ");
          firstChunk = false;
        }
        process.stdout.write(chunk.content);
        fullResponse += chunk.content;
      }
    }

    // Handle tool execution start
    if (event.event === "on_tool_start" && event.name === "fetch_cat_picture") {
      console.log("\n\n🛠️  Executing tool: " + event.name);
      
      // Start spinner animation for visual feedback
      let i = 0;
      const randomMessage = catMessages[Math.floor(Math.random() * catMessages.length)];
      spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${spinnerFrames[i % spinnerFrames.length]} ${randomMessage}...`);
        i++;
      }, 100);
    }
    
    // Handle tool execution completion
    if (event.event === "on_tool_end" && spinnerInterval) {
      // Clear spinner
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
      
      console.log("✅ Tool execution completed");
      console.log("\n🤔 Agent thinking...");
      firstChunk = true;  // Reset for next LLM response
    }
  }
  
  console.log("\n");
  return fullResponse;
}

/**
 * Interactive CLI Application
 * 
 * This demonstrates how to build a production-ready CLI with:
 * - Readline interface for user input
 * - Session management with unique IDs
 * - Graceful shutdown handling
 * - Persistent memory across interactions
 */
async function main() {
  console.log("=== LangGraphJS ReAct Agent with Memory ===");
  console.log("Interactive cat picture assistant with conversation memory");
  console.log("Type 'exit' or 'quit' to end the conversation\n");
  
  // Memory persistence setup
  const checkpointer = new MemorySaver();
  const agent = await createReActAgent(checkpointer);
  
  // Unique session ID ensures isolated conversation threads
  const sessionId = `session-${Date.now()}`;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });
  
  console.log("🤖 Assistant: Hello! I'm your cat picture assistant. I can fetch random cat pictures from the internet and save them to your Desktop. Just ask me for a cat picture!");
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log("\n👋 Goodbye! Thanks for using the cat picture assistant. May your Desktop be filled with adorable cats!");
      rl.close();
      process.exit(0);
    }
    
    if (userInput) {
      const input = new HumanMessage(userInput);
      // Process with streaming for real-time feedback
      await runWithStreaming(agent, input, sessionId);
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log("\n👋 Session ended.");
    process.exit(0);
  });
}

/**
 * Key Takeaways from this ReAct Agent Example:
 * 
 * 1. REACT PATTERN
 *    - Reasoning: LLM decides what to do based on user input
 *    - Acting: Executes tools when needed
 *    - Loop: Processes results and reasons again until complete
 *    - This creates intelligent, goal-oriented behavior
 * 
 * 2. TOOL INTEGRATION
 *    - Define tools with Zod schemas for type safety
 *    - Tools are async functions that perform real actions
 *    - Bind tools to models with model.bindTools()
 *    - ToolNode handles execution automatically
 * 
 * 3. GRAPH CONSTRUCTION
 *    - Nodes: Discrete processing steps (agent, tools)
 *    - Edges: Define flow between nodes
 *    - Conditional edges: Dynamic routing based on state
 *    - The graph creates a flexible execution pipeline
 * 
 * 4. MEMORY & PERSISTENCE
 *    - MemorySaver provides conversation history
 *    - Thread IDs isolate conversation sessions
 *    - MessagesAnnotation accumulates messages automatically
 *    - State persists across multiple interactions
 * 
 * 5. STREAMING & EVENTS
 *    - streamEvents provides granular output control
 *    - Different event types for different phases
 *    - Real-time token streaming from LLMs
 *    - Visual feedback during long operations
 * 
 * 6. PRODUCTION PATTERNS
 *    - Graceful error handling
 *    - User-friendly CLI with readline
 *    - Clear status messages and feedback
 *    - Session management for multi-turn conversations
 * 
 * Common Use Cases:
 * - Customer service agents
 * - Task automation assistants  
 * - Interactive coding helpers
 * - Research assistants that can fetch data
 * - Any application needing reasoning + action
 * 
 * Next Steps:
 * - Add more tools for extended capabilities
 * - Implement error recovery strategies
 * - Add conversation export/import
 * - Create web interface using same agent
 * - See subgraphs example for multi-agent systems
 */

if (require.main === module) {
  main().catch(console.error);
}
