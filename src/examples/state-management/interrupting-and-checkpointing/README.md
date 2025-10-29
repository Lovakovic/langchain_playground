# Human-in-the-Loop & Checkpointing Examples

Examples demonstrating HITL workflows and checkpointing in LangGraph.

## Examples

- **interrupt-and-postgres-saver.ts** - Production setup with PostgreSQL, real
  APIs, session management
- **task-durable-execution/** - `task()` utility for side effects with
  interrupts
- **advanced-hitl-patterns/** - Validation loops, tool call review, Command
  routing
- **langgraph-js-human-in-the-loop-guide.md** - Complete API reference and
  patterns

## Quick Reference

| Example                         | Focus        | Checkpointer | APIs          |
| ------------------------------- | ------------ | ------------ | ------------- |
| interrupt-and-postgres-saver.ts | Production   | PostgreSQL   | Real (Tavily) |
| task-durable-execution/         | Side effects | Memory       | Simulated     |
| advanced-hitl-patterns/         | Patterns     | Memory       | Simulated     |

---

## Details

See individual example files for complete implementation, patterns, and usage
instructions.
