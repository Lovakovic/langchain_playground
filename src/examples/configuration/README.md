# Configuration

Runtime dependency injection via `config.configurable`.

## Example

### runtime-configurable-data
Inject non-serializable dependencies (database connections, API clients) into nodes and tools. Interactive agent with user switching that accesses different user data and quota info.

**Pattern:** Pass runtime deps in `config.configurable` field, not in state. Config automatically flows through nodes, edges, and tool calls.

**Key:** Type-safe with `RunnableConfig<RuntimeDependencies>`, multi-user context management, MemorySaver for conversation threads
