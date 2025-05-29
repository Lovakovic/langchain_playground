# Langchain Tool Calling Guide

A quick reference for implementing tool calling in Langchain applications.

## Overview

Tool calling enables models to interact with external systems (APIs, databases) by requesting responses that match specific schemas, rather than just natural language responses.

## Key Concepts

1. **Tool Creation** - Define a function and its schema
2. **Tool Binding** - Connect tools to a model that supports tool calling
3. **Tool Calling** - Model decides when to call tools based on input
4. **Tool Execution** - Execute tools with model-provided arguments

## Basic Workflow

```javascript
// 1. Tool creation
const tools = [myTool];

// 2. Tool binding
const modelWithTools = model.bindTools(tools);

// 3. Tool calling
const response = await modelWithTools.invoke(userInput);

// 4. Tool execution (if tool_calls present)
if (response.tool_calls) {
  // Execute the tool
}
```

## Creating Tools

### Method 1: Full Tool with Function

```javascript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const multiply = tool(
  ({ a, b }: { a: number; b: number }): number => {
  return a * b;
},
  {
    name: "multiply",
    description: "Multiply two numbers",
    schema: z.object({
      a: z.number(),
      b: z.number(),
    }),
  }
);
```

### Method 2: Schema-Only Tool

```javascript
const multiplyTool = {
  name: "multiply",
  description: "Multiply two numbers",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
};
```

## Binding Tools to Models

```javascript
const modelWithTools = model.bindTools([multiply, otherTool]);
```

## Tool Calling Examples

### Non-tool Response
```javascript
const result = await modelWithTools.invoke("Hello world!");
// Returns: AIMessage with natural language response
```

### Tool-calling Response
```javascript
const result = await modelWithTools.invoke("What is 2 multiplied by 3?");
// Returns: AIMessage with tool_calls attribute

console.log(result.tool_calls);
// Output: [{ name: 'multiply', args: { a: 2, b: 3 }, id: 'xxx', type: 'tool_call' }]
```

## Tool Execution

### Direct Execution
```javascript
if (result.tool_calls) {
  const toolCall = result.tool_calls[0];
  const toolResult = await multiply.invoke(toolCall.args);
}
```

### Using LangGraph ToolNode
```javascript
import { ToolNode } from "@langchain/langgraph/prebuilt";

const toolNode = new ToolNode([multiply]);
// Automatically handles tool execution
```

## Best Practices

- **Use explicit tool-calling APIs** - Fine-tuned models perform better
- **Clear naming** - Choose descriptive names and descriptions
- **Simple tools** - Narrow scope is easier for models to use
- **Limit tool count** - Large tool lists pose challenges for models

## Schema Validation

Always use Zod schemas for type safety:

```javascript
schema: z.object({
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results"),
})
```
