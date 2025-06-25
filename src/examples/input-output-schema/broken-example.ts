/**
 * LangGraph Broken Parallel Subgraphs Example
 * 
 * This example demonstrates what happens when you DON'T use input/output schemas
 * for parallel subgraphs. It will fail with INVALID_CONCURRENT_GRAPH_UPDATE.
 * 
 * The Problem:
 * - All subgraphs share the same state definition
 * - They all write to the same channels (sentimentScore, contentQuality, etc.)
 * - When running in parallel, their updates conflict
 * - LangGraph can't determine which update to keep
 * 
 * See index.ts for the fixed version using input/output schemas.
 */

import { Annotation, CompiledStateGraph, MemorySaver, StateDefinition, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatVertexAI } from "@langchain/google-vertexai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

/**
 * Shared state definition used by all subgraphs
 * 
 * THE PROBLEM: All subgraphs will try to write to these same channels:
 * - sentimentScore
 * - contentQuality  
 * - processingMetadata
 */
const SharedAnalysisState = Annotation.Root({
  query: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  // These properties will be implicitly updated by all subgraphs
  sentimentScore: Annotation<number>,
  contentQuality: Annotation<string>,
  processingMetadata: Annotation<{
    totalTime: number;
    nodeCount: number;
    lastNode: string;
  }>
});

/**
 * Reddit Subgraph Implementation
 * 
 * Notice: This directly updates sentimentScore and processingMetadata,
 * which will conflict with other subgraphs doing the same.
 */
async function fetchRedditData(state: typeof SharedAnalysisState.State) {
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
    
    return {
      sentimentScore: sentiment,
      processingMetadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "reddit_fetch"
      },
      messages: [new AIMessage(`Reddit: Found ${posts.length} posts with average score ${avgScore.toFixed(0)}`)]
    };
  } catch (error) {
    return {
      sentimentScore: 0,
      processingMetadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "reddit_fetch_error"
      },
      messages: [new AIMessage("Reddit: Failed to fetch data")]
    };
  }
}

async function analyzeRedditQuality(state: typeof SharedAnalysisState.State) {
  console.log("🟠 [Reddit Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentimentScore > 0.5 ? "high" : 
                  state.sentimentScore > 0.2 ? "medium" : "low";
  
  return {
    contentQuality: quality,
    processingMetadata: {
      totalTime: state.processingMetadata.totalTime + (Date.now() - startTime),
      nodeCount: state.processingMetadata.nodeCount + 1,
      lastNode: "reddit_quality"
    },
    messages: [new AIMessage(`Reddit quality assessment: ${quality}`)]
  };
}

// Twitter Subgraph Nodes
async function fetchTwitterData(state: typeof SharedAnalysisState.State) {
  console.log("\n🐦 [Twitter Subgraph] Fetching data...");
  const startTime = Date.now();
  
  // Simulate Twitter API
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const mockTweets = [
    { text: `Breaking: ${state.query} trends worldwide`, likes: 1500, retweets: 500 },
    { text: `Amazing insights about ${state.query}`, likes: 800, retweets: 200 },
    { text: `${state.query} is the future!`, likes: 2000, retweets: 600 }
  ];
  
  const avgEngagement = mockTweets.reduce((acc, tweet) => 
    acc + tweet.likes + tweet.retweets, 0) / (mockTweets.length || 1);
  const sentiment = Math.min(1, avgEngagement / 2000);
  
  return {
    sentimentScore: sentiment,
    processingMetadata: {
      totalTime: Date.now() - startTime,
      nodeCount: 1,
      lastNode: "twitter_fetch"
    },
    messages: [new AIMessage(`Twitter: Analyzed ${mockTweets.length} tweets with ${avgEngagement.toFixed(0)} avg engagement`)]
  };
}

async function analyzeTwitterQuality(state: typeof SharedAnalysisState.State) {
  console.log("🐦 [Twitter Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentimentScore > 0.7 ? "high" : 
                  state.sentimentScore > 0.3 ? "medium" : "low";
  
  return {
    contentQuality: quality,
    processingMetadata: {
      totalTime: state.processingMetadata.totalTime + (Date.now() - startTime),
      nodeCount: state.processingMetadata.nodeCount + 1,
      lastNode: "twitter_quality"
    },
    messages: [new AIMessage(`Twitter quality assessment: ${quality}`)]
  };
}

// News Subgraph Nodes
async function fetchNewsData(state: typeof SharedAnalysisState.State) {
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
      sentimentScore: sentiment,
      processingMetadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "news_fetch"
      },
      messages: [new AIMessage(`News: Found ${articles.length} articles with ${avgPoints.toFixed(0)} avg points`)]
    };
  } catch (error) {
    return {
      sentimentScore: 0,
      processingMetadata: {
        totalTime: Date.now() - startTime,
        nodeCount: 1,
        lastNode: "news_fetch_error"
      },
      messages: [new AIMessage("News: Failed to fetch data")]
    };
  }
}

async function analyzeNewsQuality(state: typeof SharedAnalysisState.State) {
  console.log("📰 [News Subgraph] Analyzing quality...");
  const startTime = Date.now();
  
  const quality = state.sentimentScore > 0.6 ? "high" : 
                  state.sentimentScore > 0.3 ? "medium" : "low";
  
  return {
    contentQuality: quality,
    processingMetadata: {
      totalTime: state.processingMetadata.totalTime + (Date.now() - startTime),
      nodeCount: state.processingMetadata.nodeCount + 1,
      lastNode: "news_quality"
    },
    messages: [new AIMessage(`News quality assessment: ${quality}`)]
  };
}

/**
 * Subgraph Creation - The Root of the Problem
 * 
 * All subgraphs:
 * 1. Use the same SharedAnalysisState
 * 2. Have no input/output schema restrictions
 * 3. Can read and write ALL state channels
 * 4. Will conflict when writing to the same channels
 */
function createRedditSubgraph(): CompiledStateGraph<
  typeof SharedAnalysisState.State,
  Partial<typeof SharedAnalysisState.State>,
  "fetch" | "quality" | "__start__",
  typeof SharedAnalysisState.spec,
  typeof SharedAnalysisState.spec,
  StateDefinition
> {
  const workflow = new StateGraph(SharedAnalysisState)
    .addNode("fetch", fetchRedditData)
    .addNode("quality", analyzeRedditQuality)
    .addEdge("__start__", "fetch")
    .addEdge("fetch", "quality")
    .addEdge("quality", "__end__");
    
  return workflow.compile();
}

function createTwitterSubgraph(): CompiledStateGraph<
  typeof SharedAnalysisState.State,
  Partial<typeof SharedAnalysisState.State>,
  "fetch" | "quality" | "__start__",
  typeof SharedAnalysisState.spec,
  typeof SharedAnalysisState.spec,
  StateDefinition
> {
  const workflow = new StateGraph(SharedAnalysisState)
    .addNode("fetch", fetchTwitterData)
    .addNode("quality", analyzeTwitterQuality)
    .addEdge("__start__", "fetch")
    .addEdge("fetch", "quality")
    .addEdge("quality", "__end__");
    1
  return workflow.compile();
}

function createNewsSubgraph(): CompiledStateGraph<
  typeof SharedAnalysisState.State,
  Partial<typeof SharedAnalysisState.State>,
  "fetch" | "quality" | "__start__",
  typeof SharedAnalysisState.spec,
  typeof SharedAnalysisState.spec,
  StateDefinition
> {
  const workflow = new StateGraph(SharedAnalysisState)
    .addNode("fetch", fetchNewsData)
    .addNode("quality", analyzeNewsQuality)
    .addEdge("__start__", "fetch")
    .addEdge("fetch", "quality")
    .addEdge("quality", "__end__");
    
  return workflow.compile();
}

async function processInput(state: typeof SharedAnalysisState.State) {
  console.log("\n🔍 Processing input query...");
  const lastMessage = state.messages[state.messages.length - 1];
  const query = lastMessage.content as string;
  
  return {
    query: query.toLowerCase().trim(),
    messages: [new AIMessage(`Starting parallel analysis for: "${query}"`)]
  };
}

async function aggregateResults(state: typeof SharedAnalysisState.State) {
  console.log("\n📊 Aggregating results from all sources...");
  
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");
  }

  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
  });

  const prompt = `Analyze the sentiment and quality data for "${state.query}":
Sentiment Score: ${state.sentimentScore}
Content Quality: ${state.contentQuality}
Processing Info: ${JSON.stringify(state.processingMetadata)}

Provide a brief summary of the overall content landscape.`;

  const response = await model.invoke(prompt);
  
  return {
    messages: [response]
  };
}

/**
 * Parent Graph Construction - Where the Conflict Happens
 * 
 * The graph structure itself is fine, but without input/output schemas,
 * all three subgraphs will attempt to write to the same state channels
 * when they complete in parallel.
 */
export function createBrokenParallelSubgraphsGraph() {
  // All subgraphs share the same state and have no restrictions
  const redditSubgraph = createRedditSubgraph();
  const twitterSubgraph = createTwitterSubgraph();
  const newsSubgraph = createNewsSubgraph();
  
  const workflow = new StateGraph(SharedAnalysisState)
    .addNode("process_input", processInput)
    // Without input/output schemas, these will conflict
    .addNode("reddit_analysis", redditSubgraph)
    .addNode("twitter_analysis", twitterSubgraph)
    .addNode("news_analysis", newsSubgraph)
    .addNode("aggregate", aggregateResults)
    
    .addEdge("__start__", "process_input")
    
    // FAN-OUT: All three subgraphs run in parallel
    .addEdge("process_input", "reddit_analysis")
    .addEdge("process_input", "twitter_analysis")
    .addEdge("process_input", "news_analysis")
    
    // FAN-IN: This is where the error occurs!
    // All subgraphs complete and try to update the same channels
    .addEdge("reddit_analysis", "aggregate")
    .addEdge("twitter_analysis", "aggregate")
    .addEdge("news_analysis", "aggregate")
    
    .addEdge("aggregate", "__end__");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

async function runBrokenDemo() {
  console.log("=== 🚨 BROKEN Parallel Subgraphs Example 🚨 ===");
  console.log("\nThis demonstrates what happens WITHOUT input/output schemas.");
  console.log("All subgraphs share the same state definition and write to the same channels.");
  console.log("This causes INVALID_CONCURRENT_GRAPH_UPDATE when they complete in parallel.\n");
  
  const graph = createBrokenParallelSubgraphsGraph();
  const threadId = `broken-subgraphs-${Date.now()}`;
  
  const testInput = "artificial intelligence trends";
  
  console.log("Input:", testInput);
  console.log("\n⚡ Starting parallel subgraph execution...");
  console.log("🚨 This WILL fail when subgraphs complete! 🚨\n");
  
  try {
    const result = await graph.invoke(
      {
        messages: [new HumanMessage(testInput)],
        query: "",
        sentimentScore: 0,
        contentQuality: "",
        processingMetadata: { totalTime: 0, nodeCount: 0, lastNode: "" }
      },
      {
        configurable: { thread_id: threadId }
      }
    );
    
    console.log("\n✅ Unexpected success! The graph should have failed.");
    console.log("Result:", result);
    
  } catch (error) {
    console.log("\n❌ ERROR CAUGHT (This is expected!):");
    console.log("━".repeat(60));
    
    if (error instanceof Error) {
      console.log("Error Type:", error.constructor.name);
      console.log("Error Message:", error.message);
      
      if (error.message.includes("Invalid update for channel")) {
        console.log("\n🎯 This is the expected INVALID_CONCURRENT_GRAPH_UPDATE error!");
        console.log("\nWhy this happened:");
        console.log("1. No input/output schemas to restrict what subgraphs can read/write");
        console.log("2. All subgraphs write to the same channels (sentimentScore, etc.)");
        console.log("3. Parallel execution means multiple updates to the same channel");
        console.log("4. LangGraph can't merge conflicting updates without reducers");
        console.log("\n💡 Solution: Use input/output schemas - see index.ts for the fix!");
      }
    }
    
    console.log("━".repeat(60));
  }
}

/**
 * Summary: Why This Example Breaks
 * 
 * Without input/output schemas:
 * - Subgraphs have unrestricted access to all state channels
 * - Multiple subgraphs write to the same channels in parallel
 * - LangGraph detects conflicting updates and throws an error
 * 
 * The fix (see index.ts):
 * - Use input schemas to limit what subgraphs can read
 * - Use output schemas to control what subgraphs can write
 * - Ensure each subgraph writes to unique parent channels
 * - Add transformation nodes to map internal state to output
 */

if (require.main === module) {
  runBrokenDemo().catch(console.error);
}
