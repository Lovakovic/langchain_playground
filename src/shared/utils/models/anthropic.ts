import dotenv from "dotenv";
import {ChatAnthropic} from "@langchain/anthropic";
import {AnthropicInput} from "@langchain/anthropic/dist/chat_models";

dotenv.config();

interface AnthropicArgs  {
  streaming: boolean;
  enableThinking?: boolean;
}

export const claudeBase = (args: AnthropicArgs): ChatAnthropic => {
  if(!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. "
    );
  }

  const thinkingArgs: AnthropicInput = args.enableThinking ? {
    maxTokens: 4096,
    thinking: {
      type: 'enabled',
      budget_tokens: 1024
    }
  } : {
    temperature: 0.7
  };

  return new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    streaming: args.streaming,
    maxRetries: 2,
    ...thinkingArgs
  })
}
