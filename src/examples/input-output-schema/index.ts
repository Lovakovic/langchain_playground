/**
 * LangGraph Parallel Subgraphs with Input/Output Schemas Example
 * 
 * This example demonstrates how to solve the INVALID_CONCURRENT_GRAPH_UPDATE error
 * that occurs when multiple subgraphs run in parallel and attempt to update the
 * same state channels.
 * 
 * THE PROBLEM:
 * When subgraphs share the same state definition and run in parallel, they all
 * attempt to write to the same state channels when they complete. This causes
 * a conflict because LangGraph doesn't know which update to keep.
 * 
 * THE SOLUTION:
 * Use input/output schemas to control what state channels each subgraph can
 * read from and write to. This creates isolation between parallel subgraphs.
 * 
 * Architecture:
 * 1. Parent Graph: Orchestrates parallel execution
 * 2. Three Subgraphs: Reddit, Twitter, News (all identical internally)
 * 3. Input Schema: What each subgraph can read (query only)
 * 4. Output Schema: What each subgraph can write (unique channels)
 * 
 * Key Pattern:
 * - All subgraphs share the same input schema (SubgraphInputSchema) in this example
 * - All subgraphs use the same internal state structure (for simplicity)
 * - Each subgraph has DIFFERENT output schema mapping to unique parent channels
 * 
 * Why This Works:
 * 1. Input schemas limit what parent state is passed to subgraphs
 * 2. Output schemas limit what subgraph state is returned to parent
 * 3. Each subgraph writes to different parent state channels
 * 4. No conflicts occur during parallel execution
 */

import { Annotation, MemorySaver, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatVertexAI } from "@langchain/google-vertexai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

/**
 * Parent Graph State Definition
 * 
 * This state contains unique channels for each subgraph's output.
 * This is CRITICAL - each subgraph must write to different channels
 * to avoid conflicts during parallel execution.
 * 
 * WHAT WORKS:
 * - Unique channel names for each subgraph (redditSentiment, twitterSentiment, etc.)
 * - Shared channels that use reducers (messages with array concatenation)
 * - Single source of truth for input data (query)
 * 
 * WHAT WOULD BREAK:
 * - Having all subgraphs write to "sentiment" instead of unique channels
 * - Not using reducers for shared channels like messages
 * - Allowing subgraphs to directly update each other's channels
 */
const ContentAnalysisState = Annotation.Root({
  // Input data shared across all subgraphs
  query: Annotation<string>,
  
  // Shared channel with reducer - safe for concurrent updates
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Unique channels for Reddit subgraph output
  // CRITICAL: These must be different from other subgraph channels
  redditSentiment: Annotation<number>,
  redditQuality: Annotation<string>,
  redditMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>,
  
  // Unique channels for Twitter subgraph output
  // CRITICAL: These must be different from other subgraph channels
  twitterSentiment: Annotation<number>,
  twitterQuality: Annotation<string>,
  twitterMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>,
  
  // Unique channels for News subgraph output
  // CRITICAL: These must be different from other subgraph channels
  newsSentiment: Annotation<number>,
  newsQuality: Annotation<string>,
  newsMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

/**
 * Subgraph Input Schema
 * 
 * In this example, all subgraphs share the same input schema for simplicity.
 * It defines what parent state channels the subgraph can read.
 * 
 * WHAT WORKS:
 * - Limiting subgraphs to only the data they need (query)
 * - Each subgraph could have different input schemas if needed
 * - Keeping input minimal to avoid unnecessary data passing
 * 
 * WHAT WOULD BREAK:
 * - Including output channels in the input schema
 * - Not including required data (e.g., missing query)
 * - Trying to read channels not defined in the input schema
 */
const SubgraphInputSchema = Annotation.Root({
  query: Annotation<string>
});

/**
 * Subgraph Internal State
 * 
 * In this example, all subgraphs share the same internal state structure
 * to demonstrate that the conflict comes from output channels, not internal state.
 * 
 * The key insight: Subgraphs can have any internal state structure they need,
 * as long as their output schemas map to unique parent channels.
 * 
 * WHAT WORKS:
 * - Using generic field names (data, sentiment, quality)
 * - Different subgraphs could have completely different internal states
 * - Internal state that's transformed to unique output
 * 
 * WHAT WOULD BREAK:
 * - Using parent channel names that conflict in output
 * - Not including fields needed for processing
 * - Output schemas that overlap between subgraphs
 */
const SubgraphInternalState = Annotation.Root({
  query: Annotation<string>,
  data: Annotation<any[]>,
  sentiment: Annotation<number>,
  quality: Annotation<string>,
  metadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

/**
 * Subgraph Output Schemas
 * 
 * CRITICAL: Each subgraph MUST have a DIFFERENT output schema
 * that maps to unique channels in the parent state.
 * 
 * This is the KEY to avoiding INVALID_CONCURRENT_GRAPH_UPDATE:
 * - Reddit writes to redditSentiment, redditQuality, redditMetadata
 * - Twitter writes to twitterSentiment, twitterQuality, twitterMetadata
 * - News writes to newsSentiment, newsQuality, newsMetadata
 * 
 * WHAT WORKS:
 * - Unique channel names for each subgraph
 * - Direct mapping from internal state to parent channels
 * - No overlap between subgraph output channels
 * 
 * WHAT WOULD BREAK:
 * - Multiple subgraphs writing to the same channel
 * - Including channels that don't exist in parent state
 * - Overlapping output schemas between subgraphs
 */
const RedditOutputSchema = Annotation.Root({
  redditSentiment: Annotation<number>,
  redditQuality: Annotation<string>,
  redditMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

const TwitterOutputSchema = Annotation.Root({
  twitterSentiment: Annotation<number>,
  twitterQuality: Annotation<string>,
  twitterMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

const NewsOutputSchema = Annotation.Root({
  newsSentiment: Annotation<number>,
  newsQuality: Annotation<string>,
  newsMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

/**
 * Reddit Subgraph Implementation
 * 
 * Note: In this example, all three subgraphs (Reddit, Twitter, News) have
 * similar internal logic to clearly demonstrate that the conflict comes from
 * output channels, not from the processing logic itself.
 * 
 * In practice, each subgraph could have completely different logic,
 * state structures, and processing steps.
 */

// Reddit data fetching - uses internal state fields
async function fetchRedditData(state: typeof SubgraphInternalState.State) {
  console.log("\n🟠 [Reddit Subgraph] Fetching data...");
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(state.query)}&sort=hot&limit=10`,
      { headers: { 'User-Agent': 'LangGraph-Example/1.0' } }
    );
    
    const data = await response.json();
    const posts = data.data.children.map((child: any) => ({
      title: child.data.title,
      score: child.data.score,
      subreddit: child.data.subreddit
    }));
    
    const avgScore = posts.reduce((acc: number, post: any) => acc + post.score, 0) / (posts.length || 1);
    const sentiment = Math.min(1, avgScore / 1000);
    
    // Returns update to INTERNAL state (data, sentiment, metadata)
    return {
      data: posts,
      sentiment,
      metadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "reddit_fetch"
      }
    };
  } catch (error) {
    return {
      data: [],
      sentiment: 0,
      metadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "reddit_fetch_error"
      }
    };
  }
}

// Reddit quality analysis - uses internal state fields
async function analyzeRedditQuality(state: typeof SubgraphInternalState.State) {
  console.log("🟠 [Reddit Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentiment > 0.5 ? "high" : 
                  state.sentiment > 0.2 ? "medium" : "low";
  
  // Returns update to INTERNAL state
  return {
    quality,
    metadata: {
      totalTime: state.metadata.totalTime + (Date.now() - startTime),
      nodeCount: state.metadata.nodeCount + 1,
      lastNode: "reddit_quality"
    }
  };
}

/**
 * CRITICAL NODE: Output Preparation
 * 
 * This node transforms internal state to the subgraph's output schema.
 * This is where the magic happens - internal fields are mapped to
 * unique parent state channels.
 * 
 * WHAT WORKS:
 * - Mapping sentiment -> redditSentiment
 * - Mapping quality -> redditQuality
 * - Mapping metadata -> redditMetadata
 * 
 * WHAT WOULD BREAK:
 * - Returning fields not in RedditOutputSchema
 * - Returning fields that conflict with other subgraphs
 * - Not including all fields from the output schema
 */
async function prepareRedditOutput(state: typeof SubgraphInternalState.State) {
  // Map internal state to Reddit-specific output channels
  return {
    redditSentiment: state.sentiment,
    redditQuality: state.quality,
    redditMetadata: state.metadata
  };
}

// Twitter Subgraph Implementation (similar structure, different output)
async function fetchTwitterData(state: typeof SubgraphInternalState.State) {
  console.log("\n🐦 [Twitter Subgraph] Fetching data...");
  const startTime = Date.now();
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const mockTweets = [
    { text: `Breaking: ${state.query} trends worldwide`, likes: 1500, retweets: 500 },
    { text: `Amazing insights about ${state.query}`, likes: 800, retweets: 200 },
    { text: `${state.query} is the future!`, likes: 2000, retweets: 600 }
  ];
  
  const avgEngagement = mockTweets.reduce((acc, tweet) => 
    acc + tweet.likes + tweet.retweets, 0) / (mockTweets.length || 1);
  const sentiment = Math.min(1, avgEngagement / 2000);
  
  // Returns update to INTERNAL state (same fields as Reddit)
  return {
    data: mockTweets,
    sentiment,
    metadata: {
      totalTime: Date.now() - startTime,
      nodeCount: 1,
      lastNode: "twitter_fetch"
    }
  };
}

async function analyzeTwitterQuality(state: typeof SubgraphInternalState.State) {
  console.log("🐦 [Twitter Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentiment > 0.7 ? "high" : 
                  state.sentiment > 0.3 ? "medium" : "low";
  
  return {
    quality,
    metadata: {
      totalTime: state.metadata.totalTime + (Date.now() - startTime),
      nodeCount: state.metadata.nodeCount + 1,
      lastNode: "twitter_quality"
    }
  };
}

/**
 * Twitter output preparation - maps to DIFFERENT parent channels
 * than Reddit, preventing conflicts
 */
async function prepareTwitterOutput(state: typeof SubgraphInternalState.State) {
  // Map internal state to Twitter-specific output channels
  return {
    twitterSentiment: state.sentiment,
    twitterQuality: state.quality,
    twitterMetadata: state.metadata
  };
}

// News Subgraph Implementation (similar structure, different output)
async function fetchNewsData(state: typeof SubgraphInternalState.State) {
  console.log("\n📰 [News Subgraph] Fetching data...");
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(state.query)}&tags=story&hitsPerPage=10`
    );
    
    const data = await response.json();
    const articles = data.hits.map((hit: any) => ({
      title: hit.title,
      points: hit.points,
      comments: hit.num_comments
    }));
    
    const avgPoints = articles.reduce((acc: number, article: any) => 
      acc + article.points, 0) / (articles.length || 1);
    const sentiment = Math.min(1, avgPoints / 500);
    
    return {
      data: articles,
      sentiment,
      metadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "news_fetch"
      }
    };
  } catch (error) {
    return {
      data: [],
      sentiment: 0,
      metadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "news_fetch_error"
      }
    };
  }
}

async function analyzeNewsQuality(state: typeof SubgraphInternalState.State) {
  console.log("📰 [News Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentiment > 0.6 ? "high" : 
                  state.sentiment > 0.3 ? "medium" : "low";
  
  return {
    quality,
    metadata: {
      totalTime: state.metadata.totalTime + (Date.now() - startTime),
      nodeCount: state.metadata.nodeCount + 1,
      lastNode: "news_quality"
    }
  };
}

/**
 * News output preparation - maps to YET DIFFERENT parent channels
 */
async function prepareNewsOutput(state: typeof SubgraphInternalState.State) {
  // Map internal state to News-specific output channels
  return {
    newsSentiment: state.sentiment,
    newsQuality: state.quality,
    newsMetadata: state.metadata
  };
}

/**
 * Subgraph Creation Functions
 * 
 * CRITICAL: The StateGraph constructor with input/output schemas
 * 
 * The magic happens here:
 * 1. input: Defines what the subgraph can read from parent
 * 2. output: Defines what the subgraph can write to parent (must be unique)
 * 3. stateSchema: Internal working state (can be anything)
 * 
 * WHAT WORKS:
 * - Each subgraph can have different input/internal schemas
 * - Different output schemas for each subgraph (this is critical)
 * - Output node that transforms internal state to output schema
 * 
 * WHAT WOULD BREAK:
 * - Not including the output transformation node
 * - Using the same output schema for multiple subgraphs
 * - Mismatching schemas with parent state structure
 */
function createRedditSubgraph() {
  const workflow = new StateGraph({
    input: SubgraphInputSchema,      // What we can read from parent
    output: RedditOutputSchema,      // What we can write to parent
    stateSchema: SubgraphInternalState  // Our internal working state
  })
    .addNode("fetch_data", fetchRedditData)
    .addNode("analyze_quality", analyzeRedditQuality)
    .addNode("prepare_output", prepareRedditOutput)  // CRITICAL: Maps to output schema
    .addEdge("__start__", "fetch_data")
    .addEdge("fetch_data", "analyze_quality")
    .addEdge("analyze_quality", "prepare_output")
    .addEdge("prepare_output", "__end__");
    
  return workflow.compile();
}

function createTwitterSubgraph() {
  const workflow = new StateGraph({
    input: SubgraphInputSchema,      // Could be different from Reddit
    output: TwitterOutputSchema,     // MUST be different from Reddit
    stateSchema: SubgraphInternalState  // Could be different from Reddit
  })
    .addNode("fetch_data", fetchTwitterData)
    .addNode("analyze_quality", analyzeTwitterQuality)
    .addNode("prepare_output", prepareTwitterOutput)
    .addEdge("__start__", "fetch_data")
    .addEdge("fetch_data", "analyze_quality")
    .addEdge("analyze_quality", "prepare_output")
    .addEdge("prepare_output", "__end__");
    
  return workflow.compile();
}

function createNewsSubgraph() {
  const workflow = new StateGraph({
    input: SubgraphInputSchema,      // Could be different from others
    output: NewsOutputSchema,        // MUST be different from others
    stateSchema: SubgraphInternalState  // Could be different from others
  })
    .addNode("fetch_data", fetchNewsData)
    .addNode("analyze_quality", analyzeNewsQuality)
    .addNode("prepare_output", prepareNewsOutput)
    .addEdge("__start__", "fetch_data")
    .addEdge("fetch_data", "analyze_quality")
    .addEdge("analyze_quality", "prepare_output")
    .addEdge("prepare_output", "__end__");
    
  return workflow.compile();
}

/**
 * Parent Graph Nodes
 */
async function processInput(state: typeof ContentAnalysisState.State) {
  console.log("\n🔍 Processing input query...");
  const lastMessage = state.messages[state.messages.length - 1];
  const query = lastMessage.content as string;
  
  return {
    query: query.toLowerCase().trim(),
    messages: [new AIMessage(`Starting parallel analysis for: "${query}"`)]
  };
}

/**
 * Aggregation Node
 * 
 * This node can safely access all the unique channels written by
 * the subgraphs because there are no conflicts - each subgraph
 * wrote to different channels.
 * 
 * WHAT WORKS:
 * - Reading from all unique subgraph channels
 * - Aggregating data after parallel execution
 * - No race conditions or conflicts
 * 
 * WHAT WOULD BREAK:
 * - If subgraphs wrote to the same channels
 * - If output schemas overlapped
 * - If subgraphs could modify each other's data
 */
async function aggregateResults(state: typeof ContentAnalysisState.State) {
  console.log("\n📊 Aggregating results from all sources...");
  
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");
  }

  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
  });

  // Safe to read all channels - no conflicts occurred
  const avgSentiment = (state.redditSentiment + state.twitterSentiment + state.newsSentiment) / 3;
  const qualities = [state.redditQuality, state.twitterQuality, state.newsQuality];
  const overallQuality = qualities.filter(q => q === "high").length >= 2 ? "high" :
                         qualities.filter(q => q === "medium").length >= 2 ? "medium" : "low";

  const prompt = `Analyze the sentiment and quality data for "${state.query}":

Reddit: Sentiment ${state.redditSentiment.toFixed(2)}, Quality: ${state.redditQuality}
Twitter: Sentiment ${state.twitterSentiment.toFixed(2)}, Quality: ${state.twitterQuality}  
News: Sentiment ${state.newsSentiment.toFixed(2)}, Quality: ${state.newsQuality}

Average Sentiment: ${avgSentiment.toFixed(2)}
Overall Quality: ${overallQuality}

Provide a brief summary of the overall content landscape.`;

  const response = await model.invoke(prompt);
  
  return {
    messages: [response]
  };
}

/**
 * Parent Graph Construction
 * 
 * The parent graph orchestrates the parallel execution pattern:
 * 
 * 1. Start -> process_input: Prepare the query
 * 2. process_input -> Fan-out to 3 subgraphs (parallel execution)
 * 3. All subgraphs -> aggregate: Fan-in without conflicts
 * 
 * CRITICAL SUCCESS FACTORS:
 * - Each subgraph writes to unique channels (no conflicts)
 * - Input schemas limit what subgraphs can read
 * - Output schemas control what subgraphs can write
 * - The fan-in works because there are no overlapping writes
 * 
 * WHAT WOULD BREAK THIS:
 * - Subgraphs with overlapping output channels
 * - Not using input/output schemas
 * - Direct state sharing between subgraphs
 * - Missing output transformation nodes in subgraphs
 */
export function createFixedParallelSubgraphsGraph() {
  const redditSubgraph = createRedditSubgraph();
  const twitterSubgraph = createTwitterSubgraph();
  const newsSubgraph = createNewsSubgraph();
  
  const workflow = new StateGraph(ContentAnalysisState)
    .addNode("process_input", processInput)
    
    // Add subgraphs as nodes - they will execute in parallel
    .addNode("reddit_analysis", redditSubgraph)
    .addNode("twitter_analysis", twitterSubgraph)
    .addNode("news_analysis", newsSubgraph)
    
    .addNode("aggregate", aggregateResults)
    
    .addEdge("__start__", "process_input")
    
    // FAN-OUT: All three subgraphs run in parallel
    // This works because each has unique output channels
    .addEdge("process_input", "reddit_analysis")
    .addEdge("process_input", "twitter_analysis")
    .addEdge("process_input", "news_analysis")
    
    // FAN-IN: This works because each subgraph wrote to different channels!
    // No INVALID_CONCURRENT_GRAPH_UPDATE error occurs
    .addEdge("reddit_analysis", "aggregate")
    .addEdge("twitter_analysis", "aggregate")
    .addEdge("news_analysis", "aggregate")
    
    .addEdge("aggregate", "__end__");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Demo Execution
 */
async function runFixedDemo() {
  console.log("=== ✅ FIXED Parallel Subgraphs Example ✅ ===");
  console.log("\nThis demonstrates the fix for INVALID_CONCURRENT_GRAPH_UPDATE.");
  console.log("Each subgraph has:");
  console.log("- Same input schema (SubgraphInputSchema) - for simplicity");
  console.log("- Same internal state (SubgraphInternalState) - for demonstration"); 
  console.log("- DIFFERENT output schemas mapping to unique parent channels\n");
  
  const graph = createFixedParallelSubgraphsGraph();
  const threadId = `fixed-subgraphs-${Date.now()}`;
  
  const testInput = "artificial intelligence trends";
  
  console.log("Input:", testInput);
  console.log("\n⚡ Starting parallel subgraph execution...");
  console.log("✅ This should work without conflicts! ✅\n");
  
  try {
    const startTime = Date.now();
    
    const result = await graph.invoke(
      {
        messages: [new HumanMessage(testInput)],
        query: ""
      },
      {
        configurable: { thread_id: threadId }
      }
    );
    
    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log("\n✅ SUCCESS! Parallel subgraphs completed without conflicts!");
    console.log("━".repeat(60));
    
    console.log("\n📊 Results Summary:");
    console.log(`- Reddit: Sentiment ${result.redditSentiment.toFixed(2)}, Quality: ${result.redditQuality}`);
    console.log(`- Twitter: Sentiment ${result.twitterSentiment.toFixed(2)}, Quality: ${result.twitterQuality}`);
    console.log(`- News: Sentiment ${result.newsSentiment.toFixed(2)}, Quality: ${result.newsQuality}`);
    
    console.log(`\n⏱️  Total execution time: ${totalTime}s`);
    console.log("✨ All 3 subgraphs ran in parallel successfully!");
    
    console.log("\n🎯 KEY PATTERN SUMMARY:");
    console.log("- Subgraphs can have any internal state structure");
    console.log("- Each subgraph defines a UNIQUE output schema");
    console.log("- Output schemas map to different parent state channels");
    console.log("- No conflicting updates when fan-in occurs!");
    
  } catch (error) {
    console.log("\n❌ Unexpected error:");
    console.log("━".repeat(60));
    
    if (error instanceof Error) {
      console.log("Error Type:", error.constructor.name);
      console.log("Error Message:", error.message);
    }
    
    console.log("━".repeat(60));
  }
}

/**
 * Key Takeaways and Best Practices:
 * 
 * 1. INPUT/OUTPUT SCHEMA PATTERN
 *    - Input schemas can be different for each subgraph
 *    - Output schemas MUST be unique to prevent channel conflicts
 *    - Always include output transformation nodes
 * 
 * 2. STATE CHANNEL DESIGN
 *    - Give each subgraph unique output channels in parent state
 *    - Use descriptive prefixes (reddit*, twitter*, news*)
 *    - Avoid generic names that could conflict
 * 
 * 3. INTERNAL VS EXTERNAL STATE
 *    - Subgraphs can have any internal state structure they need
 *    - Output schemas control the mapping to parent channels
 *    - This separation enables flexible subgraph composition
 * 
 * 4. COMMON PITFALLS TO AVOID
 *    - Don't let parallel subgraphs write to the same channels
 *    - Don't skip the output transformation step
 *    - Don't use overlapping output schemas
 *    - Don't forget to define all three schemas (input/output/internal)
 * 
 * 5. DEBUGGING TIPS
 *    - If you get INVALID_CONCURRENT_GRAPH_UPDATE:
 *      * Check if output schemas have overlapping fields
 *      * Verify each subgraph has unique parent channels
 *      * Ensure output transformation nodes exist
 *    - Use streamEvents to see real-time execution
 *    - Add logging to track which subgraph writes what
 * 
 * 6. WHEN TO USE THIS PATTERN
 *    - Multiple data sources processed in parallel
 *    - Similar processing logic with different outputs
 *    - Fan-out/fan-in architectures
 *    - Avoiding sequential bottlenecks
 * 
 * 7. ALTERNATIVES
 *    - Sequential execution (simpler but slower)
 *    - Single graph with conditional routing
 *    - Separate graphs with manual orchestration
 */

if (require.main === module) {
  runFixedDemo().catch(console.error);
}