import { HumanMessage } from "@langchain/core/messages";
import { geminiBase } from "../../shared/utils/models/vertexai";

async function fetchCatImage(): Promise<string> {
  const response = await fetch("https://api.thecatapi.com/v1/images/search");
  const data = await response.json();
  const imageUrl = data[0].url;
  
  // Fetch the actual image data
  const imageResponse = await fetch(imageUrl);
  const arrayBuffer = await imageResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Convert to base64
  return buffer.toString("base64");
}

const NUMBER_OF_IMAGES = 20; // Adjust this constant to test different numbers

async function testGeminiWithMultipleImages() {
  console.log(`Testing Gemini with ${NUMBER_OF_IMAGES} cat images...\n`);
  
  const model = geminiBase({ model: 'gemini-2.5-flash-preview-05-20', streaming: false });
  
  try {
    // Fetch the required number of cat images
    console.log(`Fetching ${NUMBER_OF_IMAGES} cat images from API...`);
    const imagePromises = Array(NUMBER_OF_IMAGES).fill(null).map(() => fetchCatImage());
    const imageBase64Array = await Promise.all(imagePromises);
    console.log(`✓ Successfully fetched ${NUMBER_OF_IMAGES} images\n`);
    
    // Create message content with multiple images
    const content: any[] = [
      { type: "text", text: `Please describe all ${NUMBER_OF_IMAGES} cat images I'm showing you. For each image, provide a numbered description (1, 2, 3, etc.).` }
    ];
    
    // Add all images to the content with text between them
    imageBase64Array.forEach((imageBase64, index) => {
      // Add a text separator before each image (except the first)
      if (index > 0) {
        content.push({
          type: "text",
          text: `\n--- Image ${index + 1} of ${NUMBER_OF_IMAGES} ---\n`
        });
      }
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
      });
    });
    
    // Create the message
    const message = new HumanMessage({ content });
    
    // Send to Gemini
    console.log(`Sending ${NUMBER_OF_IMAGES} images to Gemini...`);
    const startTime = Date.now();
    const response = await model.invoke([message]);
    const endTime = Date.now();
    
    console.log(`✓ Success! Response time: ${(endTime - startTime) / 1000}s`);
    console.log(`Response length: ${response.content.toString().length} characters\n`);
    console.log("=== Gemini's Response ===\n");
    console.log(response.content.toString());
    
  } catch (error: any) {
    console.log(`✗ Failed with ${NUMBER_OF_IMAGES} images!`);
    console.log(`Error: ${error.message}\n`);
    console.log("Full error details:", error);
  }
}

async function main() {
  await testGeminiWithMultipleImages();
}

main().catch(console.error);
