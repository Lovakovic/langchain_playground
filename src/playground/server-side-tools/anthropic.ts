/**
 * Anthropic Server-Side Web Search Tool Example
 *
 * This example demonstrates how to use Anthropic's built-in web search tool
 * with LangChain JS. The web search is executed server-side by Anthropic,
 * and the results (including citations) are returned in the model's response.
 *
 * Requirements:
 * - ANTHROPIC_API_KEY environment variable must be set
 * - A Claude model that supports web search (e.g., claude-3-5-sonnet-20241022)
 *
 * Run: npx ts-node src/playground/server-side-tools/anthropic.ts
 */

import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessageChunk } from "@langchain/core/dist/messages/index.js";
import * as dotenv from "dotenv";
import { inspect } from "util";

// Load environment variables
dotenv.config();

/**
 * Type definitions for Anthropic's response structure
 */
interface AnthropicContentBlock {
  type: string;
  text?: string;
  content?: AnthropicContentItem[];
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  citations?: Citation[];
}

interface AnthropicContentItem {
  type: string;
  text?: string;
}

interface Citation {
  source?: string;
  url?: string;
  title?: string;
}

interface AnthropicAdditionalKwargs {
  content?: AnthropicContentBlock[];
  [key: string]: unknown;
}

/**
 * Type guard to check if a value is an AnthropicContentBlock
 */
function isAnthropicContentBlock(value: unknown): value is AnthropicContentBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as AnthropicContentBlock).type === "string"
  );
}

/**
 * Type guard to check if a value is an AnthropicContentItem
 */
function isAnthropicContentItem(value: unknown): value is AnthropicContentItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as AnthropicContentItem).type === "string"
  );
}

/**
 * Extract and format citations from the response
 */
function extractCitations(response: AIMessageChunk): string[] {
  const citations: string[] = [];

  const additionalKwargs = response.additional_kwargs as AnthropicAdditionalKwargs;

  // Check if there are any tool-related blocks in additional_kwargs
  if (additionalKwargs?.content && Array.isArray(additionalKwargs.content)) {
    for (const block of additionalKwargs.content) {
      if (!isAnthropicContentBlock(block)) continue;

      // Look for tool_result blocks that contain search results
      if (block.type === "tool_result" && block.content && Array.isArray(block.content)) {
        for (const contentItem of block.content) {
          if (!isAnthropicContentItem(contentItem)) continue;

          if (contentItem.type === "text" && contentItem.text) {
            // Parse citations from the text if they're embedded
            const citationMatches = contentItem.text.match(/\[(\d+)\]\s*(https?:\/\/[^\s]+)/g);
            if (citationMatches) {
              citations.push(...citationMatches);
            }
          }
        }
      }
    }
  }

  return citations;
}

/**
 * Main example: Search for latest news on today's date
 */
async function searchLatestNews() {
  console.log("🔍 Anthropic Server-Side Web Search Example\n");
  console.log("=" .repeat(60));

  // Get today's date for the query
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  console.log(`📅 Today's Date: ${dateStr}\n`);

  // Initialize ChatAnthropic with a web-search capable model
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-5-20250929", // Claude Sonnet 4.5 with web search support
    temperature: 0,
    // Note: Depending on the API status, you might need to add beta headers
    // clientOptions: {
    //   defaultHeaders: {
    //     "anthropic-beta": "web-search-2025-03-05"
    //   }
    // }
  });

  // Define Anthropic's server-side web search tool
  // This tool is executed by Anthropic's servers, not locally
  const tools = [
    {
      type: "web_search_20250305" as const,
      name: "web_search",
      max_uses: 5, // Limit the number of searches the model can make
    },
  ];

  // Bind the web search tool to the model
  const llmWithSearch = llm.bindTools(tools);

  console.log("🤖 Querying Claude with web search enabled...\n");

  try {
    // Example 1: Latest technology news
    console.log("📰 Example 1: Latest Technology News\n");
    console.log("-".repeat(60));

    const techResponse = await llmWithSearch.invoke([
      {
        role: "user",
        content: `What are the top technology news stories from today (${dateStr})? Please provide specific headlines and cite your sources.`,
      },
    ]);

    console.log("Response:");
    console.log(inspect(techResponse.content, { depth: null, colors: true }));
    console.log("\n");

    // Extract citations if available
    const techCitations = extractCitations(techResponse);
    if (techCitations.length > 0) {
      console.log("📚 Citations:");
      techCitations.forEach((citation, idx) => {
        console.log(`  ${idx + 1}. ${citation}`);
      });
    }

    console.log("\n" + "=".repeat(60) + "\n");

    // Example 2: Specific topic search
    console.log("📰 Example 2: AI/ML Recent Developments\n");
    console.log("-".repeat(60));

    const aiResponse = await llmWithSearch.invoke([
      {
        role: "user",
        content: `What are the latest developments in artificial intelligence and machine learning this week? Include specific companies, products, or research. Cite all sources.`,
      },
    ]);

    console.log("Response:");
    console.log(inspect(aiResponse.content, { depth: null, colors: true }));
    console.log("\n");

    const aiCitations = extractCitations(aiResponse);
    if (aiCitations.length > 0) {
      console.log("📚 Citations:");
      aiCitations.forEach((citation, idx) => {
        console.log(`  ${idx + 1}. ${citation}`);
      });
    }

    console.log("\n" + "=".repeat(60) + "\n");

    // Example 3: Inspect raw response structure
    console.log("🔧 Raw Response Structure (for debugging):\n");
    console.log("-".repeat(60));
    console.log("Response type:", typeof aiResponse.content);
    console.log("Has additional_kwargs:", !!aiResponse.additional_kwargs);
    console.log("Has tool_calls:", !!aiResponse.tool_calls);

    const aiAdditionalKwargs = aiResponse.additional_kwargs as AnthropicAdditionalKwargs;
    if (aiAdditionalKwargs?.content) {
      console.log("\nContent blocks:");
      aiAdditionalKwargs.content.forEach((block, idx) => {
        console.log(`  Block ${idx + 1}: type = ${block.type}`);
      });
    }

  } catch (error) {
    console.error("❌ Error occurred:");
    if (error instanceof Error) {
      console.error(`  Message: ${error.message}`);
      console.error(`  Stack: ${error.stack}`);
    } else {
      console.error(error);
    }

    console.log("\n⚠️  Troubleshooting tips:");
    console.log("  1. Ensure ANTHROPIC_API_KEY is set in your .env file");
    console.log("  2. Verify you're using a web-search capable model");
    console.log("  3. Check if beta headers are required (uncomment clientOptions)");
    console.log("  4. Ensure your API key has access to the web search feature");
  }
}

/**
 * Interactive example: Ask your own question
 */
async function customSearch(query: string) {
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-5-20250929",
    temperature: 0,
  });

  const tools = [
    {
      type: "web_search_20250305" as const,
      name: "web_search",
      max_uses: 5,
    },
  ];

  const llmWithSearch = llm.bindTools(tools);

  console.log(`\n🔍 Searching: "${query}"\n`);
  console.log("=".repeat(60));

  const response = await llmWithSearch.invoke([
    {
      role: "user",
      content: query,
    },
  ]);

  console.log(inspect(response.content, { depth: null, colors: true }));

  const citations = extractCitations(response);
  if (citations.length > 0) {
    console.log("\n📚 Citations:");
    citations.forEach((citation, idx) => {
      console.log(`  ${idx + 1}. ${citation}`);
    });
  }
}

// Main execution
if (require.main === module) {
  searchLatestNews()
    .then(() => {
      console.log("✅ Example completed successfully!");

      // Uncomment below to test with a custom query
      // return customSearch("What happened in SpaceX today?");
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

// Export for use in other modules
export { searchLatestNews, customSearch };
