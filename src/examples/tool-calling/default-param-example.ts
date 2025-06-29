import dotenv from "dotenv";
import { tool } from "@langchain/core/tools";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

dotenv.config();

// Define a tool with a default parameter
const createDocument = tool(
  async ({ title, content, metadata }: { title: string; content: string; metadata?: string }) => {
    console.log("Tool called with args:");
    console.log(JSON.stringify({ title, content, metadata }, null, 2));
    return `Document created with title: "${title}", metadata: "${metadata}"`;
  },
  {
    name: "create_document",
    description: "Creates a document with title and content",
    schema: z.object({
      title: z.string().describe("The title of the document"),
      content: z.string().describe("The content of the document"),
      metadata: z.string().default("default-metadata").describe("DO NOT provide this parameter - let it use the default value"),
    }),
  }
);

const main = async () => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
    );
  }

  const model = new ChatVertexAI({
    model: "gemini-2.5-pro",
    temperature: 0.7,
    streaming: false,
    maxRetries: 2,
  });
  const modelWithTools = model.bindTools([createDocument]);

  const userInput = "Create a document with title 'Test Document' and content 'This is a test'. IMPORTANT: Do NOT provide the metadata parameter - let it use its default value.";
  const humanMessage = new HumanMessage(userInput);
  console.log(`User input: "${userInput}"\n`);

  // First call to the model
  const firstResponse = await modelWithTools.invoke([humanMessage]);

  console.log("Model response (raw):");
  console.dir(firstResponse, { depth: null });

  if (firstResponse.tool_calls && firstResponse.tool_calls.length > 0) {
    const toolCall = firstResponse.tool_calls[0];
    console.log("\nTool call args received by the model:");
    console.log(JSON.stringify(toolCall.args, null, 2));
    
    if (toolCall.name === "create_document") {
      try {
        const toolResult = await createDocument.invoke(toolCall.args as any);

        const toolMessage = new ToolMessage({
          content: toolResult.toString(),
          tool_call_id: toolCall.id ?? "invalid_tool_call_id",
        });

        // Second call to the model, including the tool result
        const finalResponse = await modelWithTools.invoke([
          humanMessage,
          firstResponse,
          toolMessage
        ]);

        console.log("\nFinal model response:");
        console.log(finalResponse.content);

      } catch (error) {
        console.error(`Error executing tool ${toolCall.name}:`, error);
      }
    }
  } else {
    console.log("\nNo tools were called");
    console.log(firstResponse.content);
  }
};

main().catch(console.error);