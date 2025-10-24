/**
 * Configuration Correction Loop Example
 * 
 * LLM creates web server config, multiple validators report errors to shared ErrorManager,
 * graph loops until all errors resolved.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { MessagesAnnotation, StateGraph, Annotation } from "@langchain/langgraph";
import { BaseCheckpointSaver, MemorySaver } from "@langchain/langgraph-checkpoint";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { RunnableConfig } from "@langchain/core/runnables";
import * as dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

// Error tracking
interface ValidationError {
  id: string;
  category: "security" | "syntax" | "performance" | "compliance";
  severity: "high" | "medium" | "low";
  message: string;
  field?: string;
}

class ErrorManager {
  private errors: Map<string, ValidationError> = new Map();

  addError(error: ValidationError) {
    this.errors.set(error.id, error);
  }

  removeError(id: string) {
    this.errors.delete(id);
  }

  getErrors(): ValidationError[] {
    return Array.from(this.errors.values());
  }

  hasErrors(): boolean {
    return this.errors.size > 0;
  }

  getErrorsByCategory(category: ValidationError["category"]): ValidationError[] {
    return this.getErrors().filter(e => e.category === category);
  }

  clear() {
    this.errors.clear();
  }

  getSummary(): string {
    if (!this.hasErrors()) return "✅ No validation errors";
    
    const byCategory = this.getErrors().reduce((acc, error) => {
      acc[error.category] = (acc[error.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return `❌ ${this.errors.size} errors: ${Object.entries(byCategory).map(([cat, count]) => `${cat}(${count})`).join(', ')}`;
  }
}

// State includes current config
const ConfigState = Annotation.Root({
  ...MessagesAnnotation.spec,
  currentConfig: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => ""
  }),
  iterationCount: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => 0
  }),
  validationsCompleted: Annotation<string[]>({
    reducer: (x, y) => y ?? x,
    default: () => []
  })
});

interface RuntimeDeps {
  errorManager?: ErrorManager;
  thread_id?: string;
}

// Tools
const createConfigSchema = z.object({
  requirements: z.string().describe("Requirements for the web server configuration")
});

const createConfigTool = tool(
  async ({ requirements }, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    // Reset state for new session
    configState.securityFixed = false;
    configState.performanceFixed = false;
    configState.complianceFixed = false;
    errorManager.clear();

    const newConfig = `# Web Server Configuration
server:
  port: 8080
  host: 0.0.0.0
  timeout: 30s
  
security:
  ssl_enabled: false
  cors_enabled: true
  cors_origins: ["*"]
  auth_required: false
  
performance:
  max_connections: 1000
  worker_processes: 1
  keep_alive: 30s
  
logging:
  level: debug
  file: /var/log/server.log
  
database:
  host: localhost
  port: 5432
  username: admin
  password: password123
  ssl_mode: disable`;

    return `Created initial configuration based on: ${requirements}\n\n${newConfig}`;
  },
  {
    name: "create_config",
    description: "Create initial web server configuration based on requirements",
    schema: createConfigSchema
  }
);

const updateConfigSchema = z.object({
  updates: z.string().describe("Configuration updates to fix validation errors")
});

// Track what's been fixed
const configState = {
  securityFixed: false,
  performanceFixed: false,
  complianceFixed: false
};

const updateConfigTool = tool(
  async ({ updates }, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    // Track what was fixed and clear those errors
    if (updates.toLowerCase().includes("ssl") || updates.toLowerCase().includes("security")) {
      configState.securityFixed = true;
      errorManager.removeError("sec-001");
      errorManager.removeError("sec-002");
      errorManager.removeError("sec-003");
    }
    
    if (updates.toLowerCase().includes("worker") || updates.toLowerCase().includes("performance")) {
      configState.performanceFixed = true;
      errorManager.removeError("perf-001");
      errorManager.removeError("perf-002");
    }
    
    if (updates.toLowerCase().includes("password") || updates.toLowerCase().includes("compliance") || updates.toLowerCase().includes("logging")) {
      configState.complianceFixed = true;
      errorManager.removeError("comp-001");
      errorManager.removeError("comp-002");
    }

    const _updatedConfig = `# Updated Web Server Configuration
server:
  port: 8443
  host: 127.0.0.1
  timeout: 60s
  
security:
  ssl_enabled: true
  ssl_cert: /etc/ssl/server.crt
  ssl_key: /etc/ssl/server.key
  cors_enabled: true
  cors_origins: ["https://example.com", "https://app.example.com"]
  auth_required: true
  auth_method: jwt
  
performance:
  max_connections: 500
  worker_processes: 4
  keep_alive: 65s
  connection_timeout: 30s
  
logging:
  level: info
  file: /var/log/server.log
  rotate_daily: true
  
database:
  host: db.internal
  port: 5432
  username: app_user
  password: "{{DB_PASSWORD}}"
  ssl_mode: require
  connection_pool: 20`;

    const fixedCategories = [];
    if (updates.toLowerCase().includes("security")) fixedCategories.push("security");
    if (updates.toLowerCase().includes("performance")) fixedCategories.push("performance");
    if (updates.toLowerCase().includes("compliance")) fixedCategories.push("compliance");

    return `✅ Applied updates: ${updates}\n\nConfiguration updated successfully. Fixed: ${fixedCategories.join(", ") || "general improvements"}`;
  },
  {
    name: "update_config",
    description: "Update configuration to fix validation errors. Mention which categories you're fixing (security/performance/compliance).",
    schema: updateConfigSchema
  }
);

// Validation tools - check actual config state
const securityValidateTool = tool(
  async ({}, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    // Only add errors if security hasn't been fixed yet
    if (!configState.securityFixed) {
      if (!errorManager.getErrors().find(e => e.id === "sec-001")) {
        errorManager.addError({
          id: "sec-001",
          category: "security",
          severity: "high", 
          message: "SSL is disabled - must enable HTTPS for production",
          field: "security.ssl_enabled"
        });
      }
      
      if (!errorManager.getErrors().find(e => e.id === "sec-002")) {
        errorManager.addError({
          id: "sec-002", 
          category: "security",
          severity: "high",
          message: "CORS allows all origins (*) - specify exact domains",
          field: "security.cors_origins"
        });
      }

      if (!errorManager.getErrors().find(e => e.id === "sec-003")) {
        errorManager.addError({
          id: "sec-003",
          category: "security", 
          severity: "medium",
          message: "Authentication is disabled - enable auth for production",
          field: "security.auth_required"
        });
      }
    }

    const securityErrors = errorManager.getErrorsByCategory("security");
    return configState.securityFixed 
      ? `🔒 Security validation passed - all issues resolved!`
      : `🔒 Security validation found ${securityErrors.length} issues: ${securityErrors.map(e => e.message).join("; ")}`;
  },
  {
    name: "validate_security",
    description: "Validate configuration for security compliance",
    schema: z.object({})
  }
);

const performanceValidateTool = tool(
  async ({}, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    if (!configState.performanceFixed) {
      if (!errorManager.getErrors().find(e => e.id === "perf-001")) {
        errorManager.addError({
          id: "perf-001",
          category: "performance",
          severity: "medium",
          message: "Only 1 worker process - increase for better performance",
          field: "performance.worker_processes"
        });
      }

      if (!errorManager.getErrors().find(e => e.id === "perf-002")) {
        errorManager.addError({
          id: "perf-002", 
          category: "performance",
          severity: "low",
          message: "Keep-alive timeout too low - increase for efficiency",
          field: "performance.keep_alive"
        });
      }
    }

    const perfErrors = errorManager.getErrorsByCategory("performance");
    return configState.performanceFixed
      ? `⚡ Performance validation passed - all issues resolved!`
      : `⚡ Performance validation found ${perfErrors.length} issues: ${perfErrors.map(e => e.message).join("; ")}`;
  },
  {
    name: "validate_performance",
    description: "Validate configuration for performance optimization",
    schema: z.object({})
  }
);

const complianceValidateTool = tool(
  async ({}, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    if (!configState.complianceFixed) {
      if (!errorManager.getErrors().find(e => e.id === "comp-001")) {
        errorManager.addError({
          id: "comp-001",
          category: "compliance", 
          severity: "medium",
          message: "Database password in plaintext - use environment variable",
          field: "database.password"
        });
      }

      if (!errorManager.getErrors().find(e => e.id === "comp-002")) {
        errorManager.addError({
          id: "comp-002",
          category: "compliance",
          severity: "low", 
          message: "Logging level is debug - use info/warn for production",
          field: "logging.level"
        });
      }
    }

    const compErrors = errorManager.getErrorsByCategory("compliance");
    return configState.complianceFixed
      ? `📋 Compliance validation passed - all issues resolved!`
      : `📋 Compliance validation found ${compErrors.length} issues: ${compErrors.map(e => e.message).join("; ")}`;
  },
  {
    name: "validate_compliance",
    description: "Validate configuration for compliance requirements",
    schema: z.object({})
  }
);

const finalSummaryTool = tool(
  async ({}, config?: RunnableConfig<RuntimeDeps>) => {
    const errorManager = config?.configurable?.errorManager;
    if (!errorManager) throw new Error("ErrorManager not available");

    return `🎉 **Configuration Complete!**

Your production e-commerce web server configuration has been successfully created and validated:

**Security ✅**
- SSL/HTTPS enabled with certificates
- CORS configured for specific domains only
- JWT authentication required

**Performance ✅** 
- Multiple worker processes (4) for scalability
- Optimized connection timeouts and keep-alive settings
- Connection pooling configured

**Compliance ✅**
- Database password secured via environment variables
- Production-appropriate logging level (info)
- Daily log rotation enabled

The configuration is now ready for production deployment. All security, performance, and compliance requirements have been met.`;
  },
  {
    name: "final_summary",
    description: "Provide a final summary when all validations have passed",
    schema: z.object({})
  }
);

// Model node
async function callModel(
  state: typeof ConfigState.State,
  config: RunnableConfig<RuntimeDeps>
) {
  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.3,
    streaming: true,
  });

  const tools = [createConfigTool, updateConfigTool, securityValidateTool, performanceValidateTool, complianceValidateTool, finalSummaryTool];
  const modelWithTools = model.bindTools(tools);

  const response = await modelWithTools.invoke(state.messages, config);
  
  return { 
    messages: [response],
    iterationCount: state.iterationCount + 1
  };
}

// Routing function
function shouldContinue(
  state: typeof ConfigState.State,
  config: RunnableConfig<RuntimeDeps>
) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }

  // Safety check - max iterations
  if (state.iterationCount >= 15) {
    console.log("\n⚠️  Max iterations reached - ending loop");
    return "end";
  }

  // Check if we have errors - if so, continue the loop
  const errorManager = config?.configurable?.errorManager;
  if (errorManager?.hasErrors()) {
    console.log(`\n🔄 Iteration ${state.iterationCount} - ${errorManager.getSummary()}`);
    return "validate_and_fix";
  }

  console.log("\n✅ All validations passed - ending loop");
  return "end";
}

// Validation orchestrator node
async function validateAndFix(
  state: typeof ConfigState.State, 
  config: RunnableConfig<RuntimeDeps>
) {
  const errorManager = config?.configurable?.errorManager;
  if (!errorManager) throw new Error("ErrorManager not available");

  let summary = `\n🔍 Validation Round ${state.iterationCount}\n`;
  summary += `Current status: ${errorManager.getSummary()}\n`;
  
  if (errorManager.hasErrors()) {
    summary += "\nRemaining errors:\n";
    errorManager.getErrors().forEach(error => {
      summary += `- ${error.category.toUpperCase()}: ${error.message}\n`;
    });
    summary += "\nPlease fix these issues by updating the configuration.";
  } else {
    summary += "\n✅ All validations have passed! Please provide a final summary of the completed configuration.";
  }

  const message = new HumanMessage(summary);
  return { messages: [message] };
}

// Create graph
async function createCorrectionLoopAgent(checkpointer: BaseCheckpointSaver) {
  const workflow = new StateGraph(ConfigState)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode([createConfigTool, updateConfigTool, securityValidateTool, performanceValidateTool, complianceValidateTool, finalSummaryTool]))
    .addNode("validate_and_fix", validateAndFix)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      validate_and_fix: "validate_and_fix", 
      end: "__end__"
    })
    .addEdge("tools", "agent")
    .addEdge("validate_and_fix", "agent");

  return workflow.compile({ checkpointer });
}

// Execution
async function runCorrectionLoop(
  agent: any,
  input: HumanMessage,
  config: RunnableConfig<RuntimeDeps>
) {
  console.log("\n🚀 Starting correction loop...");

  const eventStream = agent.streamEvents(
    { messages: [input] },
    { ...config, version: "v2", recursionLimit: 50 }
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
      console.log(`\n🛠️  Using: ${event.name}`);
    }

    if (event.event === "on_tool_end") {
      firstChunk = true;
    }
  }

  console.log("\n");
  return fullResponse;
}

// Main
async function main() {
  console.log("=== Configuration Correction Loop ===");
  console.log("LLM creates config → validators find errors → LLM fixes → repeat until clean\n");

  const errorManager = new ErrorManager();
  const checkpointer = new MemorySaver();
  const agent = await createCorrectionLoopAgent(checkpointer);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });

  console.log("🤖 Tell me what kind of web server configuration you need, and I'll create and validate it!");
  rl.prompt();

  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit') {
      console.log("\n👋 Goodbye!");
      rl.close();
      process.exit(0);
    }

    if (userInput) {
      const input = new HumanMessage(userInput);
      const config: RunnableConfig<RuntimeDeps> = {
        configurable: {
          thread_id: `session-${Date.now()}`,
          errorManager: errorManager
        }
      };

      await runCorrectionLoop(agent, input, config);
    }

    rl.prompt();
  });
}

if (require.main === module) {
  main().catch(console.error);
}
