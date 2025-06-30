/**
 * Structured Output Model Callback Tracing Example
 * 
 * This example demonstrates how to trace events when using models with
 * structured output in a LangGraph, similar to the allergen detection pattern.
 * 
 * KEY CONCEPTS:
 * 1. Models with structured output (withStructuredOutput)
 * 2. Multiple models in sequence (keyword extraction → analysis)
 * 3. Batch processing with callbacks
 * 4. StateGraph with custom state types
 * 
 * WHAT THIS EXAMPLE REVEALS:
 * 
 * When you use model.withStructuredOutput(ZodSchema), LangChain:
 * 1. Wraps your model with a RunnableSequence
 * 2. Converts your Zod schema to an OpenAI function/tool definition
 * 3. Makes the LLM call with tool_choice="required" 
 * 4. The LLM responds with a tool_call (not regular content)
 * 5. JsonOutputKeyToolsParser extracts the structured data from the tool call
 * 
 * CALLBACK INSIGHTS:
 * - onLLMStart: Shows the model being invoked with your prompt
 * - onLLMEnd: Reveals the tool_call response with your structured data
 * - onChainStart/End: Shows the JsonOutputKeyToolsParser extracting the data
 * 
 * The most important discovery: withStructuredOutput uses tool calling under
 * the hood, which is why the response has empty content and all data is in
 * the tool_calls array.
 * 
 * RUN THIS EXAMPLE:
 * ```bash
 * npx ts-node src/examples/callback-tracing/structured-output-example.ts
 * ```
 * 
 * Look for the "🔶 [LLM END]" logs to see the full structure of responses
 * when using withStructuredOutput.
 */

import { z } from "zod";
import { StateGraph, START, END } from "@langchain/langgraph";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { LLMResult } from "@langchain/core/outputs";
import { BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import * as util from "util";
import dotenv from "dotenv";

dotenv.config();

// Define our schemas similar to the allergen example
const KeywordExtractionSchema = z.object({
  keywords: z.array(z.string()).describe("List of extracted keywords from the text"),
  confidence: z.number().min(0).max(1).describe("Confidence in keyword extraction")
});

const AnalysisResultSchema = z.object({
  itemId: z.string().describe("ID of the analyzed item"),
  categories: z.array(z.object({
    name: z.string().describe("Category name"),
    confidence: z.number().min(0).max(1).describe("Confidence score"),
    reasoning: z.string().describe("Reasoning for this categorization")
  })).describe("Detected categories with confidence scores"),
  summary: z.string().describe("Brief summary of the analysis")
});

const BatchAnalysisSchema = z.object({
  analyses: z.array(AnalysisResultSchema).describe("Batch of analysis results")
});

// Define state types
interface AnalysisState {
  items: Array<{
    id: string;
    text: string;
    keywords?: string[];
    analysis?: z.infer<typeof AnalysisResultSchema>;
  }>;
  processingMetrics?: {
    keywordExtractionTime?: number;
    analysisTime?: number;
    totalItems?: number;
  };
}

/**
 * Custom callback handler that logs structured output events
 */
class StructuredOutputCallbackHandler extends BaseCallbackHandler {
  name = "structured_output_handler";

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, any>,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<void> {
    console.log("\n🔷 [LLM START] Structured Output Model Invocation");
    console.log("├─ Model:", llm.id?.join("/") || "unknown");
    console.log("├─ Run ID:", runId);
    console.log("├─ Parent Run ID:", parentRunId || "none");
    
    // Check if this is a structured output call
    if (metadata?.structuredOutput) {
      console.log("├─ Structured Output Schema:", metadata.structuredOutput);
    }
    
    console.log("├─ Prompt Preview:", prompts[0]?.substring(0, 100) + "...");
    console.log("└─ Tags:", tags?.join(", ") || "none");
  }

  /**
   * Handle LLM completion events - this is where we see structured output responses
   * 
   * CRITICAL INSIGHTS ABOUT withStructuredOutput:
   * 
   * When using model.withStructuredOutput(schema), LangChain internally:
   * 1. Converts your Zod schema into an OpenAI-style function/tool definition
   * 2. Sends the request as a tool-calling request (not a regular completion)
   * 3. The LLM responds with a tool_call containing your structured data
   * 4. LangChain's JsonOutputKeyToolsParser extracts just the args from the tool call
   * 
   * RESPONSE STRUCTURE:
   * ```
   * {
   *   generations: [[
   *     ChatGenerationChunk {
   *       text: '',  // Always empty for structured outputs!
   *       message: AIMessageChunk {
   *         content: '',  // Also empty - data is in tool_calls
   *         tool_calls: [{
   *           name: 'extract',  // Internal function name
   *           args: { ... },    // YOUR STRUCTURED DATA HERE
   *           id: 'unique-id',
   *           type: 'tool_call'
   *         }],
   *         usage_metadata: {
   *           input_tokens: 54,
   *           output_tokens: 85,
   *           total_tokens: 139,
   *           output_token_details: {
   *             text: 14,        // Tokens for the JSON structure
   *             reasoning: 71    // Tokens for internal reasoning
   *           }
   *         }
   *       }
   *     }
   *   ]],
   *   llmOutput: {
   *     finish_reason: 'STOP',
   *     usage_metadata: { ... }
   *   }
   * }
   * ```
   * 
   * KEY OBSERVATIONS:
   * - The actual structured data is in: generations[0][0].message.tool_calls[0].args
   * - The 'content' and 'text' fields are always empty
   * - The response includes separate token counts for reasoning vs output
   * - The message type is AIMessageChunk (not AIMessage) for streaming support
   */
  async handleLLMEnd(
    output: LLMResult,
    runId: string
  ): Promise<void> {
    console.log("\n🔶 [LLM END] Structured Output Response");
    console.log("├─ Run ID:", runId);
    console.log("└─ Full Output:", util.inspect(output, {
      depth: null,
      colors: false,
      maxArrayLength: null,
      breakLength: 80,
      compact: false,
      showHidden: false,
      customInspect: true
    }));
  }

  async handleChainStart(
    chain: Serialized,
    inputs: Record<string, any>,
    runId: string
  ): Promise<void> {
    console.log("\n🔗 [CHAIN START]", chain.id?.join("/") || "unknown");
    console.log("├─ Run ID:", runId);
    console.log("└─ Input Keys:", Object.keys(inputs).join(", "));
  }

  async handleChainEnd(
    outputs: Record<string, any>,
    runId: string
  ): Promise<void> {
    console.log("\n✅ [CHAIN END]");
    console.log("├─ Run ID:", runId);
    console.log("└─ Output Keys:", Object.keys(outputs).join(", "));
  }
}

/**
 * Node that extracts keywords using structured output
 */
async function extractKeywordsNode(
  state: AnalysisState,
  config: RunnableConfig
): Promise<Partial<AnalysisState>> {
  console.log("\n📝 Extracting keywords from items...");
  
  const startTime = Date.now();
  const keywordModel = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.0,
  }).withStructuredOutput(KeywordExtractionSchema);

  // Process each item
  const updatedItems = await Promise.all(
    state.items.map(async (item) => {
      const prompt = `Extract keywords from this text: "${item.text}"`;
      
      // The callback will capture this structured output invocation
      const result = await keywordModel.invoke(prompt, {
        callbacks: config.callbacks,
        metadata: {
          structuredOutput: "KeywordExtractionSchema",
          itemId: item.id
        }
      });
      
      return {
        ...item,
        keywords: result.keywords
      };
    })
  );

  const keywordExtractionTime = Date.now() - startTime;
  
  return {
    items: updatedItems,
    processingMetrics: {
      ...state.processingMetrics,
      keywordExtractionTime,
      totalItems: state.items.length
    }
  };
}

/**
 * Node that performs batch analysis using structured output
 */
async function analyzeItemsNode(
  state: AnalysisState,
  config: RunnableConfig
): Promise<Partial<AnalysisState>> {
  console.log("\n🔍 Analyzing items in batch...");
  
  const startTime = Date.now();
  const analysisModel = new ChatVertexAI({
    model: "gemini-2.5-pro",
    temperature: 0.1,
  }).withStructuredOutput(BatchAnalysisSchema);

  // Prepare batch input
  const batchInput = state.items.map(item => ({
    id: item.id,
    text: item.text,
    keywords: item.keywords || []
  }));

  const prompt = `Analyze these items and categorize them. Consider the extracted keywords.
  
Items to analyze:
${JSON.stringify(batchInput, null, 2)}

Categories to consider:
- Technology
- Food & Beverage
- Health & Wellness
- Entertainment
- Business
- Education
- Other

Provide confidence scores and reasoning for each categorization.`;

  // The callback will capture this batch structured output invocation
  const result = await analysisModel.invoke(prompt, {
    callbacks: config.callbacks,
    metadata: {
      structuredOutput: "BatchAnalysisSchema",
      batchSize: state.items.length
    }
  });

  // Map results back to items
  const analysisMap = new Map(
    result.analyses.map(analysis => [analysis.itemId, analysis])
  );

  const updatedItems = state.items.map(item => ({
    ...item,
    analysis: analysisMap.get(item.id)
  }));

  const analysisTime = Date.now() - startTime;

  return {
    items: updatedItems,
    processingMetrics: {
      ...state.processingMetrics,
      analysisTime,
      totalItems: state.items.length
    }
  };
}

/**
 * Create the analysis graph
 */
function createAnalysisGraph() {
  const workflow = new StateGraph<AnalysisState>({
    channels: {
      items: {
        reducer: (_, next) => next,
      },
      processingMetrics: {
        reducer: (_, next) => next,
      }
    }
  })
    .addNode("extract_keywords", extractKeywordsNode)
    .addNode("analyze_items", analyzeItemsNode)
    .addEdge(START, "extract_keywords")
    .addEdge("extract_keywords", "analyze_items")
    .addEdge("analyze_items", END);

  return workflow.compile();
}

/**
 * Main function to demonstrate structured output callback tracing
 */
async function main() {
  console.log("=== Structured Output Callback Tracing Example ===\n");

  // Create our custom callback handler
  const callbackHandler = new StructuredOutputCallbackHandler();

  // Sample items to analyze
  const sampleItems = [
    {
      id: "item-1",
      text: "The new MacBook Pro features the M3 chip with incredible performance for video editing and 3D rendering."
    },
    {
      id: "item-2",
      text: "Our organic smoothie bowl contains acai berries, banana, granola, and is topped with fresh seasonal fruits."
    },
    {
      id: "item-3",
      text: "This yoga class focuses on mindfulness and breathing techniques to reduce stress and improve flexibility."
    }
  ];

  // Create and run the graph
  const graph = createAnalysisGraph();
  
  console.log("🚀 Starting structured output analysis with callback tracing...\n");

  const result = await graph.invoke(
    { items: sampleItems },
    { 
      callbacks: [callbackHandler],
      tags: ["structured-output-example"],
      metadata: {
        experiment: "callback-tracing",
        version: "1.0"
      }
    }
  );

  // Display final results
  console.log("\n📊 Final Analysis Results:");
  console.log("=".repeat(50));
  
  result.items.forEach((item: any) => {
    console.log(`\n📄 Item: ${item.id}`);
    console.log(`Text: ${item.text}`);
    console.log(`Keywords: ${item.keywords?.join(", ")}`);
    
    if (item.analysis) {
      console.log("Categories:");
      item.analysis.categories.forEach((cat: any) => {
        console.log(`  - ${cat.name} (${(cat.confidence * 100).toFixed(1)}%): ${cat.reasoning}`);
      });
      console.log(`Summary: ${item.analysis.summary}`);
    }
  });

  console.log("\n⏱️  Processing Metrics:");
  console.log(`Keyword Extraction: ${result.processingMetrics?.keywordExtractionTime}ms`);
  console.log(`Analysis: ${result.processingMetrics?.analysisTime}ms`);
  console.log(`Total Items: ${result.processingMetrics?.totalItems}`);
}

if (require.main === module) {
  main().catch(console.error);
}