# Tool Call Tracing Examples

This directory contains examples demonstrating different approaches to tracing tool calls in LangChain/LangGraph applications.

## Examples

### 1. `index.ts` - Hierarchical Tool Tracing with onToolEnd

This example shows how to trace tool calls in deeply nested subgraphs using the `onToolEnd` event. It demonstrates:
- Building complete hierarchy paths from tool execution back to root nodes
- Tracking tool calls through multiple graph layers
- Understanding where in your graph structure tools are being called

**Key method:** `onToolEnd(run: Run)`

### 2. `llm-end-event.ts` - Tool Call Tracing from onLLMEnd

This example demonstrates extracting tool calls from LLM responses using the `onLLMEnd` event. It shows:
- Capturing tool decisions immediately when the LLM makes them
- Extracting tool calls before they are executed
- The correct path to access tool calls: `run.outputs.generations[0][0].message.tool_calls`

**Key method:** `onLLMEnd(run: Run)`

## Key Differences

| Aspect | onToolEnd | onLLMEnd |
|--------|-----------|----------|
| **Timing** | After tool execution completes | When LLM decides to use tools |
| **Information Available** | Tool inputs & outputs | Only tool decision & arguments |
| **Use Case** | Logging complete tool execution | Early detection of tool usage |
| **Data Path** | `run.inputs`, `run.outputs` | `run.outputs.generations[0][0].message.tool_calls` |

## Running the Examples

```bash
# Run the hierarchical tool tracer
npx ts-node src/examples/tracing/tool-call-tracing/index.ts

# Run the LLM end event tracer
npx ts-node src/examples/tracing/tool-call-tracing/llm-end-event.ts
```

## Common Pitfalls

1. **Incorrect path in onLLMEnd**: The tool calls are nested deeply in the output structure. Always use:
   ```typescript
   const message = run.outputs?.generations?.[0]?.[0]?.message;
   const toolCalls = message?.tool_calls;
   ```

2. **Type safety**: Always check that `tool_calls` is an array before iterating:
   ```typescript
   if (message?.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
     // Process tool calls
   }
   ```

3. **Node context tracking**: Both examples track the current node context to understand where tool calls originate. This is crucial for understanding the execution flow in complex graphs.