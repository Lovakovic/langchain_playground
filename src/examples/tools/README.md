# Tools

Tool definition, binding, error handling, and forcing tool calls.

## Examples

### tool-calling

Basic tool integration - multiply two numbers. Shows complete flow: request →
tool execution → response.

**Files:**

- `tool-calling.ts` - Basic ReAct with single tool
- `default-param-example.ts` - Shows LLMs ignore schema defaults (defaults only
  apply when tool.invoke() runs)

### forcing-tool-calls

Force LLM to always call specific tool using `tool_choice: 'any'` (Vertex AI) or
similar OpenAI syntax.

### tool-error-handling

Interactive agent with password validation. Demonstrates error recovery - agent
handles validation failures and retries with corrected input.

**Key:** ToolNode with `handleToolErrors: true`, streaming events, multi-turn
error recovery
