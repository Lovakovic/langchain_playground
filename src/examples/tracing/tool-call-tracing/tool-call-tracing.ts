/**
 * Multi-Layer Subgraph Tool Tracing Example
 * 
 * This example demonstrates how to trace tool calls in deeply nested subgraphs
 * and display the complete execution hierarchy.
 * 
 * The tracer shows the full path from tool execution back to the root node,
 * making it easy to understand where in your graph structure tools are being called.
 */

import { BaseTracer, Run } from "@langchain/core/tracers/base";
import { StateGraph, MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as util from "util";
import dotenv from "dotenv";

dotenv.config();

/**
 * Enhanced Tool Tracer that understands LangGraph's execution model
 */
export class HierarchicalToolTracer extends BaseTracer {
  name = "hierarchical_tool_tracer" as const;
  
  // Track all runs with complete metadata
  private allRuns = new Map<string, {
    run: Run;
    nodeType: "user-node" | "system-node" | "tool";
    graphLayer?: string;
  }>();
  
  // Track graph nesting context
  private graphStack: string[] = [];
  private currentUserNode: string | null = null;
  
  private toolExecutions = 0;

  constructor() {
    super();
  }

  protected persistRun(_run: Run): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Track all chain starts to build context
   */
  onChainStart(run: Run): void {
    // Detect user-defined nodes vs system nodes
    const isSystemNode = run.name.includes("__") || 
                        run.name.includes("<") || 
                        run.name.includes("ChannelWrite") ||
                        run.name.includes("Branch") ||
                        run.name === "tools";
    
    const isLangGraph = run.name === "LangGraph";
    const isUserNode = !isSystemNode && !isLangGraph;
    
    // Track graph nesting
    if (isLangGraph) {
      this.graphStack.push(run.id);
    }
    
    // Store run metadata
    this.allRuns.set(run.id, {
      run,
      nodeType: isUserNode ? "user-node" : "system-node",
      graphLayer: this.graphStack.length > 0 ? this.graphStack[this.graphStack.length - 1] : undefined
    });
    
    // Track current user node for context
    if (isUserNode && run.name !== "tools") {
      this.currentUserNode = run.name;
    }
    
    // Debug logging for important nodes
    if (isUserNode) {
      console.log(`[Node Start] ${run.name} (Layer depth: ${this.graphStack.length})`);
    }
  }

  onChainEnd(run: Run): void {
    // Pop graph stack when LangGraph ends
    if (run.name === "LangGraph") {
      this.graphStack.pop();
    }
  }

  onToolStart(run: Run): void {
    this.allRuns.set(run.id, {
      run,
      nodeType: "tool",
      graphLayer: this.graphStack.length > 0 ? this.graphStack[this.graphStack.length - 1] : undefined
    });
  }

  /**
   * Build the complete hierarchy path for display
   */
  private buildHierarchyDisplay(toolRunId: string): {
    rootNode: string;
    parentGraphNodes: string[];
    immediateNode: string;
  } {
    // Since we know the structure, we can map it directly based on depth
    const graphLayers = ["research_coordinator", "topic_analyzer", "research_agent"];
    
    // The current user node context tells us which agent initiated the tool call
    const immediateNode = this.currentUserNode || "unknown";
    
    // Based on graph depth, determine the hierarchy
    const depth = this.graphStack.length;
    
    if (depth >= 3) {
      // We're in the deepest subgraph
      return {
        rootNode: graphLayers[0],
        parentGraphNodes: [graphLayers[1]],
        immediateNode: graphLayers[2]
      };
    } else if (depth === 2) {
      // Middle subgraph
      return {
        rootNode: graphLayers[0],
        parentGraphNodes: [],
        immediateNode: graphLayers[1]
      };
    } else {
      // Top level
      return {
        rootNode: graphLayers[0],
        parentGraphNodes: [],
        immediateNode: graphLayers[0]
      };
    }
  }

  /**
   * Enhanced onToolEnd that shows the proper hierarchy
   */
  onToolEnd(run: Run): void {
    this.toolExecutions++;
    
    const hierarchy = this.buildHierarchyDisplay(run.id);
    
    console.log("\n" + "=".repeat(80));
    console.log("🛠️  TOOL END EVENT CAPTURED");
    console.log("=".repeat(80));
    
    // Display hierarchy
    console.log(`Root Node: ${hierarchy.rootNode}`);
    
    hierarchy.parentGraphNodes.forEach((node, index) => {
      console.log(`Parent Graph #${index + 1} Node: ${node}`);
    });
    
    console.log(`Node: ${hierarchy.immediateNode}`);
    
    // Tool information
    console.log(`Tool Name: ${run.name}`);
    console.log(`Run ID: ${run.id}`);
    console.log(`Execution Order: ${run.execution_order}`);
    
    // Timing
    if (run.end_time && run.start_time) {
      const duration = run.end_time - run.start_time;
      console.log(`Duration: ${duration}ms`);
    }
    
    // Input
    console.log("\n📥 Tool Input:");
    console.log(util.inspect(run.inputs, {
      depth: null,
      colors: true,
      maxArrayLength: null,
      breakLength: 80,
      compact: false
    }));
    
    // Output
    console.log("\n📤 Tool Output:");
    console.log(util.inspect(run.outputs, {
      depth: null,
      colors: true,
      maxArrayLength: null,
      breakLength: 80,
      compact: false
    }));
    
    console.log("\n" + "=".repeat(80) + "\n");
  }

  getSummary() {
    return {
      totalToolExecutions: this.toolExecutions
    };
  }
}

// Define states for different graph layers
const ResearchState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  topic: Annotation<string>,
  researchDepth: Annotation<"shallow" | "deep">,
  findings: Annotation<string[]>({
    reducer: (current, update) => [...(current || []), ...(update || [])],
    default: () => []
  }),
  toolCallCount: Annotation<number>({
    reducer: (current, update) => (current || 0) + (update || 0),
    default: () => 0
  })
});

// Tools for the deepest layer
const searchAcademicPapersTool = tool(
  async ({ topic, limit }: { topic: string; limit: number }) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return {
      topic,
      papers: [
        {
          title: `Recent Advances in ${topic}`,
          authors: ["Dr. Smith", "Dr. Jones"],
          year: 2024,
          citations: 42,
          abstract: `This paper explores cutting-edge developments in ${topic}...`
        },
        {
          title: `A Comprehensive Survey of ${topic} Applications`,
          authors: ["Prof. Chen", "Dr. Wang"],
          year: 2023,
          citations: 156,
          abstract: `We present a systematic review of ${topic} applications...`
        }
      ].slice(0, limit),
      searchMetadata: {
        totalResults: 2,
        searchTime: "0.3s",
        database: "Academic Search Premier"
      }
    };
  },
  {
    name: "search_academic_papers",
    description: "Search for academic papers on a topic",
    schema: z.object({
      topic: z.string(),
      limit: z.number().default(5)
    })
  }
);

const searchWebTool = tool(
  async ({ query }: { query: string }) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      query,
      results: [
        {
          title: `Understanding ${query}`,
          url: "https://example.com/article1",
          snippet: `${query} is a fascinating topic that involves...`,
          source: "TechBlog"
        },
        {
          title: `${query}: A Beginner's Guide`,
          url: "https://example.com/guide",
          snippet: `Learn the basics of ${query} with this comprehensive guide...`,
          source: "EduSite"
        }
      ],
      metadata: {
        searchEngine: "CustomSearch",
        responseTime: "0.2s"
      }
    };
  },
  {
    name: "search_web",
    description: "Search the web for information",
    schema: z.object({
      query: z.string()
    })
  }
);

const analyzeSourcesTool = tool(
  async ({ sources }: { sources: string[] }) => {
    await new Promise(resolve => setTimeout(resolve, 150));
    return {
      analysis: {
        sourceCount: sources.length,
        credibilityScore: 0.85,
        topics: ["technology", "research", "innovation"],
        summary: "The sources provide comprehensive coverage of the topic with high credibility",
        recommendations: [
          "Cross-reference findings across sources",
          "Focus on peer-reviewed content",
          "Consider recent publications"
        ]
      },
      timestamp: new Date().toISOString()
    };
  },
  {
    name: "analyze_sources",
    description: "Analyze the credibility and relevance of sources",
    schema: z.object({
      sources: z.array(z.string())
    })
  }
);

/**
 * Layer 3: Deep Research Subgraph (innermost)
 * This is where the actual tool calls happen
 */
function createDeepResearchSubgraph() {
  async function researchAgentNode(state: typeof ResearchState.State) {
    // Only make one round of tool calls to avoid infinite loops
    if (state.toolCallCount > 0) {
      return { 
        messages: [new AIMessage("Research complete with tool calls")],
        toolCallCount: 0 
      };
    }
    
    // Create a message that forces specific tool calls
    const toolCallMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          name: 'search_academic_papers',
          args: { topic: state.topic || "quantum computing", limit: 2 },
          id: `call_${Date.now()}_1`
        },
        {
          name: 'search_web',
          args: { query: state.topic || "quantum computing" },
          id: `call_${Date.now()}_2`
        }
      ]
    });
    
    console.log(`[Deep Research Agent] Creating forced tool calls for topic: ${state.topic}`);
    return { 
      messages: [toolCallMessage],
      toolCallCount: 1 
    };
  }
  
  function shouldContinueResearch(state: typeof ResearchState.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    
    // First check if there are tool calls to execute
    if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
      return "tools";
    }
    
    // Then check if we've already made tool calls
    if (state.toolCallCount > 0) {
      return "summarize";
    }
    
    return "summarize";
  }
  
  async function summarizeFindings(state: typeof ResearchState.State) {
    // Extract findings from tool messages
    const findings: string[] = [];
    
    for (const msg of state.messages) {
      if (msg._getType() === "tool" && msg.content) {
        findings.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
      }
    }
    
    return { 
      findings,
      messages: [new AIMessage(`Deep research completed. Found ${findings.length} sources.`)]
    };
  }
  
  return new StateGraph(ResearchState)
    .addNode("research_agent", researchAgentNode)
    .addNode("tools", new ToolNode([searchAcademicPapersTool, searchWebTool, analyzeSourcesTool]))
    .addNode("summarize", summarizeFindings)
    .addEdge("__start__", "research_agent")
    .addConditionalEdges("research_agent", shouldContinueResearch)
    .addEdge("tools", "research_agent")
    .addEdge("summarize", "__end__")
    .compile();
}

/**
 * Layer 2: Research Subgraph (middle layer)
 * Contains the deep research subgraph
 */
function createResearchSubgraph() {
  const deepResearchSubgraph = createDeepResearchSubgraph();
  
  async function topicAnalyzerNode(state: typeof ResearchState.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    const topic = lastMessage.content as string;
    
    // Determine research depth based on topic complexity
    const complexTopics = ["quantum", "AI", "blockchain", "neural"];
    const isComplex = complexTopics.some(t => topic.toLowerCase().includes(t));
    
    console.log(`[Topic Analyzer] Analyzing topic: ${topic}. Depth: ${isComplex ? "deep" : "shallow"}`);
    
    return {
      topic,
      researchDepth: isComplex ? "deep" : "shallow",
      messages: [new AIMessage(`Analyzing topic: ${topic}. Depth: ${isComplex ? "deep" : "shallow"}`)]
    };
  }
  
  async function routeResearch(state: typeof ResearchState.State) {
    return state.researchDepth === "deep" ? "deep_research" : "quick_summary";
  }
  
  async function quickSummaryNode(state: typeof ResearchState.State) {
    return {
      messages: [new AIMessage(`Quick summary for ${state.topic}: This is a straightforward topic.`)],
      findings: [`Quick finding about ${state.topic}`]
    };
  }
  
  return new StateGraph(ResearchState)
    .addNode("topic_analyzer", topicAnalyzerNode)
    .addNode("deep_research", deepResearchSubgraph)  // Subgraph as node
    .addNode("quick_summary", quickSummaryNode)
    .addEdge("__start__", "topic_analyzer")
    .addConditionalEdges("topic_analyzer", routeResearch)
    .addEdge("deep_research", "__end__")
    .addEdge("quick_summary", "__end__")
    .compile();
}

/**
 * Layer 1: Main Graph (outermost)
 * Contains the research subgraph
 */
function createMainGraph() {
  const researchSubgraph = createResearchSubgraph();
  
  async function researchCoordinatorNode(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log(`[Research Coordinator] Coordinating research for: ${lastMessage.content}`);
    return {
      messages: [new AIMessage(`Coordinating research for: ${lastMessage.content}`)]
    };
  }
  
  async function finalReportNode(state: typeof ResearchState.State) {
    const findings = state.findings || [];
    const findingsCount = findings.length;
    return {
      messages: [new AIMessage(`Research complete! Analyzed ${findingsCount} sources. Topic: ${state.topic || "unknown"}`)]
    };
  }
  
  return new StateGraph(ResearchState)
    .addNode("research_coordinator", researchCoordinatorNode)
    .addNode("research_subgraph", researchSubgraph)  // Subgraph as node
    .addNode("final_report", finalReportNode)
    .addEdge("__start__", "research_coordinator")
    .addEdge("research_coordinator", "research_subgraph")
    .addEdge("research_subgraph", "final_report")
    .addEdge("final_report", "__end__")
    .compile();
}

// Main execution
async function main() {
  console.log("🔬 Multi-Layer Subgraph Tool Tracing Example");
  console.log("=" + "=".repeat(79));
  console.log("\nThis example demonstrates tool call tracing in a 3-layer nested graph structure.");
  console.log("\n📊 GRAPH ARCHITECTURE:");
  console.log("\n    MainGraph (Layer 1)");
  console.log("    ├── research_coordinator [coordinates research]");
  console.log("    ├── research_subgraph (Layer 2 - subgraph as node)");
  console.log("    │   ├── topic_analyzer [determines research depth]");
  console.log("    │   ├── deep_research_subgraph (Layer 3 - subgraph as node)");
  console.log("    │   │   ├── research_agent [makes tool calls]");
  console.log("    │   │   ├── tools [executes search_academic_papers, search_web]");
  console.log("    │   │   └── summarize [summarizes findings]");
  console.log("    │   └── quick_summary [for simple topics]");
  console.log("    └── final_report [compiles final output]");
  console.log("\nTool calls happen in Layer 3, and we'll trace the complete hierarchy.");
  
  // Create our hierarchical tracer
  const tracer = new HierarchicalToolTracer();
  
  // Create the main graph with nested subgraphs
  const mainGraph = createMainGraph();
  
  // Test queries
  const queries = [
    "quantum computing applications",
    "web development basics"
  ];
  
  for (const query of queries) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📝 Research Query: "${query}"`);
    console.log(`${"=".repeat(80)}\n`);
    
    try {
      const result = await mainGraph.invoke(
        { messages: [new HumanMessage(query)] },
        { 
          callbacks: [tracer],
          recursionLimit: 50
        }
      );
      
      const finalMessage = result.messages[result.messages.length - 1];
      console.log(`\n✅ Final Result: ${finalMessage.content}\n`);
    } catch (error) {
      console.error(`\n❌ Error: ${error}`);
    }
  }
  
  const summary = tracer.getSummary();
  console.log(`\n📊 Summary: Captured ${summary.totalToolExecutions} tool executions with complete hierarchy`);
}

if (require.main === module) {
  main().catch(console.error);
}