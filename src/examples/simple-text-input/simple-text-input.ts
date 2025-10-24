import dotenv from "dotenv";
import {HumanMessage} from "@langchain/core/messages";
import {ChatOpenAI} from "@langchain/openai";

dotenv.config();

const main = async () => {
  if(!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. "
    );
  }

  const model = new ChatOpenAI({
    model: 'o3',
    reasoning: {
      effort: "high",
    },
    streaming: false,
    maxRetries: 2,
  });

  const response = await model.invoke([
    new HumanMessage({content: 'Hi Gemini! '})
  ])

  console.log(response);
}

main().catch(console.error);
