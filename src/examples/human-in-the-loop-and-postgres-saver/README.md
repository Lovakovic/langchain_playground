# PostgresSaver Example: Multi-Step Research Assistant with Interrupts

This example demonstrates how to use PostgreSQL for checkpointing in LangGraph, with a special focus on **properly implementing interrupt/resume patterns**. The research assistant performs multi-step web searches using Tavily API and showcases the non-obvious behavior of LangGraph interrupts.

## Features

- **PostgreSQL Checkpointing**: Saves workflow state to PostgreSQL database
- **Multi-Step Research**: Performs initial search, deep dives, and refinement
- **Human-in-the-Loop**: Demonstrates proper interrupt/resume patterns
- **Cost Tracking**: Monitors API usage and shows savings when resuming
- **Session Management**: List, resume, and manage multiple research sessions
- **Real API Integration**: Uses TavilySearch for actual web searches

## ⚠️ Critical Interrupt Pattern Insights

This example specifically addresses common misconceptions about LangGraph interrupts:

1. **Interrupts do NOT throw errors** - `graph.invoke()` completes successfully
2. **Must check state after invoke** - Use `graph.getState()` to detect interrupts
3. **Resume with Command object** - Use `new Command({ resume: value })`
4. **No try/catch needed** - Interrupts aren't exceptions

See the heavily annotated code for detailed explanations.

## Prerequisites

1. **Docker** installed and running
2. **Environment Variables**:
   - `TAVILY_API_KEY`: Your Tavily API key
   - `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account JSON

## Setup

1. Start PostgreSQL container:
```bash
cd src/examples/postgres-saver
docker compose up -d
```

2. Install dependencies (from project root):
```bash
yarn install
```

3. Run the example:
```bash
yarn ts-node src/examples/postgres-saver/index.ts
```

## Workflow Steps

1. **Parse Topic**: Extracts subtopics from research query
2. **Initial Search**: Broad search on main topic
3. **Deep Dive**: Focused searches on each subtopic
4. **Analyze Sources**: Deduplicates and ranks results
5. **Generate Summary**: Creates initial research summary
6. **Human Feedback**: Pauses for review and input
7. **Refine Research**: Additional searches based on feedback
8. **Final Report**: Generates comprehensive report

## Example Usage

```
=== Research Assistant with PostgresSaver ===

1. New Research
> 1

Enter research topic: Latest developments in quantum computing 2024

🔍 Parsing topic...
✅ Identified subtopics: breakthroughs, companies, applications
📍 Checkpoint saved

🌐 Initial search: "quantum computing 2024"...
✅ Found 5 results (3.2s, $0.05)
📍 Checkpoint saved

[... continues through all steps ...]

💭 Please review and provide feedback: Need more on IBM's work
📍 Session saved. Thread ID: research-1234567890

--- Later ---

2. Resume Research
> 2

✨ Restored from checkpoint!
💰 Previous searches preserved (saved $0.20)

🔎 Refining search: "IBM quantum computing 2024"...
```

## Key Concepts Demonstrated

### 1. Proper Interrupt Pattern 🚨

**Common Mistake (What NOT to do):**
```typescript
// ❌ WRONG - Expecting interrupt to throw an error
try {
  await graph.invoke(input, config);
} catch (error) {
  if (error.name === "GraphInterrupt") {
    // This will NEVER happen!
  }
}
```

**Correct Pattern:**
```typescript
// ✅ CORRECT - Check state after invoke
await graph.invoke(input, config);

const state = await graph.getState(config);
if (state.tasks.length > 0 && state.tasks[0].interrupts?.length > 0) {
  // Graph is paused at interrupt
  const feedback = await getUserInput();
  
  // Resume with Command
  await graph.invoke(
    new Command({ resume: feedback }),
    config
  );
}
```

### 2. PostgreSQL Checkpointer Setup
```typescript
const pool = new Pool({
  connectionString: "postgresql://langgraph:langgraph@localhost:15432/checkpoints"
});

const checkpointer = new PostgresSaver(pool);
await checkpointer.setup();
```

### 3. State Persistence
- Every node saves a checkpoint after execution
- State includes all search results, sources, and metadata
- Checkpoints enable resumption from exact point

### 4. Cost Efficiency
- Tracks API costs per search ($0.05 per Tavily search)
- Shows total saved when resuming from checkpoint
- Prevents re-running expensive operations

### 5. Session Management
```typescript
// List sessions grouped by thread
const threadMap = new Map();
for await (const checkpoint of checkpointer.list({ limit: 50 })) {
  const threadId = checkpoint.config?.configurable?.thread_id;
  if (threadId && !threadMap.has(threadId)) {
    threadMap.set(threadId, checkpoint);
  }
}
```

## Benefits

1. **Resilience**: Continue work after interruptions
2. **Cost Savings**: Don't repeat expensive API calls
3. **Collaboration**: Multiple users can review/continue
4. **Debugging**: Inspect state at each checkpoint
5. **Flexibility**: Add feedback and refine results

## Docker Management

```bash
# Start container
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down

# Remove data volume
docker compose down -v
```

## Troubleshooting Interrupts

If interrupts aren't working as expected:

1. **Check you have a checkpointer** - Interrupts require persistence
2. **Don't use interruptBefore/After** - Not needed with `await interrupt()`
3. **Check state after invoke** - Interrupts don't throw errors
4. **Use Command for resume** - Not `updateState()` or regular invoke
5. **Check state.tasks** - Look for tasks with interrupts property

## Customization

- Adjust search depth by modifying subtopic generation
- Change cost values to match your API pricing
- Add export formats (JSON, Markdown, etc.)
- Implement additional search providers
- Add more sophisticated source ranking
