import dotenv from "dotenv";
import {ChatOpenAI} from "@langchain/openai";
import {ChatOpenAIFields} from "@langchain/openai/dist/chat_models";

dotenv.config();

interface OpenAIArgs  {
  streaming: boolean;
  enableThinking?: boolean;
  model?: string;
}

export const gptBase = (args: OpenAIArgs): ChatOpenAI => {
  if(!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. "
    );
  }

  const thinkingArgs: ChatOpenAIFields = args.enableThinking ? {
    model: args.model ?? 'o4-mini',
    reasoning: {
      effort: "high",
    }
  } : {
    model: args.model ?? "gpt-4o",
    temperature: 0.7,
  };

  return new ChatOpenAI({
    ...thinkingArgs,
    streaming: args.streaming,
    maxRetries: 2,
  })
}
