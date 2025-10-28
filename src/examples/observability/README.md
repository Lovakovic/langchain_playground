# Observability

Tracing, monitoring, and debugging LangGraph execution.

## Examples

### callback-tracing

Complete callback system with file logging. ReAct agent with weather/calculator
tools logs all events via custom `FileCallbackHandler`. Shows parent-child run
relationships and breadcrumb trails.

**Files:** `callback-tracing.ts` (main), `FileCallbackHandler.ts` (reusable
handler), `structured-output-example.ts` (shows tool-calling internals of
withStructuredOutput)

### complex-graph-tracing

Multi-model performance tracking. Nested graphs using Vertex AI + OpenAI with
detailed token usage per model, per node, execution timing. Exports metrics to
JSON.

**Key:** `EnhancedMetricsTracer` tracks across graph hierarchies

### custom-events

Application-specific event dispatching with `dispatchCustomEvent()`. Four
patterns: basic events, progress tracking, graph node events, error tracking.
Includes log visualizer.

**Files:** `custom-events.ts` (examples), `visualize.ts` (JSONL parser with
tree/timeline views)

### tool-call-tracing

Tool execution tracing in nested subgraphs.

**Files:**

- `llm-end-event.ts` - Capture tool calls from `onLLMEnd` before execution
- `tool-call-tracing.ts` - 3-layer nested graph hierarchy with tool tracking
  across layers
