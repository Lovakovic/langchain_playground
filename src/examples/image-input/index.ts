import * as fs from "node:fs/promises";
import { HumanMessage } from "@langchain/core/messages";
import { geminiBase } from "../../shared/utils/models/vertexai";

const main = async () => {
  // Path to your local image

  const imagePath = "assets/profile.jpg";

  // Read the image file and encode it to base64
  const imageData = await fs.readFile(imagePath);
  const imageBase64 = imageData.toString("base64");

  const model = geminiBase({ streaming: false });

  const message = new HumanMessage({
    content: [
      {
        type: "text",
        text: "What is in this image? Describe it in detail.",
      },
      {
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${imageBase64}`,
        },
      },
    ],
  });

  console.log("Sending message to the model...");
  const response = await model.invoke([message]);

  console.log("\nModel Response:");
  console.log(response);
};

main().catch(console.error);
