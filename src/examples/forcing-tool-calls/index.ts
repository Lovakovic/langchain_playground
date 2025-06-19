import dotenv from "dotenv";
import {tool} from "@langchain/core/tools";
import { ChatVertexAI } from "@langchain/google-vertexai";
import {HumanMessage, ToolMessage} from "@langchain/core/messages";
import {convertJSONSchemaDraft7ToZod} from "../../shared/utils/json-schema-to-zod/json7ToZodSchema";

dotenv.config();

// 1. Tool creation: Define the multiply tool
const multiply = tool(
  async ({ a, b }: { a: number; b: number }) => {
    console.log(`Using tool: multiply with args: { a: ${a}, b: ${b} }`);
    return a * b;
  },
  {
    name: "multiply",
    description: "Multiply two numbers",
    schema: convertJSONSchemaDraft7ToZod({
      type: 'object',
      properties: {
        a: {
          type: 'number',
          description: 'The first number to multiply',
        },
        b: {
          type: 'number',
          description: 'The second number to multiply',
        },
      },
      required: ["a", "b"],
    }),
  }
);

const main = async () => {
  if(!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
    );
  }

  const gemini = new ChatVertexAI({
    model: "gemini-2.5-pro",
    temperature: 0.7,
    streaming: false,
    maxRetries: 2,
  });

  // Vertex AI only supports "any" tool choice, so if we want to force the model to use a specific tool, we can set tool_choice to 'any' but only bind that one tool.
  const geminiWithForcedTool = gemini.bindTools(
    [multiply],
    { tool_choice: 'any' }
  );

  // OpenAI supports more specific tool choices, so we can bind the tool and specify that it should be used.
  // const gptWithForcedTool = gpt.bindTools(
  //   [multiply],
  //   { tool_choice: { function: { name: 'multiply' }, type: 'function' } }
  // );

  const userInput = "What is 12 multiplied by 7?";
  const humanMessage = new HumanMessage(userInput);
  console.log(`Starting with input: "${userInput}"`);

  // First call to the model
  const firstResponse = await geminiWithForcedTool.invoke([humanMessage]);

  console.log("\nModel response (raw):");
  console.dir(firstResponse, { depth: null });

  if (firstResponse.tool_calls && firstResponse.tool_calls.length > 0) {
    const toolCall = firstResponse.tool_calls[0];
    if (toolCall.name === "multiply") {
      try {
        const toolResult = await multiply.invoke(toolCall.args as { a: number; b: number });

        const toolMessage = new ToolMessage({
          content: toolResult.toString(),
          tool_call_id: toolCall.id ?? "invalid_tool_call_id",
        });

        // Second call to the model, including the tool result
        const finalResponse = await geminiWithForcedTool.invoke([
          humanMessage, // Original user input
          firstResponse, // AI message with the tool call
          toolMessage    // Tool message with the tool result
        ]);

        console.log("\nFinal model response after tool execution:");
        console.log(finalResponse.content);

      } catch (error) {
        console.error(`Error executing tool ${toolCall.name}:`, error);
        console.log("\nFinal result: Error during tool execution.");
      }
    }
  } else {
    console.log("\nFinal model response (no tools called):");
    console.log(firstResponse.content);
  }
};

main().catch(console.error);
