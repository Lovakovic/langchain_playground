/**
 * LangGraph ReAct Agent with Cross-Thread Memory Example
 * 
 * This example demonstrates how to build a ReAct (Reasoning + Acting) agent that maintains
 * persistent memory across different conversation threads using LangGraph's Store API.
 * 
 * Key LangGraph Concepts Demonstrated:
 * 
 * 1. DUAL MEMORY ARCHITECTURE:
 *    - Short-term memory: Conversation history via MemorySaver (thread-specific)
 *    - Long-term memory: User profile via InMemoryStore (cross-thread)
 * 
 * 2. STORE API:
 *    - InMemoryStore: Development store that persists data across threads
 *    - Namespace-based organization: ["users", userId, "profile"]
 *    - Compatible with production stores (PostgreSQL, Redis)
 * 
 * 3. REACT PATTERN:
 *    - Agent reasons about when to use tools
 *    - Executes save_user_info tool when detecting new information
 *    - Maintains natural conversation flow
 * 
 * 4. STREAMING EVENTS:
 *    - Real-time token streaming (on_chat_model_stream)
 *    - Tool execution tracking (on_tool_start/end)
 *    - Memory save indicators (💾)
 * 
 * Architecture Flow:
 * 1. User message → Agent node (with memory context)
 * 2. Agent decides to use tool → Tools node
 * 3. Tool saves to store → Back to agent
 * 4. Agent continues response → End
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import {
  InMemoryStore,
  LangGraphRunnableConfig,
  MemorySaver,
  MessagesAnnotation,
  StateGraph
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import dotenv from "dotenv";
import { ChatVertexAI } from "@langchain/google-vertexai";
import * as readline from "readline";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

/**
 * User Profile Schema
 * 
 * This interface defines what we store in cross-thread memory.
 * The data persists across all conversation threads for a given user.
 * In production, this would typically be stored in a database.
 */
interface UserProfile {
  name?: string;
  occupation?: string;
  notes: string[];
  preferences: Record<string, any>;
  lastUpdated: string;
}

/**
 * Memory Management Tool
 * 
 * In LangGraph, tools are functions that agents can invoke to perform actions.
 * This tool demonstrates how to access the Store API through the config parameter.
 * 
 * Key points:
 * - Tools receive LangGraphRunnableConfig which contains the store
 * - The store is automatically injected by the graph compilation
 * - Tools can access both thread_id (for conversation) and custom config (userId)
 */
const saveUserInfoSchema = z.object({
  infoType: z.enum(["name", "occupation", "note", "preference"]).describe("Type of information to save"),
  value: z.string().describe("The value to save"),
  preferenceKey: z.string().optional().describe("Key for preference (only used when infoType is 'preference')")
});

const saveUserInfoTool = tool(
  async ({ infoType, value, preferenceKey }, config: LangGraphRunnableConfig) => {
    const store = config.store;
    if (!store) {
      return "Error: Memory store not available";
    }

    const userId = config.configurable?.userId;
    if (!userId) {
      return "Error: User ID not configured";
    }

    const namespace = ["users", userId];
    
    // Get current profile
    const currentProfileData = await store.get(namespace, "profile");
    const currentProfile: UserProfile = (currentProfileData?.value as UserProfile) || {
      name: undefined,
      occupation: undefined,
      notes: [],
      preferences: {},
      lastUpdated: new Date().toISOString()
    };

    // Update profile based on info type
    switch (infoType) {
      case "name":
        currentProfile.name = value;
        break;
      case "occupation":
        currentProfile.occupation = value;
        break;
      case "note":
        if (!currentProfile.notes.includes(value)) {
          currentProfile.notes.push(value);
        }
        break;
      case "preference":
        if (preferenceKey) {
          currentProfile.preferences[preferenceKey] = value;
        }
        break;
    }

    currentProfile.lastUpdated = new Date().toISOString();

    // Save updated profile
    await store.put(namespace, "profile", currentProfile);

    return `Successfully saved ${infoType}: ${value}`;
  },
  {
    name: "save_user_info",
    description: "Save information about the user to persistent memory (name, occupation, notes, or preferences)",
    schema: saveUserInfoSchema
  }
);


/**
 * Model Node with Memory Context
 * 
 * This is the main agent node in our ReAct pattern. In LangGraph:
 * - Nodes are async functions that receive state and config
 * - They return partial state updates (not the full state)
 * - The config parameter provides access to checkpointer, store, and custom values
 * 
 * This node demonstrates:
 * 1. Accessing cross-thread memory via config.store
 * 2. Building dynamic system prompts with user context
 * 3. Binding tools to the model for ReAct capabilities
 */
async function callModelWithMemory(
  state: typeof MessagesAnnotation.State,
  config: LangGraphRunnableConfig
) {
  const store = config.store;
  const userId = config.configurable?.userId;
  
  // Initialize system prompt
  let systemPrompt = "You are a helpful assistant with memory capabilities. ";
  
  if (store && userId) {
    // Retrieve user profile
    const namespace = ["users", userId];
    const profileData = await store.get(namespace, "profile");
    
    if (profileData?.value) {
      const profile = profileData.value as UserProfile;
      
      // Add personalized context
      systemPrompt += "\n\nHere's what you know about the user:";
      if (profile.name) systemPrompt += `\n- Their name is ${profile.name}`;
      if (profile.occupation) systemPrompt += `\n- They work as ${profile.occupation}`;
      if (profile.notes.length > 0) {
        systemPrompt += "\n- Additional information:";
        profile.notes.forEach(note => {
          systemPrompt += `\n  • ${note}`;
        });
      }
      if (Object.keys(profile.preferences).length > 0) {
        systemPrompt += "\n- Their preferences:";
        Object.entries(profile.preferences).forEach(([key, value]) => {
          systemPrompt += `\n  • ${key}: ${value}`;
        });
      }
    }
  }
  
  systemPrompt += "\n\nYou have access to a tool to save user information. " +
    "When users share personal information (name, occupation, preferences, or other details), " +
    "use the save_user_info tool to remember it for future conversations. " +
    "Use natural conversation - don't explicitly mention that you're saving information unless asked.";

  if(!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
    );
  }

  const model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.7,
    streaming: true,
    maxRetries: 2,
  });
  const modelWithTools = model.bindTools([saveUserInfoTool]);
  
  // Add system message at the beginning
  const messagesWithSystem = [
    { role: "system", content: systemPrompt },
    ...state.messages
  ];
  
  const response = await modelWithTools.invoke(messagesWithSystem);
  
  return { messages: [response] };
}


/**
 * Routing Function for Conditional Edges
 * 
 * In LangGraph, conditional edges allow dynamic routing based on state.
 * This function implements the ReAct pattern's decision logic:
 * - If the agent wants to use a tool → route to "tools" node
 * - Otherwise → end the graph execution
 * 
 * The routing happens AFTER the agent node processes the message,
 * enabling the ReAct loop: Think → Act (if needed) → Observe → Think again
 */
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

/**
 * Graph Construction: ReAct Agent with Dual Memory
 * 
 * This function builds the LangGraph workflow with:
 * 
 * 1. STATE: MessagesAnnotation provides built-in message accumulation
 * 
 * 2. NODES:
 *    - "agent": Main reasoning node that processes messages
 *    - "tools": ToolNode automatically executes tool calls
 * 
 * 3. EDGES:
 *    - __start__ → agent: Always begin with reasoning
 *    - agent → tools/end: Conditional based on tool calls
 *    - tools → agent: Always return to agent after tool execution
 * 
 * 4. COMPILATION:
 *    - checkpointer: MemorySaver for conversation history (short-term)
 *    - store: InMemoryStore for user profile (long-term)
 * 
 * The compiled graph automatically injects both memory systems into
 * the config parameter that's passed to all nodes and tools.
 */
export async function createMemoryAgent(store: InMemoryStore) {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModelWithMemory)
    .addNode("tools", new ToolNode([saveUserInfoTool]))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  // Compile with both checkpointer (for conversation history) and store (for cross-thread memory)
  return workflow.compile({ 
    checkpointer: new MemorySaver(),
    store: store 
  });
}

/**
 * Streaming Handler with Memory Save Indicators
 * 
 * LangGraph's streamEvents API provides granular control over execution.
 * This handler demonstrates how to process different event types:
 * 
 * Event Types:
 * - on_chat_model_stream: LLM generating tokens in real-time
 * - on_tool_start: Tool execution beginning (we track save_user_info)
 * - on_tool_end: Tool execution completed
 * - on_chain_end: Node execution completed (we check "agent" node)
 * 
 * The 💾 indicator appears when the agent successfully saves to memory,
 * providing visual feedback without interrupting the conversation flow.
 */
async function runWithStreaming(
  agent: any,
  input: HumanMessage,
  config: { configurable: { thread_id: string; userId: string } }
) {
  console.log("\n🤔 Thinking...");
  
  const eventStream = agent.streamEvents(
    { messages: [input] },
    {
      version: "v2",
      ...config
    }
  );
  
  let fullResponse = "";
  let firstChunk = true;
  let memorySaved = false;
  let toolCallHappened = false;
  
  for await (const event of eventStream) {
    // Debug to see what events we're getting
    // console.log(`\n[DEBUG] Event: ${event.event}, Name: ${event.name}, Metadata: ${JSON.stringify(event.metadata)}`);
    
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
    
    // Handle tool execution - specifically memory saves
    if (event.event === "on_tool_start") {
      if (event.name === "save_user_info") {
        toolCallHappened = true;
        memorySaved = true;
      }
    }
    
    // When the chain ends, check if we saved memory
    if (event.event === "on_chain_end" && event.name === "agent") {
      if (memorySaved && !firstChunk) {
        process.stdout.write(" 💾");
      }
    }
  }
  
  console.log("\n");
  return { response: fullResponse, memorySaved };
}

/**
 * Interactive CLI Application
 * 
 * This main function demonstrates the complete cross-thread memory system:
 * 
 * 1. STORE INITIALIZATION: Creates InMemoryStore that persists across threads
 * 
 * 2. USER IDENTITY: Generates a userId that links all conversations
 * 
 * 3. SESSION MANAGEMENT: Multiple conversation threads (each with unique thread_id)
 * 
 * 4. CONFIGURATION: Each invoke includes:
 *    - thread_id: Links to conversation history (MemorySaver)
 *    - userId: Links to user profile (InMemoryStore)
 * 
 * The magic happens in the dual configuration - the same userId across
 * different thread_ids enables memory persistence across conversations.
 */
async function main() {
  console.log("=== LangGraph ReAct Agent with Cross-Thread Memory ===");
  console.log("This agent remembers information about you across different conversations!");
  console.log("When you see 💾 after a response, it means the agent saved information to memory.");
  console.log("\nCommands:");
  console.log("- /new_session - Start a new conversation thread");
  console.log("- /list_sessions - Show all your conversation threads");
  console.log("- /switch <number> - Switch to a different thread");
  console.log("- /memory - Show what the agent remembers about you");
  console.log("- /exit or /quit - End the program\n");

  // Create persistent store for cross-thread memory
  const store = new InMemoryStore();
  const agent = await createMemoryAgent(store);

  // User management
  const userId = `user-${uuidv4()}`;
  console.log(`Your user ID: ${userId}`);
  console.log("(In production, this would be tied to authentication)\n");

  // Session management
  const sessions: { id: string; name: string; created: Date }[] = [];
  let currentSessionIndex = 0;

  // Create initial session
  sessions.push({
    id: `session-${uuidv4()}`,
    name: "Session 1",
    created: new Date()
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n💬 [${sessions[currentSessionIndex].name}] You: `
  });

  console.log("🤖 Assistant: Hello! I'm your personal assistant with persistent memory. I can remember information about you across all our conversations. Feel free to tell me about yourself!");

  rl.prompt();

  rl.on('line', async (line) => {
    const userInput = line.trim();

    // Handle commands
    if (userInput.toLowerCase() === '/exit' || userInput.toLowerCase() === '/quit') {
      console.log("\n👋 Goodbye! I'll remember everything for next time!");
      rl.close();
      process.exit(0);
    }

    if (userInput.toLowerCase() === '/new_session') {
      const sessionNum = sessions.length + 1;
      sessions.push({
        id: `session-${uuidv4()}`,
        name: `Session ${sessionNum}`,
        created: new Date()
      });
      currentSessionIndex = sessions.length - 1;
      console.log(`\n✨ Started new session: ${sessions[currentSessionIndex].name}`);
      console.log("🤖 Assistant: I'm ready for our new conversation! I still remember everything about you from before.");
      rl.setPrompt(`\n💬 [${sessions[currentSessionIndex].name}] You: `);
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase() === '/list_sessions') {
      console.log("\n📋 Your conversation threads:");
      sessions.forEach((session, index) => {
        const current = index === currentSessionIndex ? " (current)" : "";
        console.log(`  ${index + 1}. ${session.name} - Started ${session.created.toLocaleString()}${current}`);
      });
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase().startsWith('/switch ')) {
      const sessionNum = parseInt(userInput.substring(8)) - 1;
      if (sessionNum >= 0 && sessionNum < sessions.length) {
        currentSessionIndex = sessionNum;
        console.log(`\n🔄 Switched to ${sessions[currentSessionIndex].name}`);
        rl.setPrompt(`\n💬 [${sessions[currentSessionIndex].name}] You: `);
      } else {
        console.log("\n❌ Invalid session number");
      }
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase() === '/memory') {
      const namespace = ["users", userId];
      const profileData = await store.get(namespace, "profile");
      
      if (!profileData?.value) {
        console.log("\n📭 No information stored yet. Tell me about yourself!");
      } else {
        const profile = profileData.value as UserProfile;
        console.log("\n🧠 Stored Memory:");
        if (profile.name) console.log(`  • Name: ${profile.name}`);
        if (profile.occupation) console.log(`  • Occupation: ${profile.occupation}`);
        if (profile.notes.length > 0) {
          console.log("  • Notes:");
          profile.notes.forEach(note => console.log(`    - ${note}`));
        }
        if (Object.keys(profile.preferences).length > 0) {
          console.log("  • Preferences:");
          Object.entries(profile.preferences).forEach(([key, value]) => {
            console.log(`    - ${key}: ${value}`);
          });
        }
      }
      rl.prompt();
      return;
    }

    if (userInput) {
      const input = new HumanMessage(userInput);
      
      // Run with both thread_id (for conversation history) and userId (for cross-thread memory)
      const config = {
        configurable: {
          thread_id: sessions[currentSessionIndex].id,
          userId: userId
        }
      };

      try {
        await runWithStreaming(agent, input, config);
      } catch (error) {
        console.error("\n❌ Error:", error);
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
 * Key LangGraph Concepts Demonstrated:
 * 
 * 1. DUAL MEMORY ARCHITECTURE
 *    - MemorySaver (Checkpointer): Thread-specific conversation history
 *    - InMemoryStore (Store API): Cross-thread user profiles
 *    - Both injected via graph.compile({ checkpointer, store })
 * 
 * 2. STORE API PATTERNS
 *    - Namespace design: ["users", userId, "profile"]
 *    - get/put operations for reading/writing data
 *    - BaseStore interface compatible with production stores
 * 
 * 3. REACT AGENT PATTERN
 *    - Agent node: Reasoning with memory context
 *    - Conditional edges: Dynamic routing based on tool calls
 *    - Tool node: Automatic tool execution
 *    - Cycles: Agent → Tools → Agent for multi-step reasoning
 * 
 * 4. CONFIGURATION FLOW
 *    - config.configurable.thread_id → Links to checkpointer
 *    - config.configurable.userId → Custom value for store access
 *    - config.store → Injected by graph compilation
 *    - Tools and nodes receive full config automatically
 * 
 * 5. STREAMING EVENTS API
 *    - streamEvents for granular execution tracking
 *    - Event types for different execution phases
 *    - Real-time UI updates without blocking
 * 
 * 6. GRAPH COMPILATION
 *    - StateGraph defines structure
 *    - MessagesAnnotation provides message accumulation
 *    - compile() creates executable graph with injected dependencies
 * 
 * Production Considerations:
 * - Replace InMemoryStore with PostgreSQL/Redis stores
 * - Use PostgresSaver or SqliteSaver for checkpointing
 * - Implement proper user authentication
 * - Consider memory size limits and TTLs
 * - Add monitoring for memory operations
 * 
 * Next Steps:
 * - See official docs for production store implementations
 * - Explore subgraphs for multi-agent memory sharing
 * - Consider vector stores for semantic memory search
 */

if (require.main === module) {
  main().catch(console.error);
}
