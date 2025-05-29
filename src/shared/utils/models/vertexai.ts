import dotenv from "dotenv";
import {ChatVertexAI} from "@langchain/google-vertexai";

dotenv.config();

interface GeminiArgs  {
  streaming: boolean;
}

export const geminiBase = (args: GeminiArgs): ChatVertexAI => {
  if(!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
    );
  }

  return new ChatVertexAI({
    model: "gemini-2.5-flash-preview-04-17", // Updated model
    temperature: 0.7,
    streaming: args.streaming,
    maxRetries: 2,
  })
}
