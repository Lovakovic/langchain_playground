# Task Utility for Durable Execution

Demonstrates the `task()` utility for wrapping side effects with `interrupt()`.

## What's Demonstrated

**The Problem**: Nodes re-execute from start on resume, causing duplicate API
calls and inconsistent data.

**The Solution**: `task()` utility executes side effects once and caches
results.

## Files

- `types.ts` - State interfaces
- `task-durable-execution.ts` - Three demonstrations: broken, fixed, and
  idempotent patterns

## Examples

1. **Broken Workflow** - Side effects without `task()` (duplicate API calls,
   changing IDs)
2. **Fixed Workflow** - Same workflow with `task()` (single API call, consistent
   IDs)
3. **Idempotency Pattern** - Combining `task()` with idempotency keys

## Run

```bash
yarn run-example src/examples/state-management/interrupting-and-checkpointing/task-durable-execution/task-durable-execution.ts
```

## Guide Reference

See guide lines 833-1401 for complete `task()` documentation.

## Related Examples

- `interrupt-and-postgres-saver.ts` - Production checkpointing
- `advanced-hitl-patterns/` - Command patterns and validation loops
