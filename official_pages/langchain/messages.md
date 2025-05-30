# Langchain Messages Guide

A comprehensive reference for understanding and using message types in Langchain applications.

## Overview

Messages are the fundamental communication units in Langchain chat models. They represent input, output, and context in conversations with standardized roles, content, and metadata.

## Message Structure

Every message contains:
- **Role** - Distinguishes message types (system, user, assistant, tool)
- **Content** - Text or multimodal data (images, audio, etc.)
- **Metadata** - ID, name, timestamps, token usage, etc.

## Core Message Types

### SystemMessage

Sets model behavior and provides context. Used to prime the AI with instructions.

```javascript
import { SystemMessage } from "@langchain/core/messages";

const systemMsg = new SystemMessage("You are a helpful cooking assistant. Always suggest healthy alternatives.");

// Usage in conversation
const conversation = [
  systemMsg,
  new HumanMessage("How do I make pasta?")
];
```

**Provider Support:**
- Most providers support via "system" role or separate API parameter
- Langchain automatically adapts based on provider capabilities
- Some providers don't support system messages

### HumanMessage

Represents user input to the model (corresponds to "user" role).

#### Text Content
```javascript
import { HumanMessage } from "@langchain/core/messages";

// Explicit HumanMessage
const humanMsg = new HumanMessage("Hello, how are you?");

// Auto-conversion from string
await model.invoke("Hello, how are you?"); // Automatically becomes HumanMessage
```

#### Multimodal Content
```javascript
const multimodalMsg = new HumanMessage({
  content: [
    { type: "text", text: "What's in this image?" },
    { 
      type: "image_url", 
      image_url: { url: "data:image/jpeg;base64,..." }
    }
  ]
});
```

### AIMessage

Represents model responses (corresponds to "assistant" role).

```javascript
const aiMessage = await model.invoke([new HumanMessage("Tell me a joke")]);
console.log(aiMessage);

// AIMessage structure
{
  content: "Why did the chicken cross the road?\n\nTo get to the other side!",
  tool_calls: [],
  invalid_tool_calls: [],
  response_metadata: { tokenUsage: {...}, finish_reason: "stop" },
  usage_metadata: { input_tokens: 10, output_tokens: 15, total_tokens: 25 },
  id: "msg_123"
}
```

#### AIMessage Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `content` | string \| array | Main response text or content blocks |
| `tool_calls` | array | Valid tool call requests |
| `invalid_tool_calls` | array | Malformed tool calls |
| `usage_metadata` | object | Token usage information |
| `response_metadata` | object | Provider-specific metadata |
| `id` | string | Optional unique identifier |

#### Content Types
```javascript
// Text content (most common)
aiMessage.content; // "Hello! How can I help you?"

// Array of content blocks (Anthropic, OpenAI audio)
aiMessage.content; // [{ type: "text", text: "..." }, { type: "audio", ... }]
```

### AIMessageChunk

Used for streaming responses as they're generated.

```javascript
// Streaming example
for await (const chunk of model.stream([
  new HumanMessage("What color is the sky?")
])) {
  console.log(chunk.content); // Partial content as it streams
}
```

#### Aggregating Chunks
```javascript
// Method 1: Using concat
const finalMessage = chunk1.concat(chunk2).concat(chunk3);

// Method 2: Using utility function
import { concat } from "@langchain/core/utils/stream";
const finalMessage = concat(chunk1, chunk2, chunk3);
```

### ToolMessage

Contains results from tool execution (corresponds to "tool" role).

```javascript
import { ToolMessage } from "@langchain/core/messages";

const toolMsg = new ToolMessage({
  content: "The weather in Paris is 22°C and sunny",
  tool_call_id: "call_123", // Links to the tool call
  name: "get_weather",
  artifact: { temperature: 22, condition: "sunny", location: "Paris" }
});
```

**Key Properties:**
- `tool_call_id` - Links to the original tool call
- `artifact` - Additional data not sent to model but available downstream
- `content` - Human-readable result for the model

### RemoveMessage

Special message for managing chat history in LangGraph (no role correspondence).

```javascript
import { RemoveMessage } from "@langchain/core/messages";

// Used to remove specific messages from conversation history
const removeMsg = new RemoveMessage({ id: "msg_to_remove" });
```

### FunctionMessage (Legacy)

Legacy support for OpenAI's old function-calling API. Use ToolMessage instead.

```javascript
// Deprecated - use ToolMessage instead
import { FunctionMessage } from "@langchain/core/messages";
```

## Message Roles Reference

| Role | LangChain Class | Description |
|------|----------------|-------------|
| `system` | SystemMessage | Model behavior instructions |
| `user` | HumanMessage | User input |
| `assistant` | AIMessage/AIMessageChunk | Model responses |
| `tool` | ToolMessage | Tool execution results |
| N/A | RemoveMessage | History management |

## Conversation Structure

Typical conversation flow:

```javascript
const conversation = [
  new SystemMessage("You are a helpful assistant"),
  new HumanMessage("Hello, how are you?"),
  new AIMessage("I'm doing well, thank you for asking."),
  new HumanMessage("Can you tell me a joke?"),
  new AIMessage("Sure! Why did the scarecrow win an award? Because he was outstanding in his field!")
];
```

## OpenAI Format Compatibility

### Input Format
Langchain accepts OpenAI-style message objects:

```javascript
await chatModel.invoke([
  { role: "user", content: "Hello, how are you?" },
  { role: "assistant", content: "I'm doing well, thank you." },
  { role: "user", content: "Can you tell me a joke?" }
]);
```

### Output Format
Model outputs are always in Langchain message format. Convert manually if needed:

```javascript
// Langchain output
const aiMessage = await model.invoke([...]);

// Convert to OpenAI format if needed
const openaiFormat = {
  role: "assistant",
  content: aiMessage.content
};
```

## Advanced Usage

### Message Metadata
```javascript
const msgWithMetadata = new HumanMessage({
  content: "Hello",
  id: "user_msg_001",
  name: "John", // Differentiate speakers with same role
  additional_kwargs: { timestamp: Date.now() }
});
```

### Tool Calling Workflow
```javascript
// 1. User message
const userMsg = new HumanMessage("What's the weather in Paris?");

// 2. AI responds with tool call
const aiResponse = await model.invoke([userMsg]);
// aiResponse.tool_calls = [{ name: "get_weather", args: { city: "Paris" }, id: "call_123" }]

// 3. Execute tool and create tool message
const toolResult = await weatherTool.invoke(aiResponse.tool_calls[0]);
const toolMsg = new ToolMessage({
  content: toolResult.content,
  tool_call_id: "call_123",
  artifact: toolResult.artifact
});

// 4. Continue conversation with tool result
const finalResponse = await model.invoke([userMsg, aiResponse, toolMsg]);
```

### Streaming with Tool Calls
```javascript
for await (const chunk of model.stream([userMsg])) {
  // Handle different chunk types
  if (chunk.tool_calls?.length > 0) {
    console.log("Tool calls:", chunk.tool_calls);
  }
  if (chunk.content) {
    console.log("Content:", chunk.content);
  }
}
```

## Best Practices

- **System Messages** - Use for consistent behavior across conversations
- **Message History** - Maintain proper conversation flow for context
- **Tool Messages** - Always link to tool calls with `tool_call_id`
- **Streaming** - Aggregate chunks for final display to users
- **Error Handling** - Check for `invalid_tool_calls` when using tools
- **Metadata** - Use `name` property to differentiate speakers in multi-party conversations

## Common Patterns

### Simple Chat
```javascript
const messages = [
  new HumanMessage("What's 2+2?"),
];
const response = await model.invoke(messages);
```

### Conversation with Context
```javascript
const messages = [
  new SystemMessage("You are a math tutor"),
  new HumanMessage("What's 2+2?"),
  new AIMessage("2+2 equals 4"),
  new HumanMessage("What about 3+3?")
];
const response = await model.invoke(messages);
```

### Tool-Enabled Chat
```javascript
const modelWithTools = model.bindTools([calculatorTool]);
const messages = [new HumanMessage("Calculate 15 * 23")];
const response = await modelWithTools.invoke(messages);

if (response.tool_calls?.length > 0) {
  // Handle tool execution
}
```
