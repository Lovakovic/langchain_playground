# Langgraph Streaming Guide

A comprehensive guide to streaming outputs from Langgraph applications in real-time.

## Overview

LangGraph is built with first-class support for streaming, enabling responsive applications that show progressive outputs as they're generated. This guide covers all streaming modes and patterns for effectively streaming data from your graphs.

## Key Concepts

### Streaming Modes

LangGraph supports several streaming modes through the `.stream()` method:

- **`values`** - Stream the full state after each node execution
- **`updates`** - Stream only the state updates after each node execution
- **`custom`** - Stream custom data from inside graph nodes
- **`messages`** - Stream LLM tokens and message chunks
- **`debug`** - Stream detailed execution information

### Streaming APIs

- **`.stream()`** - Primary method for streaming graph outputs
- **`.streamEvents()`** - Stream granular events from within the graph execution

## Basic Graph Setup

Before diving into streaming examples, let's set up a basic agent graph:

```javascript
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Define state
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

// Create tools
const searchTool = tool(
  async ({ query }: { query: string }) => {
    // Placeholder implementation
    return "Cold, with a low of 3℃";
  },
  {
    name: "search",
    description: "Search for information",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

const tools = [searchTool];
const toolNode = new ToolNode(tools);

// Set up model
const model = new ChatOpenAI({ 
  model: "gpt-4o-mini",
  temperature: 0 
});
const boundModel = model.bindTools(tools);

// Define routing logic
const routeMessage = (state: typeof StateAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  if (!lastMessage?.tool_calls?.length) {
    return END;
  }
  return "tools";
};

// Define nodes
const callModel = async (state: typeof StateAnnotation.State) => {
  const { messages } = state;
  const responseMessage = await boundModel.invoke(messages);
  return { messages: [responseMessage] };
};

// Build graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeMessage)
  .addEdge("tools", "agent");

const graph = workflow.compile();
```

## Streaming Modes

### 1. Stream Values (`streamMode: "values"`)

Streams the complete state after each node execution:

```javascript
const inputs = { 
  messages: [{ role: "user", content: "what's the weather in sf" }] 
};

for await (const chunk of await graph.stream(inputs, {
  streamMode: "values",
})) {
  console.log("Full state:", chunk["messages"]);
  console.log("\n====\n");
}

// Output:
// Full state: [{ role: "user", content: "what's the weather in sf" }]
// ====
// Full state: [{ role: "user", content: "..." }, AIMessage { tool_calls: [...] }]
// ====
// Full state: [{ role: "user", content: "..." }, AIMessage {...}, ToolMessage {...}]
// ====
// Full state: [{ role: "user", content: "..." }, AIMessage {...}, ToolMessage {...}, AIMessage { content: "The weather in SF is cold, 3℃" }]
```

### 2. Stream Updates (`streamMode: "updates"`)

Streams only the changes to state from each node:

```javascript
for await (const chunk of await graph.stream(inputs, {
  streamMode: "updates",
})) {
  for (const [node, values] of Object.entries(chunk)) {
    console.log(`Update from node: ${node}`);
    console.log(values);
    console.log("\n====\n");
  }
}

// Output:
// Update from node: agent
// { messages: [AIMessage { tool_calls: [...] }] }
// ====
// Update from node: tools
// { messages: [ToolMessage { content: "Cold, with a low of 3℃" }] }
// ====
// Update from node: agent
// { messages: [AIMessage { content: "The weather in SF is cold..." }] }
```

### 3. Stream Messages (`streamMode: "messages"`)

Streams LLM tokens as they're generated:

```javascript
import { isAIMessageChunk } from "@langchain/core/messages";

const stream = await graph.stream(inputs, { 
  streamMode: "messages" 
});

for await (const [message, metadata] of stream) {
  if (isAIMessageChunk(message)) {
    if (message.tool_call_chunks?.length) {
      console.log("Tool call chunk:", message.tool_call_chunks[0].args);
    } else {
      console.log("Content:", message.content);
    }
  }
}

// Output:
// Tool call chunk: {"
// Tool call chunk: query
// Tool call chunk: ":"
// Tool call chunk: current
// Tool call chunk: weather
// Tool call chunk: in
// Tool call chunk: San Francisco
// Tool call chunk: "}
// Content: The
// Content: weather
// Content: in
// Content: San
// Content: Francisco
// Content: is
// Content: cold
// ...
```

### 4. Stream Debug (`streamMode: "debug"`)

Provides detailed execution information:

```javascript
const debugStream = await graph.stream(inputs, { 
  streamMode: "debug" 
});

for await (const chunk of debugStream) {
  console.log("Debug event:", chunk);
}

// Output includes:
// - Task starts/completions
// - Node executions
// - State updates
// - Timing information
```

### 5. Stream Multiple Modes

You can stream multiple modes simultaneously:

```javascript
const multiStream = await graph.stream(inputs, {
  streamMode: ["updates", "debug", "messages"],
});

for await (const chunk of multiStream) {
  console.log(`Event type: ${chunk[0]}`);
  console.log("Data:", chunk[1]);
  console.log("\n====\n");
}

// Output:
// Event type: debug
// Data: { type: 'task', step: 1, payload: {...} }
// ====
// Event type: updates
// Data: { agent: { messages: [AIMessage {...}] } }
// ====
// Event type: messages
// Data: [AIMessageChunk {...}, {...}]
```

## Stream Events API

The `.streamEvents()` method provides granular control over event streaming:

```javascript
const eventStream = await graph.streamEvents(
  { messages: [{ role: "user", content: "Hi!" }] },
  { version: "v2" }  // Required version parameter
);

for await (const event of eventStream) {
  const { event: eventType, name, data } = event;
  console.log(`${eventType}: ${name}`);
  
  if (eventType === "on_chat_model_stream") {
    console.log("Token:", data.chunk.content);
  }
}

// Output:
// on_chain_start: LangGraph
// on_chain_start: __start__
// on_chain_end: __start__
// on_chain_start: callModel
// on_chat_model_start: ChatOpenAI
// on_chat_model_stream: ChatOpenAI
// Token: Hello
// on_chat_model_stream: ChatOpenAI
// Token: !
// ...
```

### Event Types

| Event | Description | Data Format |
|-------|-------------|-------------|
| `on_chain_start` | Node/graph starts | `{ input: any }` |
| `on_chain_stream` | Node produces output | Partial results |
| `on_chain_end` | Node/graph completes | Final output |
| `on_chat_model_start` | LLM invocation starts | Input messages |
| `on_chat_model_stream` | LLM token generated | `AIMessageChunk` |
| `on_chat_model_end` | LLM invocation ends | Complete message |
| `on_tool_start` | Tool execution starts | Tool arguments |
| `on_tool_end` | Tool execution ends | Tool result |

### Filtering Events

Filter events by tags, names, or types:

```javascript
// Filter by tags
const taggedStream = await graph.streamEvents(
  inputs,
  { version: "v2" },
  { includeTags: ["my_tag"] }
);

// Filter by names
const namedStream = await graph.streamEvents(
  inputs,
  { version: "v2" },
  { includeNames: ["agent", "tools"] }
);

// Filter by types
const typeStream = await graph.streamEvents(
  inputs,
  { version: "v2" },
  { includeTypes: ["chat_model"] }
);
```

## Advanced Streaming Patterns

### Stream Events from Within Tools

Stream LLM events from tools that call models:

```javascript
import { ChatPromptTemplate } from "@langchain/core/prompts";

const analysisTool = tool(
  async (input, config) => {
    const template = ChatPromptTemplate.fromMessages([
      ["human", "Analyze this topic: {topic}"],
    ]);
    
    // Tag the model for filtering
    const modelWithConfig = model.withConfig({
      runName: "Analysis LLM",
      tags: ["tool_llm"],
    });
    
    const chain = template.pipe(modelWithConfig);
    const result = await chain.invoke(input, config);
    return result.content;
  },
  {
    name: "analyze",
    description: "Analyze a topic",
    schema: z.object({
      topic: z.string(),
    }),
  }
);

// Stream only tool LLM events
const toolEventStream = await graph.streamEvents(
  inputs,
  { version: "v2" },
  { includeTags: ["tool_llm"] }
);

for await (const event of toolEventStream) {
  if (event.event === "on_chat_model_stream") {
    console.log("Tool LLM:", event.data.chunk.content);
  }
}
```

### Stream from Final Node Only

Common pattern for streaming only the final response:

```javascript
const finalModel = new ChatOpenAI({
  model: "gpt-4o-mini",
}).withConfig({
  tags: ["final_node"],
});

const finalNode = async (state) => {
  const messages = state.messages;
  const response = await finalModel.invoke(messages);
  return { messages: [response] };
};

const graphWithFinal = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addNode("final", finalNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", (state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    return lastMsg.tool_calls?.length ? "tools" : "final";
  })
  .addEdge("tools", "agent")
  .addEdge("final", END)
  .compile();

// Stream only final node output
const finalStream = await graphWithFinal.streamEvents(
  inputs,
  { version: "v2" }
);

for await (const { event, tags, data } of finalStream) {
  if (event === "on_chat_model_stream" && tags.includes("final_node")) {
    if (data.chunk.content) {
      console.log(data.chunk.content);
    }
  }
}
```

### Disable Streaming for Specific Nodes

Use the "nostream" tag to exclude nodes from streaming:

```javascript
import { RunnableLambda } from "@langchain/core/runnables";

const unstreamed = async (state) => {
  const result = await expensiveOperation(state);
  console.log("This won't be streamed:", result);
  return { data: result };
};

const graphWithNoStream = new StateGraph(StateAnnotation)
  .addNode(
    "unstreamed",
    RunnableLambda.from(unstreamed).withConfig({
      tags: ["nostream"]
    })
  )
  .addNode("streamed", streamedNode)
  .addEdge(START, "unstreamed")
  .addEdge("unstreamed", "streamed")
  .addEdge("streamed", END)
  .compile();

// The unstreamed node output won't appear in the stream
const stream = await graphWithNoStream.stream(inputs, {
  streamMode: "messages"
});
```

### Custom Event Dispatching

Emit custom events from within nodes:

```javascript
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

const progressNode = async (state) => {
  // Dispatch progress updates
  await dispatchCustomEvent("progress", {
    step: "starting",
    progress: 0
  });
  
  // Do some work...
  await processData(state);
  
  await dispatchCustomEvent("progress", {
    step: "processing",
    progress: 0.5
  });
  
  // More work...
  const result = await finalizeData(state);
  
  await dispatchCustomEvent("progress", {
    step: "complete",
    progress: 1.0
  });
  
  return { result };
};

// Listen for custom events
const customEventStream = await graph.streamEvents(inputs, { version: "v2" });

for await (const event of customEventStream) {
  if (event.event === "on_custom_event" && event.name === "progress") {
    console.log("Progress:", event.data);
  }
}
```

## Working with Message Chunks

### Aggregating Streamed Messages

```javascript
const chunks = [];
const stream = await graph.stream(inputs, { streamMode: "messages" });

for await (const [chunk, metadata] of stream) {
  if (isAIMessageChunk(chunk)) {
    chunks.push(chunk);
    
    // Aggregate chunks for progressive display
    const aggregated = chunks.reduce(
      (acc, c) => acc.concat(c), 
      chunks[0]
    );
    console.log("So far:", aggregated.content);
  }
}

// Get final complete message
const finalMessage = chunks.reduce((acc, chunk) => acc.concat(chunk));
```

### Handling Tool Call Chunks

```javascript
const toolCallChunks = [];

for await (const [chunk, metadata] of stream) {
  if (isAIMessageChunk(chunk) && chunk.tool_call_chunks?.length) {
    toolCallChunks.push(...chunk.tool_call_chunks);
    
    // Try to parse accumulated tool call
    try {
      const accumulated = toolCallChunks
        .map(tc => tc.args)
        .join("");
      const parsed = JSON.parse(accumulated);
      console.log("Tool call so far:", parsed);
    } catch (e) {
      // Still accumulating
    }
  }
}
```

## Performance Optimization

### Efficient Chunk Processing

```javascript
// Good: Lightweight processing
for await (const chunk of stream) {
  // Quick operations only
  displayText += chunk.content;
  updateUI(displayText);
}

// Bad: Heavy processing blocks upstream
for await (const chunk of stream) {
  // Avoid expensive operations
  await expensiveAPICall(chunk);  // This blocks the stream!
  await complexDOMManipulation(chunk);
}
```

### Batching Updates

```javascript
const batchSize = 5;
const buffer = [];

for await (const chunk of stream) {
  buffer.push(chunk);
  
  if (buffer.length >= batchSize) {
    // Process batch efficiently
    await processBatch(buffer);
    buffer.length = 0;
  }
}

// Process remaining
if (buffer.length > 0) {
  await processBatch(buffer);
}
```

## Error Handling

### Stream-Level Errors

```javascript
try {
  const stream = await graph.stream(inputs, { streamMode: "messages" });
  
  for await (const chunk of stream) {
    processChunk(chunk);
  }
} catch (streamError) {
  console.error("Stream initialization failed:", streamError);
  // Handle graph-level errors
}
```

### Chunk-Level Errors

```javascript
const stream = await graph.stream(inputs, { streamMode: "messages" });

for await (const chunk of stream) {
  try {
    processChunk(chunk);
  } catch (chunkError) {
    console.error("Chunk processing error:", chunkError);
    // Continue processing other chunks
  }
}
```

### Graceful Degradation

```javascript
const streamWithFallback = async (inputs) => {
  try {
    // Try streaming first
    const stream = await graph.stream(inputs, { streamMode: "messages" });
    
    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (error) {
    console.warn("Streaming failed, falling back to invoke:", error);
    
    // Fall back to non-streaming
    const result = await graph.invoke(inputs);
    yield [result, {}];
  }
};
```

## Real-World Example: Streaming Chat Interface

```javascript
import { isAIMessageChunk, isToolMessage } from "@langchain/core/messages";

class StreamingChatInterface {
  constructor(graph) {
    this.graph = graph;
    this.messageBuffer = "";
    this.toolCallBuffer = [];
  }

  async streamResponse(userInput) {
    const inputs = { 
      messages: [{ role: "user", content: userInput }] 
    };

    try {
      const stream = await this.graph.stream(inputs, {
        streamMode: ["messages", "updates"]
      });

      for await (const [event, data] of stream) {
        if (event === "messages") {
          await this.handleMessageChunk(data[0]);
        } else if (event === "updates") {
          await this.handleStateUpdate(data);
        }
      }
      
      return this.messageBuffer;
    } catch (error) {
      console.error("Streaming error:", error);
      throw error;
    }
  }

  async handleMessageChunk(chunk) {
    if (isAIMessageChunk(chunk)) {
      if (chunk.content) {
        this.messageBuffer += chunk.content;
        this.updateUI(this.messageBuffer);
      }
      
      if (chunk.tool_call_chunks?.length) {
        this.toolCallBuffer.push(...chunk.tool_call_chunks);
        this.showToolCallProgress();
      }
    }
  }

  async handleStateUpdate(update) {
    // Handle node completions
    for (const [node, values] of Object.entries(update)) {
      if (node === "tools" && values.messages) {
        this.showToolResults(values.messages);
      }
    }
  }

  updateUI(content) {
    // Update chat interface with streaming content
    document.getElementById("response").textContent = content;
  }

  showToolCallProgress() {
    // Show tool is being called
    document.getElementById("status").textContent = "Calling tool...";
  }

  showToolResults(messages) {
    // Display tool results
    const toolMessage = messages.find(m => isToolMessage(m));
    if (toolMessage) {
      document.getElementById("tool-result").textContent = toolMessage.content;
    }
  }
}

// Usage
const chatInterface = new StreamingChatInterface(graph);
await chatInterface.streamResponse("What's the weather in NYC?");
```

## Best Practices

### 1. Choose the Right Streaming Mode

- Use `values` when you need complete state snapshots
- Use `updates` for incremental changes
- Use `messages` for token-by-token LLM streaming
- Use `debug` for troubleshooting
- Combine modes when needed

### 2. Handle Backpressure

```javascript
// Add delays if consumer is slower than producer
for await (const chunk of stream) {
  await processChunk(chunk);
  
  // Optional: Add small delay to prevent overwhelming
  if (needsThrottling) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
```

### 3. Memory Management

```javascript
// Limit accumulated chunks
const maxChunks = 1000;
const chunks = [];

for await (const chunk of stream) {
  chunks.push(chunk);
  
  if (chunks.length > maxChunks) {
    // Process and clear old chunks
    await processBatch(chunks.splice(0, maxChunks / 2));
  }
}
```

### 4. Type Safety

```javascript
import { 
  isAIMessageChunk, 
  isHumanMessage, 
  isToolMessage 
} from "@langchain/core/messages";

for await (const [chunk, metadata] of stream) {
  // Type guards for safety
  if (isAIMessageChunk(chunk)) {
    handleAIChunk(chunk);
  } else if (isHumanMessage(chunk)) {
    handleHumanMessage(chunk);
  } else if (isToolMessage(chunk)) {
    handleToolMessage(chunk);
  }
}
```

### 5. Event Filtering Strategy

```javascript
// Be specific with filters to reduce noise
const filteredStream = await graph.streamEvents(
  inputs,
  { version: "v2" },
  {
    // Only get LLM events from specific nodes
    includeNames: ["agent", "final"],
    includeTypes: ["chat_model"],
    excludeTags: ["nostream"]
  }
);
```

## Troubleshooting

### Stream Not Working

```javascript
// Check model supports streaming
const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  streaming: true,  // Explicitly enable
});

// Verify graph compilation
const graph = workflow.compile();
console.log("Graph nodes:", graph.nodes);

// Test with debug mode
const debugStream = await graph.stream(inputs, { streamMode: "debug" });
```

### Missing Events

```javascript
// Use streamEvents for granular control
const events = await graph.streamEvents(inputs, { version: "v2" });

// Log all events to debug
for await (const event of events) {
  console.log("Event:", event.event, "Name:", event.name);
}
```

### Performance Issues

```javascript
// Profile chunk processing time
for await (const chunk of stream) {
  const start = performance.now();
  await processChunk(chunk);
  const duration = performance.now() - start;
  
  if (duration > 100) {
    console.warn("Slow chunk processing:", duration, "ms");
  }
}
```

## Conclusion

LangGraph's streaming capabilities enable building responsive, real-time applications. By understanding the different streaming modes and patterns, you can create engaging user experiences that show progress as it happens. Remember to:

- Choose appropriate streaming modes for your use case
- Handle errors gracefully
- Optimize for performance
- Filter events to reduce noise
- Test thoroughly with different inputs

The streaming APIs are powerful tools for creating modern, interactive AI applications that feel alive and responsive to users.
