# State Management

Memory optimization, persistence, cross-thread storage, and checkpointing.

## Examples

### state-memory
Three memory management patterns to prevent unbounded growth:

**Files:**
- `state-memory-management.ts` - Memory-limited reducers, clearable reducers, subgraph segmentation, batch processing
- `memory-demo.ts` - Real GC behavior with `--expose-gc` flag. Compares unmanaged vs window-based vs streaming patterns.

### cross-thread-memory
ReAct agent with dual memory: conversation history (per-thread) + user profiles (cross-thread). Uses Store API with InMemoryStore for persistent data across sessions.

**Key:** `InMemoryStore` for cross-session data, `MemorySaver` for per-thread conversations

### postgres-checkpointing
Multi-step AI research workflow with PostgreSQL persistence. Demonstrates interrupt/resume patterns - pauses for human feedback, resumes with Command objects.

**Critical insight:** Interrupts don't throw errors. Check `state.tasks` after invoke to detect pauses.

**Key:** PostgresSaver, TavilySearch, cost tracking, session management
