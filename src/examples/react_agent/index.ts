import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { geminiBase } from "../../shared/utils/models/vertexai";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch from "node-fetch";

const CatPictureSchema = z.object({
  filename: z.string().optional().describe("Optional filename for the cat picture (without extension)")
});

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const catMessages = [
  "Summoning a feline from the internet void",
  "Convincing a cat to pose for your picture",
  "Opening a can of tuna to attract photogenic cats",
  "Negotiating with the cat overlords",
  "Deploying laser pointer to catch cat's attention",
  "Bribing cats with treats for the perfect shot",
  "Waiting for cat to finish its important nap",
  "Cat is considering your request... maybe"
];


const fetchCatPictureTool = tool(
  async ({ filename }) => {
    // Sleep for 3 seconds to simulate processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const response = await fetch('https://api.thecatapi.com/v1/images/search');
      const data = await response.json();
      const imageUrl = data[0].url;
      
      const imageResponse = await fetch(imageUrl);
      const buffer = await imageResponse.buffer();
      
      const desktopPath = path.join(os.homedir(), 'Desktop');
      const extension = path.extname(new URL(imageUrl).pathname) || '.jpg';
      const finalFilename = filename || `cat_${Date.now()}`;
      const filePath = path.join(desktopPath, `${finalFilename}${extension}`);
      
      fs.writeFileSync(filePath, buffer);
      
      return `Successfully saved a cat picture to your Desktop as ${finalFilename}${extension}! 🐱\nFull path: ${filePath}`;
    } catch (error) {
      return `Failed to fetch cat picture: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: "fetch_cat_picture",
    description: "Fetch a random cat picture from the internet and save it to the user's Desktop",
    schema: CatPictureSchema,
  }
);

async function callModel(state: typeof MessagesAnnotation.State) {
  const model = geminiBase({ model: 'gemini-2.5-flash', streaming: true });
  const modelWithTools = model.bindTools([fetchCatPictureTool]);
  
  const response = await modelWithTools.invoke(state.messages);
  
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

async function createReActAgent() {
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode([fetchCatPictureTool]))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "agent");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

async function runWithStreaming(agent: any, input: HumanMessage, sessionId: string) {
  console.log("\n🤔 Agent thinking...");
  
  const eventStream = agent.streamEvents(
    { messages: [input] },
    { 
      version: "v2",
      configurable: { thread_id: sessionId }
    }
  );
  
  let fullResponse = "";
  let firstChunk = true;
  let spinnerInterval: NodeJS.Timeout | null = null;
  
  for await (const event of eventStream) {
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

    if (event.event === "on_tool_start" && event.name === "fetch_cat_picture") {
      console.log("\n\n🛠️  Executing tool: " + event.name);
      
      // Start spinner animation
      let i = 0;
      const randomMessage = catMessages[Math.floor(Math.random() * catMessages.length)];
      spinnerInterval = setInterval(() => {
        process.stdout.write(`\r${spinnerFrames[i % spinnerFrames.length]} ${randomMessage}...`);
        i++;
      }, 100);
    }
    
    if (event.event === "on_tool_end" && spinnerInterval) {
      // Clear spinner
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
      
      console.log("✅ Tool execution completed");
      console.log("\n🤔 Agent thinking...");
      firstChunk = true;
    }
  }
  
  console.log("\n");
  return fullResponse;
}

async function main() {
  console.log("=== LangGraphJS ReAct Agent with Memory ===");
  console.log("Interactive cat picture assistant with conversation memory");
  console.log("Type 'exit' or 'quit' to end the conversation\n");
  
  const agent = await createReActAgent();
  const sessionId = `session-${Date.now()}`;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });
  
  console.log("🤖 Assistant: Hello! I'm your cat picture assistant. I can fetch random cat pictures from the internet and save them to your Desktop. Just ask me for a cat picture!");
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const userInput = line.trim();
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log("\n👋 Goodbye! Thanks for using the cat picture assistant. May your Desktop be filled with adorable cats!");
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

main().catch(console.error);
