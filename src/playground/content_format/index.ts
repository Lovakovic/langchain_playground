import dotenv from "dotenv";
import {HumanMessage} from "@langchain/core/messages";
import {ChatVertexAI} from "@langchain/google-vertexai";
import {ChatOpenAI} from "@langchain/openai";
import {ChatAnthropic} from "@langchain/anthropic";

dotenv.config();

if(!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
    "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file."
  );
}

if(!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable is not set. "
  );
}

if(!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY environment variable is not set. "
  );
}

const gemini = new ChatVertexAI({
  model: "gemini-2.5-pro",
  temperature: 0.7,
  streaming: false,
  maxRetries: 2,
});

const o4Mini = new ChatOpenAI({
  model: 'o4-mini',
  reasoning: {
    effort: "high",
  },
  streaming: false,
  maxRetries: 2,
});

const claude = new ChatAnthropic({
  model: "claude-sonnet-4-20250514",
  streaming: false,
  maxRetries: 2,
  maxTokens: 4096,
  thinking: {
    type: 'enabled',
    budget_tokens: 1024
  }
});

const main = async () => {
  const message = new HumanMessage({ content: 'Hi there!' });

  const [geminiResponse, o4MiniResponse, claudeResponse] = await Promise.all([
    gemini.invoke([message]),
    o4Mini.invoke([message]),
    claude.invoke([message]),
  ]);

  console.log('Gemini Response:', geminiResponse);
  console.log('O4 Mini Response:', o4MiniResponse);
  console.log('Claude Response:', claudeResponse);
};

main().catch(console.error);
