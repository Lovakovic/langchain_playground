import dotenv from "dotenv";
import { z } from "zod";
import { ChatVertexAI } from "@langchain/google-vertexai";

dotenv.config();

// Define the schema for a movie review
const MovieReviewSchema = z.object({
  title: z.string().describe("The title of the movie"),
  rating: z.number().min(1).max(10).describe("Rating from 1-10"),
  genre: z.array(z.string()).describe("List of genres for the movie"),
  summary: z.string().describe("Brief summary of the movie"),
  pros: z.array(z.string()).describe("Positive aspects of the movie"),
  cons: z.array(z.string()).describe("Negative aspects of the movie"),
  recommendation: z.boolean().describe("Whether you recommend this movie"),
});

type MovieReview = z.infer<typeof MovieReviewSchema>;

async function main() {
  // Initialize model
  const model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.7,
    streaming: false,
  });

  // Create model with structured output
  const modelWithStructure = model.withStructuredOutput(MovieReviewSchema);

  const prompt = `Review the movie "The Matrix" (1999) and provide a structured analysis.`;

  console.log("Requesting structured movie review...\n");

  try {
    // Get structured response
    const review = await modelWithStructure.invoke(prompt) as MovieReview;

    console.log(JSON.stringify(review, null, 2));

  } catch (error) {
    console.error("Error getting structured output:", error);
  }
}

main().catch(console.error);
