/**
 * PostgresSaver Example: Multi-Step Research Assistant with Interrupts
 * 
 * This example demonstrates advanced LangGraph concepts:
 * - PostgreSQL-based checkpointing for workflow persistence
 * - Multi-step research workflow with real Tavily Search API
 * - Human-in-the-loop feedback using interrupt patterns
 * - Cost tracking and checkpoint management
 * - Proper interrupt/resume patterns (the tricky part!)
 * 
 * IMPORTANT: This example specifically addresses common misconceptions
 * about how interrupts work in LangGraph. Read the detailed comments
 * to understand the unexpected behaviors and correct patterns.
 * 
 * Architecture:
 * 1. Research workflow with 8 nodes (parse -> search -> analyze -> feedback -> report)
 * 2. PostgreSQL stores checkpoints after each node
 * 3. Interrupt at human feedback node for review
 * 4. Resume with user input using Command object
 */

import { Annotation, interrupt, StateGraph, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { TavilySearch } from "@langchain/tavily";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage } from "@langchain/core/messages";
import { Pool } from "pg";
import * as readline from "readline";
import dotenv from "dotenv";
import { ResearchMetadata, ResearchStatus, SearchResult, Source } from "./types";

dotenv.config();

/**
 * State Definition
 * 
 * The state accumulates data throughout the research workflow.
 * Each field uses appropriate reducers to handle updates:
 * - Default reducer: replaces value
 * - Array reducer: appends new items
 * - Number reducer: adds values (for counters)
 * 
 * This state is persisted to PostgreSQL after each node execution,
 * enabling resume from any point in the workflow.
 */
const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  subtopics: Annotation<string[]>({
    reducer: (a, b) => b.length > 0 ? b : a,
    default: () => []
  }),
  searches: Annotation<SearchResult[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  sources: Annotation<Source[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  summary: Annotation<string>({
    reducer: (_, b) => b,
    default: () => ""
  }),
  feedback: Annotation<string>({
    reducer: (_, b) => b,
    default: () => ""
  }),
  status: Annotation<ResearchStatus>({
    reducer: (_, b) => b,
    default: () => "parsing" as ResearchStatus
  }),
  searchCount: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0
  }),
  totalCost: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0
  }),
  metadata: Annotation<ResearchMetadata>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: 0
    })
  })
});

// Initialize LLM
function createLLM() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
      "Please set it to the path of your service account key file."
    );
  }

  return new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.7,
    streaming: true,
    maxRetries: 2,
  });
}

// Initialize Tavily search tool
function createSearchTool() {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY environment variable is not set.");
  }

  return new TavilySearch({
    maxResults: 5,
    tavilyApiKey: process.env.TAVILY_API_KEY
  });
}

// Node: Parse research topic into subtopics
async function parseTopicNode(state: typeof ResearchState.State) {
  console.log("\n🔍 Parsing research topic...");
  
  const llm = createLLM();
  const response = await llm.invoke([
    new HumanMessage(`Given the research topic: "${state.topic}", 
    identify 3-4 key subtopics or aspects to research. 
    Return them as a comma-separated list, no explanations.`)
  ]);
  
  const subtopics = response.content.toString()
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  console.log(`✅ Identified subtopics: ${subtopics.join(', ')}`);
  
  return {
    subtopics,
    status: "initial_search" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

// Node: Perform initial broad search
async function initialSearchNode(state: typeof ResearchState.State) {
  console.log(`\n🌐 Initial search: "${state.topic}"...`);
  
  const searchTool = createSearchTool();
  const startTime = Date.now();
  
  // Simulate API cost (Tavily charges per search)
  const cost = 0.05;
  
  try {
    const results = await searchTool.invoke({ query: state.topic });
    const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // TavilySearch returns an object with results array
    const parsedResults = results && typeof results === 'object' && 'results' in results
      ? (results.results as any[]).map((r: any) => ({
          title: r.title || "Untitled",
          url: r.url || "",
          content: r.content || "",
          score: r.score || 0
        }))
      : [];
    
    const searchResult: SearchResult = {
      query: state.topic,
      results: parsedResults.slice(0, 5),
      timestamp: new Date().toISOString(),
      cost
    };
    
    console.log(`✅ Found ${searchResult.results.length} results (${searchTime}s, $${cost.toFixed(2)})`);
    
    return {
      searches: [searchResult],
      searchCount: 1,
      totalCost: cost,
      status: "deep_diving" as ResearchStatus,
      metadata: {
        ...state.metadata,
        lastUpdateTime: new Date().toISOString(),
        checkpointCount: state.metadata.checkpointCount + 1
      }
    };
  } catch (error) {
    console.error("❌ Search failed:", error);
    throw error;
  }
}

// Node: Perform deep dive searches on subtopics
async function deepDiveSearchNode(state: typeof ResearchState.State) {
  const searchTool = createSearchTool();
  const searches: SearchResult[] = [];
  let totalCost = 0;
  
  for (let i = 0; i < state.subtopics.length; i++) {
    const subtopic = state.subtopics[i];
    const query = `${state.topic} ${subtopic}`;
    
    console.log(`\n🔎 Deep dive ${i + 1}/${state.subtopics.length}: "${query}"...`);
    
    const startTime = Date.now();
    const cost = 0.05;
    
    try {
      const results = await searchTool.invoke({ query });
      const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // TavilySearch returns an object with results array
      const parsedResults = results && typeof results === 'object' && 'results' in results
        ? (results.results as any[]).map((r: any) => ({
            title: r.title || "Untitled",
            url: r.url || "",
            content: r.content || "",
            score: r.score || 0
          }))
        : [];
      
      const searchResult: SearchResult = {
        query,
        results: parsedResults.slice(0, 5),
        timestamp: new Date().toISOString(),
        cost
      };
      
      searches.push(searchResult);
      totalCost += cost;
      
      console.log(`✅ Found ${searchResult.results.length} results (${searchTime}s, $${cost.toFixed(2)})`);
    } catch (error) {
      console.error(`❌ Search failed for "${subtopic}":`, error);
    }
  }
  
  return {
    searches,
    searchCount: searches.length,
    totalCost,
    status: "analyzing" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

// Node: Analyze and rank sources
async function analyzeSourcesNode(state: typeof ResearchState.State) {
  console.log("\n📊 Analyzing sources...");
  
  const sources: Source[] = [];
  const seenUrls = new Set<string>();
  
  // Extract unique sources from all searches
  for (const search of state.searches) {
    for (const result of search.results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        sources.push({
          title: result.title,
          url: result.url,
          relevanceScore: result.score,
          summary: result.content.substring(0, 200) + "...",
          searchQuery: search.query
        });
      }
    }
  }
  
  // Sort by relevance score
  sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  console.log(`✅ Analyzed ${sources.length} unique sources`);
  
  return {
    sources: sources.slice(0, 10), // Keep top 10 sources
    status: "summarizing" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

// Node: Generate research summary
async function generateSummaryNode(state: typeof ResearchState.State) {
  console.log("\n📝 Generating research summary...");
  
  const llm = createLLM();
  
  const sourcesText = state.sources
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.title}\n   ${s.summary}`)
    .join('\n\n');
  
  const prompt = `Based on the research about "${state.topic}", create a comprehensive summary.
  
Top sources:
${sourcesText}

Subtopics researched: ${state.subtopics.join(', ')}
Total sources analyzed: ${state.sources.length}

Please provide a well-structured summary covering key findings, trends, and insights.`;
  
  const response = await llm.invoke([new HumanMessage(prompt)]);
  const summary = response.content.toString();
  
  console.log("✅ Summary generated");
  
  return {
    summary,
    status: "awaiting_feedback" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

/**
 * Human Feedback Node - The Heart of Interrupt Pattern
 * 
 * CRITICAL UNDERSTANDING:
 * 1. The interrupt() function does NOT throw an error when called
 * 2. Instead, it pauses the graph execution and saves state
 * 3. The graph.invoke() call completes "successfully" but leaves the graph paused
 * 4. You must check graph.getState() after invoke to detect interrupts
 * 
 * COMMON MISCONCEPTIONS:
 * - ❌ Expecting interrupt() to throw an error you can catch
 * - ❌ Using try/catch around graph.invoke() to detect interrupts
 * - ❌ Expecting error.name === "GraphInterrupt" in the catch block
 * 
 * CORRECT PATTERN:
 * - ✅ Let graph.invoke() complete normally
 * - ✅ Check state.tasks for pending interrupts
 * - ✅ Use Command({ resume: value }) to continue
 * 
 * The value passed to interrupt() is stored but not used for display.
 * The main flow handles showing the summary to the user.
 */
async function humanFeedbackNode(state: typeof ResearchState.State) {
  // This interrupt pauses execution but does NOT throw an error!
  // The graph will complete the invoke() call and leave this node pending
  const feedback = await interrupt("awaiting_feedback");
  
  // This code only runs when the graph resumes with user feedback
  if (feedback === "continue") {
    return {
      status: "complete" as ResearchStatus,
      metadata: {
        ...state.metadata,
        lastUpdateTime: new Date().toISOString(),
        checkpointCount: state.metadata.checkpointCount + 1
      }
    };
  }
  
  return {
    feedback: feedback as string,
    status: "refining" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

// Node: Refine research based on feedback
async function refineResearchNode(state: typeof ResearchState.State) {
  console.log(`\n🔄 Refining research based on feedback: "${state.feedback}"`);
  
  const searchTool = createSearchTool();
  const startTime = Date.now();
  const cost = 0.05;
  
  try {
    const results = await searchTool.invoke({ query: `${state.topic} ${state.feedback}` });
    const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // TavilySearch returns an object with results array
    const parsedResults = results && typeof results === 'object' && 'results' in results
      ? (results.results as any[]).map((r: any) => ({
          title: r.title || "Untitled",
          url: r.url || "",
          content: r.content || "",
          score: r.score || 0
        }))
      : [];
    
    const searchResult: SearchResult = {
      query: `${state.topic} ${state.feedback}`,
      results: parsedResults.slice(0, 5),
      timestamp: new Date().toISOString(),
      cost
    };
    
    console.log(`✅ Found ${searchResult.results.length} results (${searchTime}s, $${cost.toFixed(2)})`);
    
    // Add new sources
    const newSources: Source[] = searchResult.results.map(r => ({
      title: r.title,
      url: r.url,
      relevanceScore: r.score,
      summary: r.content.substring(0, 200) + "...",
      searchQuery: searchResult.query
    }));
    
    return {
      searches: [searchResult],
      sources: newSources,
      searchCount: 1,
      totalCost: cost,
      status: "complete" as ResearchStatus,
      metadata: {
        ...state.metadata,
        lastUpdateTime: new Date().toISOString(),
        checkpointCount: state.metadata.checkpointCount + 1
      }
    };
  } catch (error) {
    console.error("❌ Refinement search failed:", error);
    return {
      status: "complete" as ResearchStatus,
      metadata: {
        ...state.metadata,
        lastUpdateTime: new Date().toISOString(),
        checkpointCount: state.metadata.checkpointCount + 1
      }
    };
  }
}

// Node: Generate final report
async function finalReportNode(state: typeof ResearchState.State) {
  console.log("\n📄 Generating final report...");
  
  const llm = createLLM();
  
  const prompt = `Create a final research report on "${state.topic}".
  
Previous summary:
${state.summary}

${state.feedback ? `Additional research based on feedback "${state.feedback}"` : ''}

Total searches: ${state.searchCount}
Total sources: ${state.sources.length}
Research cost: $${state.totalCost.toFixed(2)}

Provide a comprehensive final report.`;
  
  const response = await llm.invoke([new HumanMessage(prompt)]);
  const finalReport = response.content.toString();
  
  console.log("✅ Research complete!");
  console.log("\n=== FINAL REPORT ===");
  console.log(finalReport);
  console.log("\n💰 Total cost: $" + state.totalCost.toFixed(2));
  console.log(`📍 Total checkpoints: ${state.metadata.checkpointCount + 1}`);
  
  return {
    summary: finalReport,
    status: "complete" as ResearchStatus,
    metadata: {
      ...state.metadata,
      lastUpdateTime: new Date().toISOString(),
      checkpointCount: state.metadata.checkpointCount + 1
    }
  };
}

/**
 * Research Workflow Construction
 * 
 * The workflow follows a linear path until the human feedback node:
 * 1. parse_topic: Extract subtopics from research query
 * 2. initial_search: Broad search on main topic
 * 3. deep_dive: Detailed searches on each subtopic
 * 4. analyze_sources: Deduplicate and rank results
 * 5. generate_summary: Create initial summary
 * 6. human_feedback: INTERRUPT POINT - wait for user input
 * 7. refine_research: (optional) Additional search based on feedback
 * 8. final_report: Generate comprehensive report
 * 
 * INTERRUPT BEHAVIOR:
 * - The workflow pauses at human_feedback node
 * - State is saved to PostgreSQL
 * - graph.invoke() returns without error
 * - Must check state.tasks to detect the interrupt
 */
function buildResearchWorkflow() {
  const workflow = new StateGraph(ResearchState)
    .addNode("parse_topic", parseTopicNode)
    .addNode("initial_search", initialSearchNode)
    .addNode("deep_dive", deepDiveSearchNode)
    .addNode("analyze_sources", analyzeSourcesNode)
    .addNode("generate_summary", generateSummaryNode)
    .addNode("human_feedback", humanFeedbackNode)
    .addNode("refine_research", refineResearchNode)
    .addNode("final_report", finalReportNode)
    .addEdge("__start__", "parse_topic")
    .addEdge("parse_topic", "initial_search")
    .addEdge("initial_search", "deep_dive")
    .addEdge("deep_dive", "analyze_sources")
    .addEdge("analyze_sources", "generate_summary")
    .addEdge("generate_summary", "human_feedback")
    // Conditional routing based on feedback
    .addConditionalEdges("human_feedback", (state) => {
      return state.status === "refining" ? "refine_research" : "final_report";
    })
    .addEdge("refine_research", "final_report")
    .addEdge("final_report", "__end__");
  
  return workflow;
}

// Helper to format checkpoint info
function formatCheckpoint(checkpointTuple: any, index: number) {
  const state = checkpointTuple.checkpoint?.channel_values || {};
  const metadata = checkpointTuple.metadata || {};
  const createdAt = checkpointTuple.checkpoint?.ts || "Unknown";
  const threadId = checkpointTuple.config?.configurable?.thread_id || "Unknown";
  
  // Format timestamp to be more readable
  let formattedTime = createdAt;
  try {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 60) {
      formattedTime = `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      formattedTime = `${diffHours} hours ago`;
    } else {
      formattedTime = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
  } catch (e) {
    // Keep original if parsing fails
  }
  
  return `${index + 1}. "${state.topic || 'Unknown'}" - ${state.status || 'Unknown'}
   Progress: ${state.metadata?.checkpointCount || 0} checkpoints | $${(state.totalCost || 0).toFixed(2)} spent
   Started: ${formattedTime}`;
}

// Main CLI application
async function main() {
  console.log("=== Research Assistant with PostgresSaver ===");
  console.log("Using PostgreSQL on port 15432");
  console.log("\nMake sure Docker container is running:");
  console.log("cd src/examples/postgres-saver && docker-compose up -d\n");
  
  // Initialize PostgreSQL connection
  const pool = new Pool({
    connectionString: "postgresql://langgraph:langgraph@localhost:15432/checkpoints"
  });
  
  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log("✅ Connected to PostgreSQL");
  } catch (error) {
    console.error("❌ Failed to connect to PostgreSQL:", error);
    console.log("\nPlease ensure the Docker container is running:");
    console.log("cd src/examples/postgres-saver && docker-compose up -d");
    process.exit(1);
  }
  
  // Initialize checkpointer
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  console.log("✅ PostgresSaver initialized\n");
  
  /**
   * Workflow Compilation
   * 
   * IMPORTANT: We do NOT use interruptBefore or interruptAfter config!
   * The interrupt is handled INSIDE the humanFeedbackNode using await interrupt().
   * 
   * Common mistake: Trying to use { interruptBefore: ["human_feedback"] }
   * This is unnecessary when using interrupt() inside the node.
   */
  const workflow = buildResearchWorkflow();
  const graph = workflow.compile({ checkpointer });
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };
  
  while (true) {
    console.log("\n1. New Research");
    console.log("2. Resume Research");
    console.log("3. List Sessions");
    console.log("4. Export Results");
    console.log("5. Exit");
    
    const choice = await question("\n> ");
    
    if (choice === "1") {
      // New research
      const topic = await question("\nEnter research topic: ");
      const threadId = `research-${Date.now()}`;
      
      /**
       * NEW RESEARCH INTERRUPT PATTERN
       * 
       * This is the KEY INSIGHT that makes interrupts work properly:
       * 
       * 1. graph.invoke() completes WITHOUT throwing an error
       * 2. The graph pauses at the interrupt but doesn't indicate this via exceptions
       * 3. We MUST check the state after invoke to detect interrupts
       * 
       * The pattern:
       * - Call graph.invoke() normally (no try/catch needed for interrupts)
       * - Call graph.getState() to check if we're paused
       * - Look for state.tasks with interrupts property
       * - If interrupted, show UI and get user input
       * - Resume with new Command({ resume: userInput })
       */
      
      // Initial invocation - this will pause at the interrupt
      await graph.invoke(
        { topic },
        { configurable: { thread_id: threadId } }
      );
      
      // CRITICAL: Check if we're interrupted by examining the state
      const currentState = await graph.getState({ 
        configurable: { thread_id: threadId } 
      });
      
      // Detect interrupt: pending tasks with interrupts property
      if (currentState.tasks.length > 0 && currentState.tasks[0].interrupts?.length > 0) {
        // We're paused at human_feedback node
        console.log("\n=== RESEARCH SUMMARY ===");
        console.log(currentState.values.summary);
        console.log("\n💰 Total cost so far: $" + currentState.values.totalCost.toFixed(2));
        console.log(`📊 Searches performed: ${currentState.values.searchCount}`);
        console.log(`📍 Checkpoints saved: ${currentState.values.metadata.checkpointCount}`);
        
        const feedback = await question("\nPlease review and provide feedback (or 'continue' to finalize): ");
        
        /**
         * RESUME PATTERN: Use Command object
         * 
         * The Command object with { resume: value } is the ONLY way to
         * properly resume from an interrupt. The value is passed to the
         * interrupted node as the return value of await interrupt().
         */
        await graph.invoke(
          new Command({ resume: feedback }),
          { configurable: { thread_id: threadId } }
        );
        
        console.log("\n✅ Research completed!");
      }
      
    } else if (choice === "2") {
      // Resume research
      const allCheckpoints = [];
      const limit = 50; // Get more to ensure we have all threads
      
      console.log("\nFetching recent sessions...");
      
      for await (const checkpoint of checkpointer.list({}, { limit })) {
        allCheckpoints.push(checkpoint);
      }
      
      if (allCheckpoints.length === 0) {
        console.log("No sessions found.");
        continue;
      }
      
      // Group by thread ID and get only the latest checkpoint per thread
      const threadMap = new Map<string, any>();
      for (const checkpoint of allCheckpoints) {
        const threadId = checkpoint.config?.configurable?.thread_id;
        if (threadId && !threadMap.has(threadId)) {
          threadMap.set(threadId, checkpoint);
        }
      }
      
      const uniqueThreads = Array.from(threadMap.values());
      
      console.log("\nSelect session to resume:");
      uniqueThreads.forEach((thread, i) => {
        console.log(formatCheckpoint(thread, i));
      });
      
      const selection = await question("\n> ");
      const index = parseInt(selection) - 1;
      
      if (index >= 0 && index < uniqueThreads.length) {
        const thread = uniqueThreads[index];
        const threadId = thread.config.configurable?.thread_id;
        
        // Get current state
        const currentState = await graph.getState({ 
          configurable: { thread_id: threadId } 
        });
        
        if (currentState.values.totalCost > 0) {
          console.log(`\n✨ Restored from checkpoint!`);
          console.log(`💰 Previous searches preserved (saved $${currentState.values.totalCost.toFixed(2)})`);
        }
        
        /**
         * RESUME RESEARCH PATTERN
         * 
         * When resuming, we need to handle two scenarios:
         * 1. Graph is paused at interrupt (status === "awaiting_feedback")
         * 2. Graph is at any other state
         * 
         * For interrupted graphs:
         * - The summary is already generated and stored in state
         * - We show it to the user and collect feedback
         * - Resume with Command({ resume: feedback })
         * 
         * For non-interrupted graphs:
         * - Simply invoke with null to continue from last checkpoint
         * - The graph will run until completion or next interrupt
         */
        
        // Check if we're at the human feedback interrupt
        if (currentState.values.status === "awaiting_feedback") {
          // Graph is paused at human_feedback node
          console.log("\n=== RESEARCH SUMMARY ===");
          console.log(currentState.values.summary);
          console.log("\n💰 Total cost so far: $" + currentState.values.totalCost.toFixed(2));
          console.log(`📊 Searches performed: ${currentState.values.searchCount}`);
          console.log(`📍 Checkpoints saved: ${currentState.values.metadata.checkpointCount}`);
          
          const feedback = await question("\nPlease review and provide feedback (or 'continue' to finalize): ");
          
          // Resume from interrupt with Command object
          await graph.invoke(
            new Command({ resume: feedback }),
            { configurable: { thread_id: threadId } }
          );
          
          console.log("\n✅ Research completed!");
        } else {
          // Not at interrupt, resume normally
          await graph.invoke(
            null, // null input resumes from last checkpoint
            { configurable: { thread_id: threadId } }
          );
          
          // After resuming, check if we hit an interrupt
          const newState = await graph.getState({ 
            configurable: { thread_id: threadId } 
          });
          
          // If we hit an interrupt during resume, handle it
          if (newState.tasks.length > 0 && newState.tasks[0].interrupts?.length > 0) {
            console.log("\n📍 Session paused. Use 'Resume Research' to continue.");
          } else {
            console.log("\n✅ Research completed!");
          }
        }
      }
      
    } else if (choice === "3") {
      // List sessions
      console.log("\nRecent research sessions:");
      const allCheckpoints = [];
      const limit = 100;
      
      for await (const checkpoint of checkpointer.list({}, { limit })) {
        allCheckpoints.push(checkpoint);
      }
      
      if (allCheckpoints.length === 0) {
        console.log("No sessions found.");
      } else {
        // Group by thread ID
        const threadGroups = new Map<string, any[]>();
        for (const checkpoint of allCheckpoints) {
          const threadId = checkpoint.config?.configurable?.thread_id;
          if (threadId) {
            if (!threadGroups.has(threadId)) {
              threadGroups.set(threadId, []);
            }
            threadGroups.get(threadId)!.push(checkpoint);
          }
        }
        
        // Display grouped sessions
        let sessionIndex = 0;
        for (const [threadId, checkpoints] of threadGroups) {
          const latestCheckpoint = checkpoints[0]; // First is most recent
          console.log(`\n${sessionIndex + 1}. Thread: ${threadId}`);
          console.log(`   Topic: "${latestCheckpoint.checkpoint?.channel_values?.topic || 'Unknown'}"`);
          console.log(`   Latest Status: ${latestCheckpoint.checkpoint?.channel_values?.status || 'Unknown'}`);
          console.log(`   Total Checkpoints: ${checkpoints.length}`);
          console.log(`   Cost: $${(latestCheckpoint.checkpoint?.channel_values?.totalCost || 0).toFixed(2)}`);
          console.log(`   Created: ${latestCheckpoint.checkpoint?.ts || 'Unknown'}`);
          sessionIndex++;
        }
      }
      
    } else if (choice === "4") {
      // Export results
      console.log("\nExport feature coming soon!");
      
    } else if (choice === "5") {
      // Exit
      console.log("\nGoodbye!");
      await pool.end();
      rl.close();
      break;
    }
  }
}

// Run the application
if (require.main === module) {
  main().catch(console.error);
}

/**
 * KEY TAKEAWAYS: Interrupt Patterns in LangGraph
 * 
 * This example reveals critical insights about LangGraph interrupts that
 * differ from common expectations:
 * 
 * 1. INTERRUPTS DON'T THROW ERRORS
 *    - await interrupt() pauses the graph but doesn't throw
 *    - graph.invoke() completes "successfully" even when interrupted
 *    - You cannot use try/catch to detect interrupts
 * 
 * 2. DETECTING INTERRUPTS
 *    - After graph.invoke(), call graph.getState()
 *    - Check state.tasks for pending tasks with interrupts
 *    - Alternative: Check your custom state fields (e.g., status)
 * 
 * 3. RESUMING FROM INTERRUPTS
 *    - Use new Command({ resume: value }) to continue
 *    - The value is passed to the interrupted node
 *    - Never use graph.updateState() for resuming
 * 
 * 4. CHECKPOINTER CONFIGURATION
 *    - A checkpointer is REQUIRED for interrupts to work
 *    - Don't use interruptBefore/interruptAfter when using await interrupt()
 *    - Each node execution creates a checkpoint automatically
 * 
 * 5. COMMON PITFALLS TO AVOID
 *    - ❌ Expecting GraphInterrupt error in catch block
 *    - ❌ Using graph.updateState() to pass feedback
 *    - ❌ Forgetting to check state after invoke()
 *    - ❌ Using Command({ resume: undefined }) - causes error
 * 
 * 6. PERSISTENCE BENEFITS
 *    - Checkpoints enable resume after system crashes
 *    - Cost tracking shows API savings when resuming
 *    - State evolution requires migration planning
 *    - PostgreSQL provides ACID guarantees
 * 
 * This pattern enables robust human-in-the-loop workflows where:
 * - Long-running processes can pause for human input
 * - State is preserved across interruptions
 * - Multiple users can review and continue workflows
 * - System failures don't lose progress
 */
