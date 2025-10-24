import * as fs from "node:fs/promises";
import dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

// Create a simple tool for testing
const imageAnalysisTool = new DynamicStructuredTool({
  name: "analyze_image",
  description: "Analyze and describe the contents of an image",
  schema: z.object({
    description: z.string().describe("Detailed description of the image"),
    mainElements: z.array(z.string()).describe("List of main elements in the image"),
    colors: z.array(z.string()).describe("Dominant colors in the image"),
    mood: z.string().optional().describe("Overall mood or feeling of the image"),
  }),
  func: async (input) => {
    return JSON.stringify({
      success: true,
      analysis: input,
    });
  },
});

const main = async () => {
  // Path to your local image
  const imagePath = "assets/profile.jpg";

  // Read the image file and encode it to base64
  const imageData = await fs.readFile(imagePath);
  const imageBase64 = imageData.toString("base64");

  const message = new HumanMessage({
    content: [
      {
        type: "text",
        text: "Analyze this image and provide a structured analysis using the analyze_image tool.",
      },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${imageBase64}`,
        },
      },
    ],
  });

  // Test with Gemini
  console.log("=== GEMINI MODEL WITH TOOL ===");
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

  const geminiWithTool = gemini.bindTools([imageAnalysisTool], {
    tool_choice: "any",
  });
  console.log("Sending message to Gemini with tool...");
  const geminiResponse = await geminiWithTool.invoke([message]);
  
  console.log("\nGemini Full Response:");
  console.log(geminiResponse);
  
  // Test with OpenAI
  console.log("\n\n=== OPENAI MODEL WITH TOOL ===");
  
  if(!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. "
    );
  }

  const openai = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.7,
    streaming: false,
    maxRetries: 2,
  });

  const openaiWithTool = openai.bindTools([imageAnalysisTool], {
    tool_choice: "any",
  });
  console.log("Sending message to OpenAI with tool...");
  const openaiResponse = await openaiWithTool.invoke([message]);
  
  console.log("\nOpenAI Full Response:");
  console.log(openaiResponse);
};

main().catch(console.error);
