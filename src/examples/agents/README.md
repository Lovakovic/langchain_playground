# Agents

ReAct pattern agents and multi-agent orchestration with LangGraph.

## Examples

### react-agent

Complete ReAct (Reasoning + Acting) agent that fetches cat pictures and saves to
Desktop. Interactive CLI with streaming, memory persistence, and animated UI
feedback.

**Key:** Tool calling, conditional routing, MemorySaver checkpointing, event
streaming

### multi-agent

Multi-agent system with subgraph composition. Cat-fetching agent + Gen Z critic
agent that reviews/approves/rejects images. Demonstrates human-in-the-loop with
`interrupt()`, retry loops, and state sharing between agents.

**Key:** Subgraph composition, multimodal input (base64 images), quality control
workflows
