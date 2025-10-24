/**
 * LangGraph Tool Error Handling Example
 * 
 * This example demonstrates how to handle tool validation errors in a ReAct agent.
 * The agent can recover from invalid tool inputs by receiving error messages and
 * correcting its approach.
 * 
 * Key concepts:
 * - Tool input validation with programmatic error throwing
 * - ToolNode with handleToolErrors: true for automatic error handling
 * - LLM error recovery through error message feedback
 * - Password validation as a common failure scenario
 * 
 * The tool validates passwords and LLMs often provide weak passwords that
 * fail security requirements, making this an ideal demonstration scenario.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { MemorySaver, MessagesAnnotation, StateGraph, CompiledStateGraph, StateDefinition } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import dotenv from "dotenv";
import { ChatVertexAI } from "@langchain/google-vertexai";
import * as readline from "readline";
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

dotenv.config();

/**
 * Password validation schema using Zod
 * This only validates basic structure - the tool will do more detailed validation
 */
const PasswordValidatorSchema = z.object({
  password: z.string().describe("Password to validate against security requirements"),
  username: z.string().optional().describe("Optional username to check for password similarity")
});

/**
 * Password Validation Tool
 * 
 * This tool demonstrates input validation that can fail and provide feedback.
 * LLMs often make mistakes with password requirements because they:
 * - Don't understand complex password policies
 * - Suggest passwords that are too simple
 * - Use common patterns that fail validation
 * - Don't consider character requirements properly
 * 
 * The tool validates passwords against strict security requirements and throws
 * descriptive errors that help the LLM understand what went wrong.
 */
const passwordValidatorTool = tool(
  async ({ password, username }) => {
    console.log(`🔐 Validating password with ${password.length} characters${username ? ` for user: ${username}` : ''}`);
    
    // Basic validation
    if (!password || typeof password !== 'string') {
      throw new Error("Password must be a non-empty string. Please provide a valid password.");
    }
    
    const errors = [];
    
    // Length requirements
    if (password.length < 12) {
      errors.push(`Password is too short (${password.length} characters). Minimum length is 12 characters.`);
    }
    
    if (password.length > 128) {
      errors.push(`Password is too long (${password.length} characters). Maximum length is 128 characters.`);
    }
    
    // Character requirements
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter (a-z).");
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter (A-Z).");
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number (0-9).");
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
      errors.push("Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;':\",./<>?~`).");
    }
    
    // Common weak patterns
    const commonPatterns = [
      /(.)\1{2,}/,  // Repeated characters (aaa, 111, etc.)
      /123|abc|qwe/i,  // Sequential patterns
      /password|admin|user|test|guest/i,  // Common words
      /^[a-zA-Z]+$|^[0-9]+$|^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]+$/  // Single character type
    ];
    
    if (commonPatterns.some(pattern => pattern.test(password))) {
      errors.push("Password contains common weak patterns. Avoid repeated characters, sequential patterns, or common words.");
    }
    
    // Username similarity check
    if (username && password.toLowerCase().includes(username.toLowerCase())) {
      errors.push(`Password cannot contain the username "${username}". Please choose a different password.`);
    }
    
    // Dictionary words check (simplified)
    const commonWords = ['password', 'admin', 'user', 'test', 'guest', 'login', 'welcome', 'hello', 'world', 'company', 'secure'];
    const passwordLower = password.toLowerCase();
    const foundWords = commonWords.filter(word => passwordLower.includes(word));
    if (foundWords.length > 0) {
      errors.push(`Password contains common dictionary words: ${foundWords.join(', ')}. Avoid using common words.`);
    }
    
    // If there are errors, throw them
    if (errors.length > 0) {
      const errorMessage = `Password validation failed:\n${errors.map(error => `- ${error}`).join('\n')}\n\nPlease create a new password that meets all requirements.`;
      throw new Error(errorMessage);
    }
    
    // If we get here, the password passed all validation
    const strength = calculatePasswordStrength(password);
    return `✅ Password is valid and ${strength}! It meets all security requirements:\n- Length: ${password.length} characters (12+ required)\n- Contains uppercase, lowercase, numbers, and special characters\n- No common weak patterns detected\n- ${username ? `Does not contain username "${username}"` : 'No username conflicts'}`;
  },
  {
    name: "password_validator",
    description: "Validate passwords against strict security requirements. Always try to validate any password provided, even if it seems obviously weak - the tool will provide detailed feedback on what needs to be improved.",
    schema: PasswordValidatorSchema,
  }
);

/**
 * Helper function to calculate password strength
 */
function calculatePasswordStrength(password: string): string {
  let score = 0;
  
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) score += 1;
  if (password.length >= 20) score += 1;
  
  if (score >= 6) return "very strong";
  if (score >= 5) return "strong";
  if (score >= 4) return "good";
  return "weak";
}

/**
 * Model Node
 * 
 * The LLM with tool capabilities. When it receives error messages from tools,
 * it can reason about what went wrong and try again with corrected input.
 */
async function callModel(state: typeof MessagesAnnotation.State) {
  if(!process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
    );
  }

  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    streaming: true,
    maxRetries: 2,
  });
  const modelWithTools = model.bindTools([passwordValidatorTool]);
  
  const response = await modelWithTools.invoke(state.messages);
  
  return { messages: [response] };
}

/**
 * Routing Function
 * 
 * Determines whether to continue to tools or end the conversation.
 */
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage && "tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

/**
 * ReAct Agent Graph with Error Handling
 * 
 * Key difference from basic ReAct agent: ToolNode has handleToolErrors: true
 * 
 * handleToolErrors: true (default) means:
 * - When a tool throws an error, the ToolNode catches it
 * - Creates a ToolMessage with the error message as content
 * - Continues the graph execution instead of crashing
 * - The LLM receives the error message and can reason about how to fix it
 * 
 * handleToolErrors: false would mean:
 * - Tool errors would crash the entire graph execution
 * - No opportunity for the LLM to recover from validation errors
 */
export type ErrorHandlingAgentGraph = CompiledStateGraph<
  typeof MessagesAnnotation.State,
  { messages?: BaseMessage[] | BaseMessage | BaseMessageLike | BaseMessageLike[] },
  "agent" | "tools" | "__start__",
  typeof MessagesAnnotation.spec,
  typeof MessagesAnnotation.spec,
  StateDefinition
>;

export async function createErrorHandlingAgent(checkpointer?: BaseCheckpointSaver): Promise<ErrorHandlingAgentGraph> {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    // IMPORTANT: handleToolErrors: true allows the agent to recover from tool validation errors
    // This is actually the default behavior, but we're being explicit here for demonstration
    // When true: Tool errors become ToolMessages that the LLM can reason about
    // When false: Tool errors would crash the entire graph execution
    .addNode("tools", new ToolNode([passwordValidatorTool], { handleToolErrors: true }))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  return workflow.compile(checkpointer ? { checkpointer } : {});
}

export { passwordValidatorTool, callModel, shouldContinue };

/**
 * Streaming Execution with Error Handling Visualization
 * 
 * This function shows how tool errors are handled in the streaming flow.
 * When a tool error occurs, you'll see:
 * 1. Tool execution starts
 * 2. Tool error message appears
 * 3. LLM receives the error and reasons about how to fix it
 * 4. LLM potentially tries again with corrected input
 */
async function runWithStreaming(agent: ErrorHandlingAgentGraph, input: HumanMessage, sessionId: string) {
  console.log("\n🤔 Agent analyzing your request...");
  
  const eventStream = agent.streamEvents(
    { messages: [input] },
    { 
      version: "v2",
      configurable: { thread_id: sessionId }
    }
  );
  
  let fullResponse = "";
  let firstChunk = true;
  let toolErrorOccurred = false;
  
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
    if (event.event === "on_tool_start" && event.name === "password_validator") {
      console.log("\n\n🛠️  Executing password validation...");
      console.log(`🔐 Input: ${JSON.stringify(event.data.input)}`);
    }
    
    // Handle tool execution completion
    if (event.event === "on_tool_end" && event.name === "password_validator") {
      console.log("✅ Tool execution completed");
      
      // Check if there was an error in the tool output
      const output = event.data.output;
      if (output && typeof output === 'string' && output.includes('Error:')) {
        toolErrorOccurred = true;
        console.log("❌ Tool validation error occurred - agent will try to correct it");
      }
      
      console.log("\n🤔 Agent processing results...");
      firstChunk = true;
    }
  }
  
  if (toolErrorOccurred) {
    console.log("\n💡 Notice: The agent successfully recovered from a validation error!");
  }
  
  console.log("\n");
  return fullResponse;
}

/**
 * Interactive CLI Application
 * 
 * Test scenarios to try:
 * 1. "Check if MySecureP@ssw0rd2024 is secure" (should work)
 * 2. "Validate the password test" (should fail - too short, missing requirements)
 * 3. "Is password123 secure?" (should fail - common word, missing requirements)
 * 4. "Check admin for user admin" (should fail - contains username, too short)
 * 5. "Validate 12345678" (should fail - only numbers, too short)
 */
async function main() {
  console.log("=== LangGraph Tool Error Handling Example ===");
  console.log("Password validation agent with automatic error recovery");
  console.log("Try asking to validate weak passwords to see error handling in action!");
  console.log("Examples:");
  console.log("- 'Check if password123 is secure' (invalid - too weak)");
  console.log("- 'Validate the password \"test\"' (invalid - too short, no requirements)");
  console.log("- 'Is \"admin123\" a good password?' (invalid - common word, too short)");
  console.log("- 'Check password \"MySecureP@ssw0rd2024\"' (should be valid)");
  console.log("Type 'exit' or 'quit' to end\n");
  
  const checkpointer = new MemorySaver();
  const agent = await createErrorHandlingAgent(checkpointer);
  const sessionId = `session-${Date.now()}`;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });
  
  console.log("🤖 Assistant: Hello! I'm a password security assistant. I can validate passwords against strict security requirements and help you understand what makes a password strong. What password would you like me to check?");
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log("\n👋 Goodbye! Thanks for testing password validation and error handling!");
      rl.close();
      process.exit(0);
    }
    
    if (userInput) {
      const input = new HumanMessage(userInput);
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
 * Key Takeaways from this Error Handling Example:
 * 
 * 1. TOOL ERROR HANDLING
 *    - Tools can throw errors for invalid input validation
 *    - Errors should be descriptive and actionable
 *    - ToolNode with handleToolErrors: true catches errors gracefully
 *    - Error messages become ToolMessages that the LLM can reason about
 * 
 * 2. LLM ERROR RECOVERY
 *    - LLMs can understand error messages and correct their approach
 *    - Detailed error messages help the LLM understand what went wrong
 *    - The ReAct loop allows multiple attempts until success
 *    - Conversation memory helps track the correction process
 * 
 * 3. VALIDATION STRATEGIES
 *    - Programmatic validation catches common input errors
 *    - Error messages should explain what's wrong and how to fix it
 *    - Consider common LLM mistakes when designing validation
 *    - Provide specific examples of correct input formats
 * 
 * 4. PRODUCTION CONSIDERATIONS
 *    - Always use handleToolErrors: true for user-facing agents
 *    - Log tool errors for debugging and improvement
 *    - Consider rate limiting for tools that could be expensive
 *    - Implement timeout handling for long-running validations
 * 
 * Common Use Cases:
 * - Password security assistants
 * - Form validation assistants
 * - Data cleanup and formatting tools
 * - API input validation
 * - Configuration file validation
 * - User input sanitization
 * 
 * Advanced Extensions:
 * - Add retry limits to prevent infinite correction loops
 * - Implement progressive validation (basic → detailed)
 * - Add suggestion tools that propose corrections
 * - Create validation rule configurability
 * - Implement batch validation for multiple inputs
 */

if (require.main === module) {
  main().catch(console.error);
}