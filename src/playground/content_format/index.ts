import dotenv from 'dotenv';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

dotenv.config();

if (!process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
  throw new Error(
    'GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. ' +
      "Gemini agent cannot be initialized. Ensure it's set to the path of your service account key file.",
  );
}

if (!process.env['OPENAI_API_KEY']) {
  throw new Error('OPENAI_API_KEY environment variable is not set. ');
}

if (!process.env['ANTHROPIC_API_KEY']) {
  throw new Error('ANTHROPIC_API_KEY environment variable is not set. ');
}

const gemini = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0.7,
  streaming: false,
  maxRetries: 2,
});

const gpt5 = new ChatOpenAI({
  model: 'gpt-5',
  streaming: false,
  maxRetries: 2,
});

const claude = new ChatAnthropic({
  model: 'claude-sonnet-4-20250514',
  streaming: false,
  maxRetries: 2,
  maxTokens: 4096,
  thinking: {
    type: 'enabled',
    budget_tokens: 1024,
  },
});

const main = async () => {
  const systemMessage = new SystemMessage({
    content:
      'Repeat back all numbers from human messages in the order you encounter them. No explanation.',
  });

  const models = [
    { name: 'GPT-5', model: gpt5 },
    { name: 'Gemini', model: gemini },
    { name: 'Claude', model: claude },
  ];

  // Test 1: Single message with multiple text contents
  const multiContentMessage = new HumanMessage({
    content: [
      { type: 'text', text: '1' },
      { type: 'text', text: '2' },
      { type: 'text', text: '3' },
      { type: 'text', text: '4' },
      { type: 'text', text: '5' },
    ],
  });

  // Test 2: Individual human messages
  const individualMessages = [
    systemMessage,
    new HumanMessage({ content: '1' }),
    new HumanMessage({ content: '2' }),
    new HumanMessage({ content: '3' }),
    new HumanMessage({ content: '4' }),
    new HumanMessage({ content: '5' }),
  ];

  for (const { name, model } of models) {
    console.log(`\n=== ${name.toUpperCase()} RESULTS ===`);

    console.log('TEST 1: Single message with multiple text contents');
    try {
      const response1 = await model.invoke([systemMessage, multiContentMessage]);
      console.log(`${name} Response 1:`, response1.content);
    } catch (error: any) {
      console.log(`${name} Error 1:`, error.message);
    }

    console.log(`\nTEST 2: Individual human messages`);
    try {
      const response2 = await model.invoke(individualMessages);
      console.log(`${name} Response 2:`, response2.content);
    } catch (error: any) {
      console.log(`${name} Error 2:`, error.message);
    }
  }
};

main().catch(console.error);
