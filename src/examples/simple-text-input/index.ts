import {geminiBase} from "../../shared/utils/models/vertexai";
import {HumanMessage} from "@langchain/core/messages";

const main = async () => {
  const response = await geminiBase({streaming: false}).invoke([
    new HumanMessage({content: 'Hi Gemini! '})
  ])

  console.log(response);
}

main().catch(console.error);
