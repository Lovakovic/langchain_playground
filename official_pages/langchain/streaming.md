# Langchain Streaming Guide

A comprehensive guide to streaming output in real-time from Langchain applications.

## Overview

Streaming is crucial for responsive LLM applications. Instead of waiting for complete responses (often several seconds), streaming shows progressive output as it's generated, dramatically improving user experience.

## What to Stream

### 1. LLM Outputs
The most common streaming target - showing text generation token by token.

### 2. Pipeline Progress
Track workflow execution through complex chains, showing which components are active.

### 3. Custom Data
Stream application-specific updates from within tools or workflow nodes.

## Core Streaming APIs

Langchain provides two main streaming APIs:

- **`stream()`** - Stream final outputs from any Runnable component
- **`streamEvents()`** - Stream intermediate outputs and custom events from LCEL pipelines

## Stream API

### Basic Model Streaming

```javascript
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o-mini" });

// Stream model output
const stream = await model.stream("Tell me about yourself.");

for await (const chunk of stream) {
  console.log(`${chunk.content}|`);
}
// Output: Hello|!| I'm| a| large| language| model|...
```

### Message Chunks

Streaming returns `AIMessageChunk` objects that are additive:

```javascript
const chunks = [];
for await (const chunk of stream) {
  chunks.push(chunk);
}

// Combine chunks to get partial responses
let finalChunk = chunks[0];
for (const chunk of chunks.slice(1, 5)) {
  finalChunk = finalChunk.concat(chunk);
}

console.log(finalChunk.content); // "Hello! I'm a"
```

### Chain Streaming

LCEL chains automatically support streaming from the final component:

```javascript
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromTemplate("Tell me a joke about {topic}");
const parser = new StringOutputParser();
const chain = prompt.pipe(model).pipe(parser);

const stream = await chain.stream({ topic: "parrot" });

for await (const chunk of stream) {
  console.log(`${chunk}|`);
}
// Output: Sure|,| here's| a| joke|...
```

### Advanced Parsing - JSON Streaming

Some parsers can handle partial inputs intelligently:

```javascript
import { JsonOutputParser } from "@langchain/core/output_parsers";

const chain = model.pipe(new JsonOutputParser());

const stream = await chain.stream(
  `Output a list of countries with populations in JSON format`
);

for await (const chunk of stream) {
  console.log(chunk); // Streams valid JSON objects as they're built
}
// Output: { countries: [{ name: 'France', population: 67390000 }, ...] }
```

### Non-Streaming Components

Components that don't support streaming (like retrievers) yield final results:

```javascript
import { MemoryVectorStore } from "langchain/vectorstores/memory";

const retriever = vectorstore.asRetriever();

const chunks = [];
for await (const chunk of await retriever.stream("query")) {
  chunks.push(chunk);
}
// Returns: [Document[], Document[]] - final results only
```

## StreamEvents API

For complex pipelines, use `streamEvents()` to access intermediate outputs:

```javascript
const chain = prompt.pipe(model).pipe(parser);

const eventStream = await chain.streamEvents(
  { topic: "parrot" },
  { version: "v2" } // Required version parameter
);

for await (const event of eventStream) {
  if (event.event === "on_chat_model_stream") {
    console.log(`Model: ${event.data.chunk.content}`);
  } else if (event.event === "on_parser_stream") {
    console.log(`Parser: ${event.data.chunk}`);
  }
}
```

## Event Types Reference

| Event | Component | Description | Data |
|-------|-----------|-------------|------|
| `on_llm_start` | LLM | Model starts | `{ input: 'hello' }` |
| `on_llm_stream` | LLM | Token generated | `'Hello'` or `AIMessageChunk` |
| `on_llm_end` | LLM | Model finished | Full response + metadata |
| `on_chain_start` | Chain | Chain execution begins | Input data |
| `on_chain_stream` | Chain | Intermediate output | Partial results |
| `on_chain_end` | Chain | Chain completed | Final output |
| `on_tool_start` | Tool | Tool invocation starts | Tool arguments |
| `on_tool_stream` | Tool | Tool streaming output | Partial tool results |
| `on_tool_end` | Tool | Tool completed | Final tool result |
| `on_retriever_start` | Retriever | Retrieval begins | Query |
| `on_retriever_end` | Retriever | Retrieval completed | Documents |
| `on_parser_start` | Parser | Parsing begins | Input to parse |
| `on_parser_stream` | Parser | Partial parsing | Parsed chunks |
| `on_parser_end` | Parser | Parsing completed | Final parsed output |

## Event Filtering

### Filter by Name

```javascript
const chain = model
  .withConfig({ runName: "model" })
  .pipe(new JsonOutputParser().withConfig({ runName: "my_parser" }));

const eventStream = await chain.streamEvents(
  input,
  { version: "v2" },
  { includeNames: ["my_parser"] } // Only parser events
);
```

### Filter by Type

```javascript
const eventStream = await chain.streamEvents(
  input,
  { version: "v2" },
  { includeTypes: ["chat_model"] } // Only model events
);
```

### Filter by Tags

```javascript
const chain = model
  .pipe(parser)
  .withConfig({ tags: ["my_chain"] });

const eventStream = await chain.streamEvents(
  input,
  { version: "v2" },
  { includeTags: ["my_chain"] } // Events with this tag
);
```

## LangGraph Streaming

LangGraph supports multiple streaming modes:

```javascript
import { StateGraph } from "@langchain/langgraph";

const graph = new StateGraph(/* ... */);
const compiledGraph = graph.compile();

// Stream different types of data
for await (const chunk of compiledGraph.stream(input, {
  streamMode: "values" // or "updates", "debug", "messages"
})) {
  console.log(chunk);
}
```

**Streaming Modes:**
- `"values"` - All state values for each step
- `"updates"` - Only node updates after each step
- `"debug"` - Debug events for each step
- `"messages"` - LLM messages token-by-token

## HTTP Streaming (Server-Sent Events)

Stream events over HTTP using Server-Sent Events format:

### Server-Side Handler

```javascript
const handler = async () => {
  const eventStream = await chain.streamEvents(
    input,
    {
      version: "v2",
      encoding: "text/event-stream"
    }
  );

  return new Response(eventStream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    }
  });
};
```

### Client-Side Consumption

```javascript
import { fetchEventSource } from "@microsoft/fetch-event-source";

await fetchEventSource("/api/stream", {
  method: "POST",
  body: JSON.stringify({ query: "Hello" }),
  onmessage: (message) => {
    if (message.event === "data") {
      const event = JSON.parse(message.data);
      console.log(event);
    }
  },
  onerror: (err) => {
    console.error("Stream error:", err);
  }
});
```

## Auto-Streaming

Langchain automatically enables streaming when detected:

```javascript
// Using invoke() but within a streaming context
const node = async (state) => {
  // This invoke() call will automatically stream
  // when the overall application is being streamed
  const aiMessage = await model.invoke(state.messages);
  return { messages: [aiMessage] };
};

// The compiled graph detects streaming context
for await (const chunk of compiledGraph.stream(input, {
  streamMode: "messages"
})) {
  // Receives streamed tokens even though node uses invoke()
}
```

## Advanced Patterns

### Streaming with Non-Streaming Components

```javascript
// This breaks stream() but streamEvents() still works
const extractNames = (data) => {
  return data.countries.map(c => c.name);
};

const chain = model.pipe(new JsonOutputParser()).pipe(extractNames);

// stream() only shows final result
const stream = await chain.stream(input);
// But streamEvents() shows intermediate streaming

const eventStream = await chain.streamEvents(input, { version: "v2" });
for await (const event of eventStream) {
  // Still see model and parser streaming events
  if (event.event === "on_chat_model_stream") {
    console.log(`Model: ${event.data.chunk.content}`);
  }
}
```

### Custom Event Dispatching

```javascript
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

const customTool = tool(async (input) => {
  // Dispatch custom progress events
  await dispatchCustomEvent("progress_update", {
    step: "processing",
    progress: 0.5
  });
  
  const result = await processData(input);
  
  await dispatchCustomEvent("progress_update", {
    step: "complete",
    progress: 1.0
  });
  
  return result;
}, {
  name: "customTool",
  // ... schema
});
```

### Aggregating Streaming Results

```javascript
// Collect all chunks for final display
const chunks = [];
const stream = await model.stream("Generate a story");

for await (const chunk of stream) {
  chunks.push(chunk);
  
  // Show progressive updates
  const soFar = chunks.reduce((acc, c) => acc.concat(c), chunks[0]);
  updateUI(soFar.content);
}

// Final result
const finalMessage = chunks.reduce((acc, chunk) => acc.concat(chunk));
```

## Error Handling

```javascript
try {
  const stream = await chain.stream(input);
  
  for await (const chunk of stream) {
    try {
      processChunk(chunk);
    } catch (chunkError) {
      console.error("Chunk processing error:", chunkError);
      // Continue streaming
    }
  }
} catch (streamError) {
  console.error("Stream initialization error:", streamError);
}
```

## Performance Tips

### Efficient Chunk Processing

```javascript
for await (const chunk of stream) {
  // Keep processing efficient - upstream waits for current chunk
  // Avoid expensive operations that could cause timeouts
  
  // Good: Simple text appending
  displayText += chunk.content;
  
  // Bad: Complex DOM manipulation or API calls
  // await expensiveOperation(chunk);
}
```

### Streaming Context Management

```javascript
// Configure streaming context for optimal performance
const streamConfig = {
  version: "v2",
  // Include only necessary event types
  includeTypes: ["chat_model", "parser"],
  // Limit events to prevent memory issues
  maxEvents: 1000
};

const eventStream = await chain.streamEvents(input, streamConfig);
```

## Best Practices

- **Keep chunk processing fast** - Upstream components wait during processing
- **Use appropriate API** - `stream()` for final output, `streamEvents()` for intermediate steps
- **Filter events** - Use name/type/tag filters to reduce noise
- **Handle errors gracefully** - Don't let chunk errors break the entire stream
- **Aggregate when needed** - Combine chunks for final display
- **Configure timeouts** - Set appropriate timeouts for streaming operations
- **Monitor memory** - Long streams can accumulate chunks in memory

## Troubleshooting

### Stream Not Working
- Check if all components in chain support streaming
- Verify streaming is enabled on model configuration
- Ensure no blocking components break the stream

### Missing Intermediate Events
- Use `streamEvents()` instead of `stream()`
- Check event filtering is not too restrictive
- Verify component names/tags are correct

### Performance Issues
- Optimize chunk processing speed
- Reduce event filtering scope
- Consider batching updates instead of per-chunk updates

### Memory Problems
- Limit chunk accumulation
- Clear old chunks periodically
- Use streaming modes that don't retain full history
