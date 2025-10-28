# Execution Control

Abort signals, timeouts, and cancellation patterns.

## Example

### canceling-execution
Eight patterns for aborting/timing out graph execution on a simulated data pipeline:

1. **Basic timeout** - `AbortSignal.timeout(ms)`
2. **Manual abort** - AbortController with clearTimeout on success
3. **Recursion + timeout** - Dual limits (steps + time)
4. **Progressive timeout** - Retry with exponential increase (2s → 4s → 8s)
5. **User-cancellable + timeout** - `AbortSignal.any()` combines manual + automatic
6. **Resource-based** - Monitor state, abort when limits exceeded
7. **Streaming with timeout** - Handle abort during async iteration
8. **TimeoutManager** - Reusable utility class

**Key:** Requires `@langchain/core >= 0.2.20`, works with both `invoke()` and `stream()`
