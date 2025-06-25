/**
 * Runtime Configurable Data Example
 *
 * This example demonstrates how to pass runtime-only, non-serializable data
 * to LangGraph nodes using the config object. This is the proper way to inject
 * dependencies like database clients, API providers, or other resources that:
 *
 * 1. Should NOT be part of the graph's serializable state
 * 2. Need to be accessed by nodes during execution
 * 3. May change between different execution environments
 *
 * KEY PATTERN: Runtime dependencies go in config.configurable field, which
 * is automatically passed through the entire execution chain.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { RunnableConfig } from "@langchain/core/runnables";
import dotenv from "dotenv";
import * as readline from "readline";
import * as crypto from "crypto";

dotenv.config();

/**
 * RUNTIME PROVIDERS - Non-serializable objects
 *
 * These represent external services that:
 * - Cannot/should not be serialized into the graph state
 * - May have different implementations in different environments
 * - Contain credentials or connections that shouldn't be persisted
 */

// Simulated database provider with connection state
class DatabaseProvider {
  private connectionId: string;
  private userData: Map<string, any>;

  constructor() {
    // This represents a real DB connection that can't be serialized
    this.connectionId = crypto.randomBytes(8).toString('hex');
    this.userData = new Map([
      ["user-123", { name: "Alice Johnson", tier: "premium", credits: 150 }],
      ["user-456", { name: "Bob Smith", tier: "basic", credits: 50 }],
      ["user-789", { name: "Carol White", tier: "premium", credits: 200 }]
    ]);
    console.log(`🗄️  Database provider initialized with connection: ${this.connectionId}`);
  }

  async getUserData(userId: string) {
    // Simulate async DB query
    await new Promise(resolve => setTimeout(resolve, 100));
    return this.userData.get(userId) || { name: "Unknown User", tier: "basic", credits: 0 };
  }

  async updateCredits(userId: string, amount: number) {
    const user = await this.getUserData(userId);
    user.credits += amount;
    this.userData.set(userId, user);
    return user;
  }

  // This method shows why we can't serialize - it has active connections
  getConnectionInfo() {
    return `DB Connection ${this.connectionId} (non-serializable)`;
  }
}

// External API client with authentication
class ExternalAPIClient {
  private apiKey: string;
  private requestCount: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    console.log(`🌐 API client initialized with key: ${apiKey.substring(0, 8)}...`);
  }

  async checkQuota(userId: string) {
    this.requestCount++;
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 200));

    // Mock quota check based on user
    const quotas: { [key: string]: { used: number; limit: number } } = {
      "user-123": { used: 45, limit: 100 },
      "user-456": { used: 20, limit: 50 },
      "user-789": { used: 10, limit: 100 }
    };

    return quotas[userId] || { used: 0, limit: 50 };
  }

  getRequestCount() {
    return this.requestCount;
  }
}

/**
 * Define the shape of our configurable runtime dependencies
 * These will go inside the `configurable` field of RunnableConfig
 */
interface RuntimeDependencies {
  // Our custom runtime dependencies
  databaseProvider?: DatabaseProvider;
  apiClient?: ExternalAPIClient;
  userId?: string;

  // Standard LangGraph configurable fields
  thread_id?: string;
  checkpoint_id?: string;

  // Allow other fields
  [key: string]: any;
}

/**
 * Tool Definitions with Runtime Dependencies
 * Tools access dependencies from config.configurable field
 */

const UserInfoSchema = z.object({
  userId: z.string().describe("The user ID to look up")
});

// This tool will access the database provider from config.configurable
const getUserInfoTool = tool(
  async ({ userId }, config?: RunnableConfig<RuntimeDependencies>) => {
    // Access the database provider from config.configurable
    const dbProvider = config?.configurable?.databaseProvider;
    if (!dbProvider) {
      return "Error: Database provider not available. This indicates the runtime config was not properly passed to the tool.";
    }

    const userData = await dbProvider.getUserData(userId);
    const connectionInfo = dbProvider.getConnectionInfo();

    return `User Information:
- Name: ${userData.name}
- Tier: ${userData.tier}
- Credits: ${userData.credits}
- Retrieved via: ${connectionInfo}`;
  },
  {
    name: "get_user_info",
    description: "Get information about a user from the database",
    schema: UserInfoSchema,
  }
);

const QuotaCheckSchema = z.object({
  userId: z.string().describe("The user ID to check quota for")
});

// This tool will access the API client from config.configurable
const checkQuotaTool = tool(
  async ({ userId }, config?: RunnableConfig<RuntimeDependencies>) => {
    // Access the API client from config.configurable
    const apiClient = config?.configurable?.apiClient;
    if (!apiClient) {
      return "Error: API client not available. This indicates the runtime config was not properly passed to the tool.";
    }

    const quota = await apiClient.checkQuota(userId);
    const requestCount = apiClient.getRequestCount();

    return `Quota Status:
- Used: ${quota.used}/${quota.limit}
- Remaining: ${quota.limit - quota.used}
- API request count this session: ${requestCount}`;
  },
  {
    name: "check_quota",
    description: "Check API quota usage for a user",
    schema: QuotaCheckSchema,
  }
);

/**
 * Model Node with Config Access
 *
 * Using standard RunnableConfig with typed configurable field
 */
async function callModel(
  state: typeof MessagesAnnotation.State,
  config: RunnableConfig<RuntimeDependencies>
) {
  // We can access our providers here if needed
  const dbProvider = config?.configurable?.databaseProvider;
  const currentUserId = config?.configurable?.userId;

  // Log that we have access to the providers
  if (dbProvider && currentUserId) {
    console.log(`\n📊 Model node has access to DB provider for user: ${currentUserId}`);
  }

  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    streaming: true,
  });

  // Bind tools - they'll also receive the config when invoked
  const modelWithTools = model.bindTools([getUserInfoTool, checkQuotaTool]);

  // The config is automatically passed down to tool calls!
  const response = await modelWithTools.invoke(state.messages, config);

  return { messages: [response] };
}

/**
 * Routing function also receives config
 */
function shouldContinue(
  state: typeof MessagesAnnotation.State,
  config: RunnableConfig<RuntimeDependencies>
) {
  const lastMessage = state.messages[state.messages.length - 1];

  if ("tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0) {
    // Only log routing decisions when actually routing to tools
    if (config?.configurable?.userId) {
      console.log(`\n🔀 Routing to tools for user: ${config.configurable.userId}`);
    }
    return "tools";
  }

  return "end";
}

/**
 * Create the agent graph
 * 
 * The standard ToolNode automatically preserves the configurable field
 * when passing config to tools, so no custom implementation needed!
 */
async function createConfigurableAgent(checkpointer: any) {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode([getUserInfoTool, checkQuotaTool]))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  // Compile with the provided checkpointer
  return workflow.compile({ checkpointer });
}

/**
 * Stream execution with runtime config
 */
async function runWithConfig(
  agent: any,
  input: HumanMessage,
  config: RunnableConfig<RuntimeDependencies>
) {
  console.log("\n🤔 Agent thinking...");

  // Pass our config with dependencies in configurable
  const eventStream = agent.streamEvents(
    { messages: [input] },
    {
      ...config,
      version: "v2"
    }
  );

  let fullResponse = "";
  let firstChunk = true;

  for await (const event of eventStream) {
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
      console.log(`\n\n🛠️  Using tool: ${event.name}`);
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
 * Main application demonstrating runtime configuration
 */
async function main() {
  console.log("=== Runtime Configurable Data Example ===");
  console.log("Demonstrating non-serializable dependency injection\n");

  // Initialize our runtime-only providers
  const databaseProvider = new DatabaseProvider();
  const apiClient = new ExternalAPIClient("sk-demo-api-key-12345");

  console.log("\n✅ Providers initialized (these won't be serialized!)\n");

  // Create a persistent checkpointer for memory across runs
  const checkpointer = new MemorySaver();

  // Create the agent with the checkpointer
  const agent = await createConfigurableAgent(checkpointer);

  // Simulate different users
  const users = ["user-123", "user-456", "user-789"];
  let currentUserIndex = 0;

  console.log("Available commands:");
  console.log("- Ask about user info or quota");
  console.log("- Type 'switch' to switch users");
  console.log("- Type 'exit' to quit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });

  console.log(`🤖 Assistant: Hello! I'm connected to your database and API services.`);
  console.log(`Currently serving: ${users[currentUserIndex]}`);
  console.log(`I can check user information and API quotas. What would you like to know?`);

  rl.prompt();

  rl.on('line', async (line) => {
    const userInput = line.trim();

    if (userInput.toLowerCase() === 'exit') {
      console.log("\n👋 Goodbye!");
      rl.close();
      process.exit(0);
    }

    if (userInput.toLowerCase() === 'switch') {
      currentUserIndex = (currentUserIndex + 1) % users.length;
      console.log(`\n🔄 Switched to user: ${users[currentUserIndex]}`);
      rl.prompt();
      return;
    }

    if (userInput) {
      const currentUserId = users[currentUserIndex];
      const input = new HumanMessage(userInput);

      // Create config with runtime providers in the configurable field
      const config: RunnableConfig<RuntimeDependencies> = {
        configurable: {
          thread_id: `session-${currentUserId}`, // Stable thread per user
          userId: currentUserId,
          // Pass our non-serializable providers in configurable!
          databaseProvider: databaseProvider,
          apiClient: apiClient
        }
      };

      await runWithConfig(agent, input, config);
    }

    rl.prompt();
  });
}

/**
 * KEY TAKEAWAYS:
 *
 * 1. USE CONFIGURABLE FIELD
 *    - Put all runtime dependencies in config.configurable
 *    - Don't extend RunnableConfig with top-level properties
 *    - Standard ToolNode will preserve configurable field
 *
 * 2. TYPE SAFETY
 *    - Use RunnableConfig<T> where T defines your configurable shape
 *    - Access dependencies via config?.configurable?.property
 *    - Always check for existence before using
 *
 * 3. AUTOMATIC PROPAGATION
 *    - Config with configurable flows through entire execution
 *    - Tools receive the same config as nodes
 *    - No need for custom ToolNode implementation
 *
 * 4. USE CASES
 *    - Database connections
 *    - API clients with auth
 *    - File system access
 *    - Caching layers
 *    - Any non-serializable dependency
 *
 * 5. BEST PRACTICES
 *    - Always validate dependencies exist before use
 *    - Use typed interfaces for configurable
 *    - Keep state minimal and serializable
 *    - Put runtime deps in configurable, not state
 *
 * 6. SECOND PARAMETER PATTERN
 *    - Every node function accepts (state, config) parameters
 *    - This is how nodes access runtime dependencies
 *    - Config parameter is optional but recommended for flexibility
 */

if (require.main === module) {
  main().catch(console.error);
}
