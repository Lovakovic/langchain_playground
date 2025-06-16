import {geminiBase} from "../../shared/utils/models/vertexai";
import {HumanMessage} from "@langchain/core/messages";
import {gptBase} from "../../shared/utils/models/openai";

const main = async () => {
  const response = await gptBase({ enableThinking: true, streaming: false, model: 'o3'}).invoke([
    new HumanMessage({content: 'Hi Gemini! '})
  ])

  console.log(response);
}

main().catch(console.error);
