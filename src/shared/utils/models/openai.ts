import dotenv from "dotenv";
import {ChatOpenAI} from "@langchain/openai";

dotenv.config();

interface GeminiArgs  {
  streaming: boolean;
}

export const gptBase = (args: GeminiArgs): ChatOpenAI => {
  if(!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. "
    );
  }

  return new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.7,
    streaming: args.streaming,
    maxRetries: 2,
  })
}
