/**
 * LangGraph Subgraphs Example: Cat Fetcher with Gen Z Critic
 * 
 * This example demonstrates advanced LangGraph concepts:
 * - Subgraph composition: Using one graph as a node in another
 * - State sharing: How parent and child graphs share memory
 * - Streaming: Real-time LLM output from nested subgraphs
 * - Conditional routing: Dynamic flow based on agent decisions
 * - Human-in-the-loop: Interrupts for user input
 * 
 * Architecture:
 * 1. Parent Graph orchestrates the flow
 * 2. Cat Agent (subgraph) fetches cat pictures
 * 3. Critique Agent reviews and approves/rejects
 * 4. Human input node for approved images
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { Annotation, interrupt, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { geminiBase } from "../../shared/utils/models/vertexai";
import { createReActAgent } from "../react_agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// Tools for the critique agent
const ApproveImageSchema = z.object({
  reason: z.string().describe("The reason for approving the cat image")
});

const RemoveImageSchema = z.object({
  filepath: z.string().describe("The filepath of the image to remove"),
  reason: z.string().describe("The reason for removing the cat image")
});

const approveImageTool = tool(
  async ({ reason }) => {
    console.log(`\n✅ Image approved! Reason: ${reason}`);
    return "Image approved successfully";
  },
  {
    name: "approve_image",
    description: "Approve the cat image as worthy of keeping",
    schema: ApproveImageSchema,
  }
);

const removeImageTool = tool(
  async ({ filepath, reason }) => {
    console.log(`\n❌ Removing image. Reason: ${reason}`);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        return `Image removed from ${filepath}`;
      } else {
        return `Image file not found at ${filepath}`;
      }
    } catch (error) {
      return `Failed to remove image: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: "remove_image",
    description: "Remove the cat image from the Desktop",
    schema: RemoveImageSchema,
  }
);

/**
 * Parent Graph State Definition
 * 
 * This state is shared across all nodes in the parent graph:
 * - messages: Conversation history (uses same reducer as MessagesAnnotation)
 * - lastCatImagePath: Path to the most recent cat image
 * - critiqueDecision: Result from the critique agent
 * 
 * Note: We use MessagesAnnotation.spec.messages to ensure the same
 * message accumulation behavior as the subgraphs
 */
const ParentStateAnnotation = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  lastCatImagePath: Annotation<string | null>,
  critiqueDecision: Annotation<"approved" | "rejected" | null>,
});

// Critique agent model call
async function callCritiqueModel(state: typeof MessagesAnnotation.State) {
  const model = geminiBase({ model: 'gemini-2.5-flash', streaming: true });
  const modelWithTools = model.bindTools([approveImageTool, removeImageTool]);
  
  const response = await modelWithTools.invoke(state.messages);
  
  return { messages: [response] };
}

function shouldContinueCritique(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

// Create critique agent graph
async function createCritiqueAgent() {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("critique", callCritiqueModel)
    .addNode("tools", new ToolNode([approveImageTool, removeImageTool]))
    .addEdge("__start__", "critique")
    .addConditionalEdges("critique", shouldContinueCritique, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "__end__");

  return workflow.compile();
}


/**
 * Critique Agent Node
 * 
 * This node demonstrates:
 * - Multimodal input (text + image)
 * - Tool-based decision making
 * - State updates based on tool execution
 */
async function critiqueAgentNode(state: typeof ParentStateAnnotation.State) {
  if (!state.lastCatImagePath) {
    return { 
      messages: [new AIMessage("No cat image to critique")],
      critiqueDecision: null as any
    };
  }
  
  const critiqueAgent = await createCritiqueAgent();
  
  // Read the image and create a critique prompt
  const systemPrompt = new HumanMessage({
    content: [
      {
        type: "text",
        text: `You are a Gen Z cat image critic with a fun, supportive personality. Review this cat image in Gen Z style (use slang like "no cap", "slay", "bussin", "fr fr", "it's giving", "lowkey", "highkey", etc.).
        
        Focus on what makes the cat funny, cute, or meme-worthy. Be encouraging but honest!
        
        After your critique, decide whether to approve or remove the image. Approve cats that are:
        - Funny or meme-worthy (weird expressions, silly poses)
        - Super cute or heartwarming
        - Unique or interesting in some way
        
        Only reject if the image is blurry, boring, or the cat isn't visible enough.
        
        The image is at: ${state.lastCatImagePath}`
      },
      {
        type: "image_url",
        image_url: {
          url: `data:image/${path.extname(state.lastCatImagePath).slice(1)};base64,${fs.readFileSync(state.lastCatImagePath).toString('base64')}`
        }
      }
    ]
  });
  
  const result = await critiqueAgent.invoke({
    messages: [systemPrompt]
  });
  
  // Check if image was approved or removed
  let decision: "approved" | "rejected" = "rejected";
  let critiqueMessage = "";
  
  for (const msg of result.messages) {
    if (msg._getType() === "ai" && msg.content && typeof msg.content === "string") {
      critiqueMessage = msg.content;
    }
    if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.name === "approve_image") {
          decision = "approved";
        }
      }
    }
  }
  
  // If rejected, add the critique as feedback
  const feedbackMessages = [...state.messages];
  if (decision === "rejected" && critiqueMessage) {
    feedbackMessages.push(new HumanMessage(`The critic said: "${critiqueMessage}" - Get me a better cat picture!`));
  }
  
  return { 
    messages: decision === "rejected" ? feedbackMessages : result.messages,
    critiqueDecision: decision
  };
}

/**
 * Human Input Node
 * 
 * Uses LangGraph's interrupt feature for human-in-the-loop.
 * This pauses graph execution and waits for user input.
 * 
 * Note: We reset image path and decision to start fresh
 */
async function humanInputNode(state: typeof ParentStateAnnotation.State) {
  const response = await interrupt("The cat image was approved! What would you like to do next?");
  
  return {
    messages: [new HumanMessage(response as string)],
    lastCatImagePath: null,
    critiqueDecision: null
  };
}

/**
 * Routing Functions
 * 
 * These demonstrate conditional edges in LangGraph.
 * Routing decisions are based on state values.
 */

// Route after critique: approved -> human input, rejected -> try again
function routeAfterCritique(state: typeof ParentStateAnnotation.State) {
  if (state.critiqueDecision === "approved") {
    return "human_input";
  } else {
    // Rejected: go back to cat agent for another try
    const lastCritiqueMessage = state.messages[state.messages.length - 1];
    if (lastCritiqueMessage && lastCritiqueMessage.content) {
      return "cat_agent";
    }
  }
  return "__end__";
}

// Route after cat agent: has image -> critique, no image -> human input
function routeAfterCatAgent(state: typeof ParentStateAnnotation.State) {
  if (state.lastCatImagePath) {
    return "critique_agent";
  }
  return "human_input";
}

/**
 * Create Parent Orchestration Graph
 * 
 * This is the main graph that coordinates between:
 * 1. Cat Agent (ReAct subgraph) - fetches cat pictures
 * 2. Path Extractor - finds image paths in messages
 * 3. Critique Agent - reviews cat pictures
 * 4. Human Input - handles approved images
 */
export async function createParentGraph() {
  // Parent graph checkpointer - automatically shared with subgraphs
  const checkpointer = new MemorySaver();
  
  /**
   * IMPORTANT: Subgraph Integration Pattern
   * 
   * We get the compiled ReAct agent and add it directly as a node.
   * This ensures:
   * - The subgraph's events stream to the parent
   * - Memory is shared via the parent's checkpointer
   * - State flows seamlessly between graphs
   */
  const catAgentSubgraph = await createReActAgent();
  
  /**
   * Path Extraction Node
   * 
   * This demonstrates a common pattern: post-processing subgraph output
   * to extract information needed for routing decisions.
   */
  async function extractImagePath(state: typeof ParentStateAnnotation.State) {
    // Extract the last cat image path from messages
    let lastImagePath = null;
    
    // Search messages in reverse order for image paths
    for (const msg of state.messages.slice().reverse()) {
      if (msg.content && typeof msg.content === 'string' && msg.content.includes('Full path:')) {
        const match = msg.content.match(/Full path: (.+\.(?:jpg|jpeg|png|gif|webp))/i);
        if (match) {
          lastImagePath = match[1];
          break;
        }
      } else if (msg.content && typeof msg.content === 'string' && msg.content.includes('saved it to your Desktop as')) {
        // Fallback pattern for different message format
        const match = msg.content.match(/saved it to your Desktop as `(.+\.(?:jpg|jpeg|png|gif|webp))`/i);
        if (match) {
          lastImagePath = path.join(os.homedir(), 'Desktop', match[1]);
          break;
        }
      }
    }
    
    return { 
      lastCatImagePath: lastImagePath
    };
  }
  
  /**
   * Graph Construction
   * 
   * Note the flow:
   * 1. Start -> cat_agent (subgraph)
   * 2. cat_agent -> extract_path (always)
   * 3. extract_path -> critique_agent OR human_input (conditional)
   * 4. critique_agent -> cat_agent OR human_input (conditional)
   * 5. human_input -> cat_agent (always)
   */
  const workflow = new StateGraph(ParentStateAnnotation)
    // Add the compiled subgraph directly as a node
    .addNode("cat_agent", catAgentSubgraph)
    // Post-processing node
    .addNode("extract_path", extractImagePath)
    .addNode("critique_agent", critiqueAgentNode)
    .addNode("human_input", humanInputNode)
    .addEdge("__start__", "cat_agent")
    // Always go to extract_path after cat_agent
    .addEdge("cat_agent", "extract_path")
    // Then route based on whether we found an image
    .addConditionalEdges("extract_path", routeAfterCatAgent, {
      critique_agent: "critique_agent",
      human_input: "human_input"
    })
    .addConditionalEdges("critique_agent", routeAfterCritique, {
      cat_agent: "cat_agent",
      human_input: "human_input",
      __end__: "__end__"
    })
    .addEdge("human_input", "cat_agent");

  return workflow.compile({ checkpointer });
}

// Interactive CLI
async function main() {
  console.log("=== LangGraphJS Subgraphs: Cat Fetcher with Gen Z Critic ===");
  console.log("This demo shows two agents working together:");
  console.log("1. A cat fetching agent that downloads cat pictures");
  console.log("2. A Gen Z critic that reviews them with sass");
  console.log("\nType 'exit' or 'quit' to end the conversation\n");
  
  const parentGraph = await createParentGraph();
  const threadId = `thread-${Date.now()}`;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });
  
  console.log("🤖 Cat Assistant: Yo! I'm your cat pic dealer. Just ask for a cat and my Gen Z bestie will hype it up! Looking for the funniest, most meme-worthy cats out there 🐱✨");
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log("\n👋 Peace out! Hope you got some fire cat pics! ✨");
      rl.close();
      process.exit(0);
    }
    
    if (userInput) {
      try {
        // Pause readline to prevent it from interfering with streaming output
        rl.pause();
        
        /**
         * StreamEvents for Real-time Output
         * 
         * Using streamEvents instead of stream gives us granular control
         * over displaying:
         * - LLM token streaming
         * - Tool execution progress
         * - Subgraph transitions
         * 
         * The thread_id ensures conversation continuity
         */
        const eventStream = await parentGraph.streamEvents(
          { 
            messages: [new HumanMessage(userInput)],
            lastCatImagePath: null,
            critiqueDecision: null
          },
          {
            version: "v2",
            configurable: { thread_id: threadId }
          }
        );
        
        let currentAgent = "";
        let firstChunk = true;
        let spinnerInterval: NodeJS.Timeout | null = null;
        let inSubgraph = false;
        
        for await (const event of eventStream) {
          // Debug log to see all events
          // if (event.event === "on_chat_model_stream") {
          //   console.log(`\n[DEBUG] Event: ${event.event}, Name: ${event.name}, Has content: ${!!event.data?.chunk?.content}`);
          // }
          
          /**
           * Event Processing
           * 
           * We track different events to provide real-time feedback:
           * - on_chain_start: Node execution begins
           * - on_chat_model_stream: LLM generates tokens
           * - on_tool_start/end: Tool execution
           */
          
          // Track which agent is active
          if (event.event === "on_chain_start") {
            if (event.name === "cat_agent") {
              console.log("\n🐱 Cat Agent thinking...");
              currentAgent = "cat";
              firstChunk = true;
              inSubgraph = true;
            } else if (event.name === "critiqueAgentNode") {
              console.log("\n\n🎭 Gen Z Critic analyzing...");
              currentAgent = "critique";
              firstChunk = true;
            }
          } else if (event.event === "on_chain_end" && (event.name === "cat_agent" || event.name === "critiqueAgentNode")) {
            inSubgraph = false;
            console.log("\n");
          }
          
          // Stream the actual LLM output from both parent and subgraphs
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data?.chunk;
            if (chunk?.content) {
              if (firstChunk) {
                if (currentAgent === "cat") {
                  console.log("\n🤖 Cat Agent: ");
                } else if (currentAgent === "critique") {
                  console.log("\n💅 Critic: ");
                }
                firstChunk = false;
              }
              process.stdout.write(chunk.content);
            }
          }
          
          /**
           * Tool Execution Visualization
           * 
           * Shows real-time feedback during tool execution:
           * - Animated spinner for long-running tools
           * - Clear status messages for decisions
           */
          if (event.event === "on_tool_start") {
            if (event.name === "fetch_cat_picture") {
              console.log("\n\n🛠️  Fetching a cat picture...");
              
              // Animated spinner with fun messages
              const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
              const catMessages = [
                "Summoning a feline from the internet void",
                "Convincing a cat to pose for your picture",
                "Opening a can of tuna to attract photogenic cats",
                "Negotiating with the cat overlords",
                "Searching for maximum meme potential",
                "Finding the silliest cat on the internet"
              ];
              let i = 0;
              const randomMessage = catMessages[Math.floor(Math.random() * catMessages.length)];
              spinnerInterval = setInterval(() => {
                process.stdout.write(`\r${spinnerFrames[i % spinnerFrames.length]} ${randomMessage}...`);
                i++;
              }, 100);
            } else if (event.name === "approve_image") {
              console.log("\n\n✅ Image approved! This cat is a vibe ✨");
            } else if (event.name === "remove_image") {
              console.log("\n\n🔄 Let's find a better one...");
            }
          }
          
          // Clear spinner on tool end
          if (event.event === "on_tool_end" && event.name === "fetch_cat_picture" && spinnerInterval) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
            console.log("✅ Cat picture fetched!");
          }
          
          // Handle interrupts
          if (event.event === "on_chain_end" && event.name === "humanInputNode") {
            console.log("\n\n✨ The cat has been approved! What would you like to do next?");
          }
        }
        
        // Resume readline after streaming is complete
        rl.resume();
      } catch (error) {
        rl.resume();
        if (error instanceof Error && error.message.includes("interrupt")) {
          // Handle interrupt for human input
          console.log("\n✨ The cat has been approved! What would you like to do next?");
        } else {
          console.error("\nError:", error);
        }
      }
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log("\n👋 Session ended.");
    process.exit(0);
  });
}

/**
 * Key Takeaways from this Example:
 * 
 * 1. SUBGRAPH INTEGRATION
 *    - Add compiled subgraphs directly as nodes for proper streaming
 *    - Subgraphs automatically inherit parent's checkpointer
 *    - State flows seamlessly between parent and child graphs
 * 
 * 2. STATE MANAGEMENT
 *    - Use shared state annotations (MessagesAnnotation.spec.messages)
 *    - Add custom state fields for routing decisions
 *    - State accumulates across all graph nodes
 * 
 * 3. STREAMING & EVENTS
 *    - streamEvents provides granular control over output
 *    - Handle different event types for rich user feedback
 *    - Subgraph events bubble up to parent automatically
 * 
 * 4. ROUTING PATTERNS
 *    - Use conditional edges with routing functions
 *    - Base routing on state values
 *    - Create loops for retry logic
 * 
 * 5. HUMAN-IN-THE-LOOP
 *    - Use interrupt() for user input
 *    - Pause/resume graph execution naturally
 *    - Maintain context across interruptions
 */

if (require.main === module) {
  main().catch(console.error);
}
