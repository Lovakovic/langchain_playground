import {geminiBase} from "../../shared/utils/models/vertexai";
import {gptBase} from "../../shared/utils/models/openai";
import {claudeBase} from "../../shared/utils/models/anthropic";
import {HumanMessage} from "@langchain/core/messages";

const gemini  = geminiBase({ streaming: false });
const o4Mini = gptBase({ streaming: false, enableThinking: true });
const claude = claudeBase({ streaming: false, enableThinking: true });

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
