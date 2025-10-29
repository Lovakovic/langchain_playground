# Human-in-the-Loop in LangGraph JS: Comprehensive Guide

**Version:** LangGraph JS >=1.0.0  
**Last Updated:** October 2025  
**Status:** Official approach as of v1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Requirements](#requirements)
4. [The `interrupt()` Function](#the-interrupt-function)
5. [The `Command` Primitive](#the-command-primitive)
6. [Design Patterns](#design-patterns)
7. [Execution Flow & Resuming](#execution-flow--resuming)
8. [Using with `invoke` vs `stream`](#using-with-invoke-vs-stream)
9. [Common Pitfalls](#common-pitfalls)
10. [The `task()` Utility for Durable Execution](#the-task-utility-for-durable-execution)
11. [API Reference](#api-reference)
12. [Best Practices](#best-practices)

---

## Overview

**Human-in-the-Loop (HITL)** workflows integrate human input into automated
processes, enabling decisions, validation, or corrections at critical stages. In
LangGraph JS, HITL is a first-class feature built on top of the persistence
layer.

### What is Human-in-the-Loop?

A HITL workflow pauses graph execution at strategic points to:

- **Collect human input** for clarification or additional context
- **Review and approve** critical actions (API calls, database changes,
  financial transactions)
- **Edit or correct** LLM outputs or tool calls before execution
- **Validate** data before proceeding

### Why Use HITL?

Essential for LLM-based applications where:

- **Low error tolerance** is required (compliance, decision-making, content
  generation)
- **Model accuracy** may occasionally fail
- **Human expertise** is needed for complex decisions
- **Approval workflows** are mandatory for critical operations

### Key Use Cases

| Use Case                        | Description                                                 |
| ------------------------------- | ----------------------------------------------------------- |
| 🛠️ **Tool Call Review**         | Review, edit, or approve tool calls before execution        |
| ✅ **Output Validation**        | Review and edit LLM-generated content                       |
| 💡 **Context Collection**       | Request additional information or clarification             |
| 🔄 **Multi-turn Conversations** | Support back-and-forth interactions between agent and human |

---

## Core Concepts

### 1. Dynamic Interrupts (Recommended)

As of **LangGraph v0.2.31+**, the `interrupt()` function is the **recommended**
approach for HITL workflows.

```typescript
import { interrupt } from '@langchain/langgraph';

function humanNode(state: State) {
  const value = interrupt({
    question: 'Do you approve?',
    data: state.someData,
  });

  return { approved: value };
}
```

### 2. The `task()` Utility for Side Effects

Since nodes re-execute from the beginning when resuming, side effects (API
calls, database writes, etc.) must be wrapped in `task()` to prevent duplicate
execution:

```typescript
import { task, interrupt } from '@langchain/langgraph';

const performAction = task('performAction', async (data: any) => {
  return await apiCall(data);
});

async function nodeWithSideEffect(state: State) {
  // ✅ Executes once, result cached on resume
  const result = await performAction(state.data);

  const approved = interrupt({ result });

  return { result, approved };
}
```

**Without `task()`:** Side effects execute every time the node runs (including
on resume)  
**With `task()`:** Side effects execute once, result is checkpointed and reused

### 3. Static Breakpoints (Legacy)

Static interrupts (`interrupt_before`, `interrupt_after`) are **not
recommended** for HITL. They're best used for debugging and testing only.

```typescript
// ⚠️ Not recommended for production HITL
const graph = builder.compile({
  checkpointer,
  interrupt_before: ['nodeA'], // Legacy approach
  interrupt_after: ['nodeB'], // Use interrupt() instead
});
```

### 3. Persistent Execution State

- **Checkpointers** save graph state at each super-step
- Graphs can pause **indefinitely** until resumed
- No time constraints on human review
- Supports **asynchronous** human intervention

### 4. Flexible Integration

HITL logic can be added at **any point** in your workflow:

- Before critical actions
- After LLM generations
- During multi-agent handoffs
- Within validation loops

---

## Requirements

To use HITL in LangGraph JS, you must:

### 1. Enable Checkpointing

A **checkpointer** is mandatory for `interrupt()` to work:

```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver(); // For development/testing
const graph = builder.compile({ checkpointer });
```

**Production Checkpointers:**

```typescript
// SQLite (local, persistent)
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
const checkpointer = SqliteSaver.fromConnString('./checkpoints.sqlite');

// PostgreSQL (production)
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
const checkpointer = PostgresSaver.fromConnString(DB_URI);
```

### 2. Use Thread IDs

Every invocation must include a **thread ID** to maintain state:

```typescript
const config = {
  configurable: {
    thread_id: 'conversation-123',
  },
};

await graph.invoke(input, config);
```

### 3. Place `interrupt()` in Nodes

Call `interrupt()` inside node functions at the desired pause point:

```typescript
function myNode(state: State) {
  // Code before interrupt runs on first invocation
  const humanInput = interrupt('Please provide input');
  // Code after interrupt runs after resuming
  return { result: humanInput };
}
```

---

## The `interrupt()` Function

### Basic Signature

```typescript
function interrupt<T = any>(value: T): T;
```

### How It Works

1. **Pauses** graph execution at the current node
2. **Surfaces** the provided `value` to the client via `__interrupt__`
3. **Waits** indefinitely for human input
4. **Returns** the resume value when execution continues

### Example: Simple Approval

```typescript
import { interrupt, Command } from '@langchain/langgraph';

function approvalNode(state: State): Command {
  const isApproved = interrupt({
    question: 'Approve this action?',
    action: state.pendingAction,
  });

  if (isApproved) {
    return new Command({ goto: 'execute_action' });
  } else {
    return new Command({ goto: 'reject_action' });
  }
}
```

### What Gets Surfaced

When `interrupt()` is called, the graph returns:

```typescript
{
  __interrupt__: [
    {
      value: { question: '...', action: '...' }, // Your payload
      resumable: true,
      ns: ['approvalNode:uuid-here'],
      when: 'during',
    },
  ];
}
```

### Value Types

The `interrupt()` value can be **any JSON-serializable data**:

```typescript
// String
interrupt("What is your age?");

// Object
interrupt({
  question: "Review this?",
  tool_call: toolCall,
  estimated_cost: 0.05
});

// Array
interrupt([request1, request2]);

// Complex nested structures
interrupt({
  type: "tool_review",
  tools: [...],
  metadata: { timestamp: Date.now() }
});
```

---

## The `Command` Primitive

The `Command` class is used to **resume execution** and optionally **update
state** or **route to specific nodes**.

### Constructor Signature

```typescript
class Command<Resume, Update, Nodes> {
  constructor(params: {
    resume?: Resume; // Value to pass back to interrupt()
    update?: Update; // State updates to apply
    goto?: Nodes; // Node to route to
    graph?: typeof Command.PARENT | string; // Target graph
  });
}
```

### Resume an Interrupt

```typescript
// Resume with a value
await graph.invoke(new Command({ resume: 'approved' }), config);
```

### Resume + Update State

```typescript
// Resume AND update graph state
await graph.invoke(
  new Command({
    resume: 'user input',
    update: { userProvided: true },
  }),
  config,
);
```

### Resume + Route

```typescript
// Resume AND specify next node
await graph.invoke(
  new Command({
    resume: { approved: true },
    goto: 'execute_action',
  }),
  config,
);
```

### Cross-Graph Commands

```typescript
// Send command to parent graph
function nodeInSubgraph(state: State) {
  return new Command({
    update: { foo: 'bar' },
    goto: 'nodeInParent',
    graph: Command.PARENT,
  });
}
```

---

## Design Patterns

### 1. Approve or Reject

Pause before critical actions and route based on approval:

```typescript
import { interrupt, Command } from '@langchain/langgraph';

function approvalNode(state: State): Command {
  const isApproved = interrupt({
    question: 'Approve this API call?',
    endpoint: state.apiEndpoint,
    payload: state.requestData,
  });

  if (isApproved) {
    return new Command({ goto: 'execute_api_call' });
  } else {
    return new Command({ goto: 'cancel_action' });
  }
}

// Add to graph
builder.addNode('approval', approvalNode, {
  ends: ['execute_api_call', 'cancel_action'],
});
```

**Resume:**

```typescript
// Approve
await graph.invoke(new Command({ resume: true }), config);

// Reject
await graph.invoke(new Command({ resume: false }), config);
```

---

### 2. Edit Graph State

Allow humans to review and modify state before proceeding:

```typescript
function humanEditing(state: State) {
  const result = interrupt({
    task: 'Review and edit the summary',
    current_summary: state.llmSummary,
  });

  return {
    llmSummary: result.edited_text,
    reviewed: true,
  };
}
```

**Resume:**

```typescript
await graph.invoke(
  new Command({
    resume: { edited_text: 'The corrected summary...' },
  }),
  config,
);
```

---

### 3. Review Tool Calls

The most common HITL pattern - review and potentially edit tool calls:

```typescript
function reviewToolCalls(state: State): Command {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolCall = lastMessage.tool_calls?.[0];

  const humanReview = interrupt({
    question: 'Review this tool call?',
    tool: toolCall.name,
    args: toolCall.args,
  });

  const [action, data] = humanReview;

  if (action === 'approve') {
    return new Command({ goto: 'execute_tool' });
  } else if (action === 'edit') {
    // Update the tool call with human edits
    return new Command({
      goto: 'execute_tool',
      update: { messages: [updatedMessage] },
    });
  } else if (action === 'reject') {
    return new Command({ goto: 'agent' });
  }
}
```

**Resume:**

```typescript
// Approve as-is
await graph.invoke(
  new Command({ resume: ["approve", null] }),
  config
);

// Edit and approve
await graph.invoke(
  new Command({
    resume: ["edit", { name: "tool_name", args: {...} }]
  }),
  config
);

// Reject
await graph.invoke(
  new Command({ resume: ["reject", null] }),
  config
);
```

---

### 4. Multi-turn Conversation

Support back-and-forth interactions with agents:

#### Pattern A: Unique Human Node per Agent

```typescript
function humanInputForAgent1(state: State) {
  const message = interrupt('Waiting for user input');
  return {
    messages: [
      {
        role: 'human',
        content: message,
      },
    ],
  };
}

builder
  .addNode('agent_1', agent1Node)
  .addNode('human_for_agent_1', humanInputForAgent1)
  .addEdge('agent_1', 'human_for_agent_1')
  .addEdge('human_for_agent_1', 'agent_1');
```

#### Pattern B: Shared Human Node

```typescript
import { Command } from '@langchain/langgraph';

function sharedHumanNode(state: State): Command {
  const userInput = interrupt('Ready for user input');

  // Determine active agent from state
  const activeAgent = state.lastActiveAgent;

  return new Command({
    goto: activeAgent,
    update: {
      messages: [
        {
          role: 'human',
          content: userInput,
        },
      ],
    },
  });
}
```

---

### 5. Validate Human Input

Use multiple interrupts in a loop to validate input:

```typescript
function collectAge(state: State) {
  let question = 'What is your age?';

  while (true) {
    const answer = interrupt(question);

    if (typeof answer === 'number' && answer > 0) {
      return { age: answer };
    }

    question = `'${answer}' is not a valid age. Please enter a positive number.`;
  }
}
```

**Resume Flow:**

```typescript
// First attempt (invalid)
await graph.invoke({ age: null }, config);
// Pauses with: "What is your age?"

await graph.stream(new Command({ resume: 'twenty' }), config);
// Pauses again with: "'twenty' is not a valid age..."

await graph.stream(new Command({ resume: 25 }), config);
// Continues execution with valid input
```

---

## Execution Flow & Resuming

### Critical: Node Re-execution

When resuming from an `interrupt()`, **the node starts from the beginning**:

```typescript
let counter = 0;

function myNode(state: State) {
  counter += 1; // ⚠️ This runs AGAIN when resuming!
  console.log(`Entered node ${counter} times`);

  const answer = interrupt('Your input?');

  console.log(`Counter is now: ${counter}`);
  return { answer };
}
```

**Output:**

```
// First invocation
Entered node 1 times

// After resume
Entered node 2 times
Counter is now: 2
```

### Why This Happens

1. Graph saves state as a **checkpoint** when interrupt is hit
2. On resume, execution starts at the **beginning of the node**
3. All code **before** `interrupt()` runs again
4. The `interrupt()` call **returns the resume value** instead of pausing
5. Code **after** `interrupt()` continues normally

### Multiple Interrupts in One Node

LangGraph maintains a **list of resume values** per task:

```typescript
function nodeWithMultipleInterrupts() {
  const answer1 = interrupt({ question: 'First question?' });
  const answer2 = interrupt({ question: 'Second question?' });

  return {
    result: `${answer1} and ${answer2}`,
  };
}
```

**Resume sequence:**

```typescript
// First run - pauses at first interrupt
await graph.invoke(input, config);

// Resume first interrupt
await graph.invoke(new Command({ resume: 'answer 1' }), config);
// Pauses at second interrupt

// Resume second interrupt
await graph.invoke(new Command({ resume: 'answer 2' }), config);
// Completes with: "answer 1 and answer 2"
```

⚠️ **Important:** Matching is **index-based**. Never dynamically change the
number or order of `interrupt()` calls between executions.

---

## Using with `invoke` vs `stream`

### With `stream()` - Recommended

Interrupt information is returned directly in the stream:

```typescript
for await (const chunk of await graph.stream(input, config)) {
  if (chunk.__interrupt__) {
    console.log('Graph interrupted:', chunk.__interrupt__);
    // Display to user, collect input, etc.
  }
}

// Resume
for await (const chunk of await graph.stream(
  new Command({ resume: userInput }),
  config,
)) {
  console.log(chunk);
}
```

### With `invoke()` - Requires `getState()`

`invoke()` does **not** return interrupt information:

```typescript
// Run until interrupt
const result = await graph.invoke(input, config);
// result does NOT contain __interrupt__

// Must use getState() to access interrupt info
const state = await graph.getState(config);

console.log(state.values); // Current state
console.log(state.tasks); // Includes interrupt info

// Example task structure:
// {
//   id: "uuid",
//   name: "human_node",
//   interrupts: [{
//     value: { question: "..." },
//     resumable: true,
//     ns: ["human_node:uuid"],
//     when: "during"
//   }]
// }

// Resume
await graph.invoke(new Command({ resume: userInput }), config);
```

---

## Common Pitfalls

### 1. Side Effects Before Interrupt

**Problem:** Code with side effects (API calls, database writes) placed before
`interrupt()` will execute **multiple times** because nodes re-execute from the
beginning when resuming.

❌ **Incorrect:**

```typescript
function humanNode(state: State) {
  // ⚠️ This API call will run AGAIN when resuming!
  apiCall(state.data);

  const answer = interrupt('Approve?');
  return { answer };
}
```

✅ **Correct Option 1 - Use `task()` utility (Recommended):**

```typescript
import { interrupt, task } from '@langchain/langgraph';

// Wrap the side effect in a task
const performApiCall = task('apiCall', async (data: any) => {
  return await apiCall(data);
});

async function humanNode(state: State) {
  // ✅ Task ensures this only executes once, even on resume
  await performApiCall(state.data);

  const answer = interrupt('Approve?');
  return { answer };
}
```

✅ **Correct Option 2 - Place after interrupt:**

```typescript
function humanNode(state: State) {
  const answer = interrupt('Approve?');

  // ✅ Side effect happens only once (after interrupt)
  apiCall(answer);

  return { answer };
}
```

✅ **Correct Option 3 - Separate node:**

```typescript
function humanNode(state: State) {
  const answer = interrupt('Approve?');
  return { answer };
}

function apiCallNode(state: State) {
  // ✅ Side effect in separate node (won't re-execute)
  apiCall(state.answer);
}

builder
  .addNode('human', humanNode)
  .addNode('api', apiCallNode)
  .addEdge('human', 'api');
```

---

### 2. Try-Catch Around Interrupt

**Problem:** `interrupt()` throws a special `GraphInterrupt` error to pause
execution.

❌ **Incorrect:**

```typescript
function myNode(state: State) {
  try {
    const value = interrupt('Input?');
    return { value };
  } catch (error) {
    // ⚠️ This catches GraphInterrupt and breaks HITL!
    console.error('Error:', error);
    return { value: null };
  }
}
```

✅ **Correct:**

```typescript
function myNode(state: State) {
  try {
    const value = interrupt('Input?');
    return { value };
  } catch (error) {
    // ✅ Re-throw GraphInterrupt
    if (error.name === 'GraphInterrupt') {
      throw error;
    }
    console.error('Other error:', error);
    return { value: null };
  }
}
```

---

### 3. Dynamic Interrupt Structure

**Problem:** Changing interrupt count/order between executions causes mismatched
resume values.

❌ **Incorrect:**

```typescript
function badNode(state: State) {
  let name;
  if (!state.name) {
    name = interrupt('What is your name?');
  } else {
    name = 'N/A';
  }

  let age;
  if (!state.age) {
    // ⚠️ Interrupt count changes based on state!
    age = interrupt('What is your age?');
  } else {
    age = 'N/A';
  }

  return { name, age };
}
```

✅ **Correct:**

```typescript
function goodNode(state: State) {
  // ✅ Always call interrupts in the same order
  const name = interrupt('What is your name?');
  const age = interrupt('What is your age?');

  return { name, age };
}
```

---

### 4. Subgraphs Called as Functions

When a subgraph with interrupts is invoked **as a function**, both the parent
node AND the subgraph node re-execute on resume:

```typescript
async function parentNode(state: State) {
  console.log('Parent node start'); // ⚠️ Runs again on resume

  const subResult = await subgraph.invoke(state); // Contains interrupt

  return subResult;
}
```

**Execution flow:**

1. First invocation: `parent_node` starts → calls `subgraph` → hits `interrupt`
   in subgraph
2. Resume: `parent_node` **starts from beginning** → `subgraph` resumes from
   interrupted node

---

## The `task()` Utility for Durable Execution

### Overview

The `task()` utility is LangGraph's **official solution** for handling side
effects and non-deterministic operations with interrupts. When you wrap
operations in tasks, their results are **checkpointed** and **not re-executed**
when the workflow resumes.

### Why Use Tasks?

When a node containing an `interrupt()` resumes, it **re-executes from the
beginning**. This causes problems for:

| Operation Type          | Problem                              | Solution         |
| ----------------------- | ------------------------------------ | ---------------- |
| **API Calls**           | Duplicate requests, wasted resources | Wrap in `task()` |
| **Database Writes**     | Duplicate entries, data corruption   | Wrap in `task()` |
| **File Operations**     | Multiple writes, inconsistent state  | Wrap in `task()` |
| **Email/Notifications** | Duplicate messages sent              | Wrap in `task()` |
| **Random Generation**   | Different values on resume           | Wrap in `task()` |
| **Current Time**        | Inconsistent timestamps              | Wrap in `task()` |

### Basic Usage

```typescript
import { task, interrupt } from '@langchain/langgraph';

// Define a task - wraps a side effect
const fetchUserData = task('fetchUserData', async (userId: string) => {
  const response = await fetch(`/api/users/${userId}`);
  return response.json();
});

// Use in a node
async function approvalNode(state: State) {
  // ✅ Task executes once, result is cached
  const userData = await fetchUserData(state.userId);

  // Interrupt for approval
  const approved = interrupt({
    question: 'Approve this user data?',
    data: userData,
  });

  return { userData, approved };
}
```

**Execution flow:**

1. First run: `fetchUserData` executes → result saved to checkpoint → hits
   `interrupt()`
2. After resume: `fetchUserData` **skipped** (result loaded from checkpoint) →
   `interrupt()` returns resume value

---

### Task Signature

```typescript
function task<Args extends any[], Result>(
  name: string,
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result>;
```

**Parameters:**

- `name` - Unique identifier for the task (used in checkpointing)
- `fn` - Async function containing the side effect

**Returns:** A wrapped version of the function that's checkpointed

---

### Multiple Tasks in One Node

```typescript
import { task, interrupt } from '@langchain/langgraph';

const validateEmail = task('validateEmail', async (email: string) => {
  const response = await fetch(`/api/validate-email`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return response.json();
});

const createAccount = task('createAccount', async (userData: any) => {
  const response = await fetch(`/api/accounts`, {
    method: 'POST',
    body: JSON.stringify(userData),
  });
  return response.json();
});

async function signupNode(state: State) {
  // ✅ Both tasks execute once
  const validationResult = await validateEmail(state.email);

  if (!validationResult.valid) {
    return { error: 'Invalid email' };
  }

  const account = await createAccount({
    email: state.email,
    name: state.name,
  });

  // Interrupt for user to verify email
  const verified = interrupt({
    message: 'Check your email for verification code',
    accountId: account.id,
  });

  return { account, verified };
}
```

---

### Tasks with Non-Deterministic Operations

**Random Number Generation:**

```typescript
import { task, interrupt } from '@langchain/langgraph';

const generateToken = task('generateToken', async () => {
  return Math.random().toString(36).substr(2, 9);
});

async function sessionNode(state: State) {
  // ✅ Same token returned on resume
  const token = await generateToken();

  const approved = interrupt({
    message: 'Session created',
    token: token,
  });

  return { token, approved };
}
```

**Timestamp Generation:**

```typescript
const getCurrentTimestamp = task('getCurrentTimestamp', async () => {
  return Date.now();
});

async function auditNode(state: State) {
  // ✅ Same timestamp on resume, ensuring consistency
  const timestamp = await getCurrentTimestamp();

  const approved = interrupt({
    action: state.action,
    timestamp: new Date(timestamp).toISOString(),
  });

  return { timestamp, approved };
}
```

---

### Tasks for API Calls with Idempotency

When working with external APIs, combine `task()` with idempotency keys:

```typescript
import { task, interrupt } from '@langchain/langgraph';
import { v4 as uuidv4 } from 'uuid';

const chargePayment = task(
  'chargePayment',
  async (params: {
    amount: number;
    currency: string;
    idempotencyKey: string;
  }) => {
    const response = await fetch(`/api/payments/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency,
      }),
    });

    return response.json();
  },
);

async function paymentNode(state: State) {
  // Generate idempotency key once (outside task for consistency)
  const idempotencyKey = state.idempotencyKey || uuidv4();

  // ✅ Payment charged once, even on resume
  const paymentResult = await chargePayment({
    amount: state.amount,
    currency: state.currency,
    idempotencyKey,
  });

  const approved = interrupt({
    question: 'Payment successful. Confirm order?',
    payment: paymentResult,
  });

  return {
    paymentResult,
    approved,
    idempotencyKey,
  };
}
```

---

### Error Handling in Tasks

Tasks can throw errors, which will be preserved in the checkpoint:

```typescript
const riskyApiCall = task('riskyApiCall', async (endpoint: string) => {
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status}`);
  }

  return response.json();
});

async function nodeWithErrorHandling(state: State) {
  try {
    const data = await riskyApiCall(state.endpoint);

    const approved = interrupt({
      question: 'Data retrieved. Continue?',
      data,
    });

    return { data, approved };
  } catch (error) {
    // Error is preserved across resume
    return {
      error: error.message,
      failed: true,
    };
  }
}
```

---

### Task Results are JSON-Serializable

Task return values must be JSON-serializable:

```typescript
// ✅ Good - JSON-serializable
const fetchJson = task('fetchJson', async () => {
  return {
    name: 'John',
    age: 30,
    items: ['a', 'b', 'c'],
  };
});

// ❌ Bad - Functions not serializable
const fetchFn = task('fetchFn', async () => {
  return {
    data: 'value',
    handler: () => console.log('Hi'), // ❌ Function not serializable
  };
});

// ✅ Good - Convert to serializable format
const fetchUser = task('fetchUser', async (id: string) => {
  const user = await getUserFromDb(id); // May have methods

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // Extract only serializable properties
  };
});
```

---

### Tasks vs Separate Nodes

**When to use tasks:**

- Single node with multiple side effects
- Side effects that logically belong together
- Need to maintain transaction-like behavior
- Working with Functional API style

**When to use separate nodes:**

- Side effect should be a distinct step in workflow
- Want clear visualization in graph
- Need conditional routing after side effect
- Following traditional StateGraph patterns

**Example - Same logic, two approaches:**

```typescript
// Approach 1: Using tasks
async function orderNode(state: State) {
  const validated = await validateOrder(state.order);
  const reserved = await reserveInventory(state.items);

  const approved = interrupt({ validated, reserved });

  const charged = await chargeCard(state.payment);

  return { validated, reserved, charged, approved };
}

// Approach 2: Using separate nodes
function validateNode(state: State) {
  const validated = validateOrder(state.order);
  return { validated };
}

function reserveNode(state: State) {
  const reserved = reserveInventory(state.items);
  return { reserved };
}

function approvalNode(state: State) {
  const approved = interrupt({
    validated: state.validated,
    reserved: state.reserved,
  });
  return { approved };
}

function chargeNode(state: State) {
  const charged = chargeCard(state.payment);
  return { charged };
}
```

---

### Tasks in Conditional Logic

Tasks work naturally with branches and loops:

```typescript
import { task, interrupt } from '@langchain/langgraph';

const attemptConnection = task(
  'attemptConnection',
  async (endpoint: string) => {
    const response = await fetch(endpoint);
    return {
      success: response.ok,
      status: response.status,
    };
  },
);

async function retryNode(state: State) {
  let attempts = 0;
  let result;

  while (attempts < 3) {
    result = await attemptConnection(state.endpoint);

    if (result.success) {
      break;
    }

    attempts++;
  }

  const approved = interrupt({
    question: `Connection ${result.success ? 'succeeded' : 'failed'} after ${attempts} attempts. Continue?`,
    result,
  });

  return { result, approved, attempts };
}
```

---

### Combining Tasks with Command

Tasks work seamlessly with the `Command` primitive for routing:

```typescript
import { task, interrupt, Command } from '@langchain/langgraph';

const checkRiskLevel = task('checkRiskLevel', async (data: any) => {
  const response = await fetch('/api/risk-check', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.json();
});

async function riskAssessmentNode(state: State): Promise<Command> {
  // ✅ Risk check happens once
  const riskResult = await checkRiskLevel({
    userId: state.userId,
    amount: state.amount,
  });

  if (riskResult.level === 'high') {
    const approved = interrupt({
      warning: 'High risk transaction detected',
      details: riskResult,
    });

    if (approved) {
      return new Command({ goto: 'process_transaction' });
    } else {
      return new Command({ goto: 'cancel_transaction' });
    }
  }

  // Low risk, proceed without approval
  return new Command({
    goto: 'process_transaction',
    update: { riskChecked: true },
  });
}
```

---

### Debugging Tasks

Tasks appear in LangSmith traces with their execution time and results:

```typescript
const slowOperation = task('slowOperation', async (data: any) => {
  console.log('[Task Start] slowOperation');
  const result = await expensiveComputation(data);
  console.log('[Task Complete] slowOperation:', result);
  return result;
});
```

When viewing traces in LangSmith:

- Task executions are clearly marked
- Can see which tasks were skipped (loaded from checkpoint)
- View individual task execution times
- Inspect task results at each checkpoint

---

### Best Practices with Tasks

1. **Name tasks descriptively:**

```typescript
// ✅ Good
const validateUserEmail = task("validateUserEmail", ...);
const chargePaymentCard = task("chargePaymentCard", ...);

// ❌ Bad
const task1 = task("task1", ...);
const doStuff = task("doStuff", ...);
```

2. **Keep tasks focused:**

```typescript
// ✅ Good - Single responsibility
const sendEmail = task('sendEmail', async (to, subject, body) => {
  return await emailService.send({ to, subject, body });
});

// ❌ Bad - Too many responsibilities
const doEverything = task('doEverything', async (data) => {
  await sendEmail(data.email);
  await updateDatabase(data.id);
  await notifySlack(data.message);
  // Too much in one task
});
```

3. **Pass serializable arguments:**

```typescript
// ✅ Good
const processData = task(
  'processData',
  async (data: { id: string; amount: number; items: string[] }) => {
    // ...
  },
);

// ❌ Bad - Non-serializable argument
const processData = task('processData', async (callback: Function) => {
  // Functions can't be checkpointed
});
```

4. **Use tasks for all external calls:**

```typescript
async function orderProcessingNode(state: State) {
  // ✅ All side effects wrapped
  const validated = await validateInventory(state.items);
  const authorized = await authorizePayment(state.card);
  const created = await createOrder(state.orderData);

  const approved = interrupt({ validated, authorized, created });

  if (approved) {
    await sendConfirmationEmail(state.email);
  }

  return { validated, authorized, created, approved };
}
```

---

### Migration: Before and After Tasks

**Before (problematic):**

```typescript
async function problematicNode(state: State) {
  // ⚠️ API call happens on EVERY resume
  const data = await fetch('/api/data').then((r) => r.json());

  const approved = interrupt({ data });

  // ⚠️ If resumed multiple times, duplicate writes
  await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  return { data, approved };
}
```

**After (fixed with tasks):**

```typescript
import { task, interrupt } from '@langchain/langgraph';

const fetchData = task('fetchData', async () => {
  const response = await fetch('/api/data');
  return response.json();
});

const saveData = task('saveData', async (data: any) => {
  const response = await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.json();
});

async function fixedNode(state: State) {
  // ✅ Executes once, cached on resume
  const data = await fetchData();

  const approved = interrupt({ data });

  // ✅ Only executes if approved
  if (approved) {
    await saveData(data);
  }

  return { data, approved };
}
```

---

## API Reference

### `interrupt(value: T): T`

**Purpose:** Pause graph execution and surface data to the client.

**Parameters:**

- `value` - Any JSON-serializable data to surface

**Returns:** The resume value provided via `Command({ resume: ... })`

**Throws:** `GraphInterrupt` error to pause execution

**Example:**

```typescript
const userInput = interrupt({
  prompt: 'Enter your email',
  validation: 'Must be valid email',
});
```

---

### `task(name: string, fn: (...args) => Promise<Result>): (...args) => Promise<Result>`

**Purpose:** Wrap side effects and non-deterministic operations to ensure they
execute only once, even during workflow resumption.

**Parameters:**

- `name` - Unique identifier for the task (used in checkpointing)
- `fn` - Async function containing the side effect or non-deterministic
  operation

**Returns:** A wrapped version of the function that's checkpointed

**Key Features:**

- Results are saved to checkpoints
- On resume, returns cached result instead of re-executing
- Works with both StateGraph nodes and Functional API
- Task results must be JSON-serializable

**Example:**

```typescript
import { task, interrupt } from '@langchain/langgraph';

const sendEmail = task('sendEmail', async (to: string, subject: string) => {
  const response = await emailService.send({ to, subject });
  return { messageId: response.id, sent: true };
});

async function notificationNode(state: State) {
  // ✅ Email sent once, result cached on resume
  const result = await sendEmail(state.email, 'Approval Needed');

  const approved = interrupt({
    message: 'Email sent. Approve?',
    messageId: result.messageId,
  });

  return { emailSent: true, approved };
}
```

---

### `Command` Class

**Purpose:** Control graph execution flow and state updates.

**Constructor:**

```typescript
new Command<Resume, Update, Nodes>({
  resume?: Resume;
  update?: Update;
  goto?: Nodes;
  graph?: typeof Command.PARENT | string;
})
```

**Properties:**

| Property | Type                              | Description                         |
| -------- | --------------------------------- | ----------------------------------- |
| `resume` | `Resume`                          | Value to pass back to `interrupt()` |
| `update` | `Update`                          | State updates to apply              |
| `goto`   | `Nodes \| Nodes[]`                | Next node(s) to execute             |
| `graph`  | `typeof Command.PARENT \| string` | Target graph for the command        |

**Constants:**

- `Command.PARENT` - Reference to the parent graph

**Example:**

```typescript
return new Command({
  resume: { approved: true },
  update: { status: 'reviewed' },
  goto: 'next_node',
});
```

---

### State Snapshot Structure

When using `getState()`, the returned object includes:

```typescript
{
  values: {
    // Current state values
  },
  next: ["node_name"],  // Next node(s) to execute
  tasks: [
    {
      id: "uuid",
      name: "human_node",
      path: ["__pregel_pull", "human_node"],
      error: null,
      interrupts: [
        {
          value: { question: "..." },  // Your interrupt value
          resumable: true,
          ns: ["human_node:uuid"],
          when: "during"
        }
      ],
      state: null,
      result: null
    }
  ],
  metadata: { ... },
  config: { ... },
  checkpoint_id: "...",
  parent_checkpoint_id: "..."
}
```

---

## Best Practices

### 1. Always Use Tasks for Side Effects

**Most Important:** Wrap all side effects in `task()` to prevent duplicate
execution:

```typescript
import { task, interrupt } from '@langchain/langgraph';

// ✅ Best Practice
const performDatabaseWrite = task('performDatabaseWrite', async (data) => {
  return await db.insert(data);
});

const callExternalAPI = task('callExternalAPI', async (endpoint) => {
  return await fetch(endpoint).then((r) => r.json());
});

async function dataProcessingNode(state: State) {
  const apiData = await callExternalAPI(state.endpoint);

  const approved = interrupt({ data: apiData });

  if (approved) {
    await performDatabaseWrite(apiData);
  }

  return { apiData, approved };
}

// ❌ Bad Practice
async function problematicNode(state: State) {
  // These will execute multiple times on resume!
  const apiData = await fetch(state.endpoint).then((r) => r.json());

  const approved = interrupt({ data: apiData });

  if (approved) {
    await db.insert(apiData); // Duplicate writes!
  }

  return { apiData, approved };
}
```

---

### 2. Use Descriptive Interrupt Values

❌ Bad:

```typescript
const value = interrupt('yes or no?');
```

✅ Good:

```typescript
const value = interrupt({
  type: 'approval_request',
  question: 'Approve database deletion?',
  action: {
    type: 'delete',
    database: 'production_db',
    records: 15000,
  },
  impact: 'high',
  reversible: false,
});
```

---

### 2. Use Descriptive Interrupt Values

❌ Bad:

```typescript
const value = interrupt('yes or no?');
```

✅ Good:

```typescript
const value = interrupt({
  type: 'approval_request',
  question: 'Approve database deletion?',
  action: {
    type: 'delete',
    database: 'production_db',
    records: 15000,
  },
  impact: 'high',
  reversible: false,
});
```

---

### 3. Structure Resume Values

For complex approvals, use structured objects:

```typescript
// In node
const review = interrupt({ type: "tool_review", ... });

const [action, data] = review;  // Destructure structured response

if (action === "approve") { ... }
else if (action === "edit") { ... }
else if (action === "reject") { ... }
```

```typescript
// When resuming
await graph.invoke(
  new Command({
    resume: ['edit', { field: 'new_value' }],
  }),
  config,
);
```

---

### 4. Always Use Production Checkpointers

```typescript
// ❌ Development only
import { MemorySaver } from '@langchain/langgraph';
const checkpointer = new MemorySaver();

// ✅ Production
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
const checkpointer = PostgresSaver.fromConnString(process.env.DB_URI);
```

---

### 5. Handle Thread IDs Properly

```typescript
// Generate unique thread IDs per conversation
import { v4 as uuidv4 } from 'uuid';

const threadId = uuidv4(); // or user-specific ID

const config = {
  configurable: {
    thread_id: `user-${userId}-conversation-${conversationId}`,
  },
};
```

---

### 6. Validate Resume Values

```typescript
function approvalNode(state: State): Command {
  const response = interrupt({ ... });

  // ✅ Validate resume value
  if (typeof response !== "boolean") {
    throw new Error("Expected boolean approval");
  }

  return new Command({
    goto: response ? "approved_node" : "rejected_node"
  });
}
```

---

### 7. Provide Clear User Feedback

```typescript
const review = interrupt({
  message: "Please review the following changes:",
  changes: {
    before: { ... },
    after: { ... }
  },
  options: [
    { value: "approve", label: "Approve Changes" },
    { value: "edit", label: "Edit Before Approving" },
    { value: "reject", label: "Reject Changes" }
  ],
  deadline: "30 minutes"
});
```

---

### 8. Handle Timeouts Gracefully

Since interrupts wait indefinitely, implement timeout logic in your application:

```typescript
// Application-level timeout
const timeout = setTimeout(
  async () => {
    // Auto-reject after 30 minutes
    await graph.invoke(new Command({ resume: false }), config);
  },
  30 * 60 * 1000,
);

// Clear timeout if human responds
clearTimeout(timeout);
```

---

### 9. Log Interrupt Events

```typescript
function approvalNode(state: State): Command {
  const payload = {
    action: state.pendingAction,
    timestamp: new Date().toISOString(),
    requestedBy: state.userId,
  };

  // Log before interrupt
  console.log('Requesting approval:', payload);

  const approved = interrupt(payload);

  // Log after resume
  console.log('Approval decision:', approved);

  return new Command({ goto: approved ? 'execute' : 'cancel' });
}
```

---

### 10. Design for Async Human Response

```typescript
// Backend API endpoint
app.post('/resume/:threadId', async (req, res) => {
  const { threadId } = req.params;
  const { resume_value } = req.body;

  const config = {
    configurable: { thread_id: threadId },
  };

  // Resume graph execution
  const result = await graph.invoke(
    new Command({ resume: resume_value }),
    config,
  );

  res.json({ success: true, result });
});
```

---

### 11. Test Interrupt Flows

```typescript
import { describe, it, expect } from '@jest/globals';

describe('Human approval node', () => {
  it('should route to execute on approval', async () => {
    const config = {
      configurable: { thread_id: 'test-123' },
    };

    // Run until interrupt
    await graph.invoke(input, config);

    // Resume with approval
    const result = await graph.invoke(new Command({ resume: true }), config);

    expect(result.status).toBe('executed');
  });

  it('should route to cancel on rejection', async () => {
    const config = {
      configurable: { thread_id: 'test-456' },
    };

    await graph.invoke(input, config);

    const result = await graph.invoke(new Command({ resume: false }), config);

    expect(result.status).toBe('cancelled');
  });
});
```

---

## Version Notes

### As of v1.0

- `interrupt()` is the **official recommended approach**
- `NodeInterrupt` exception is **deprecated** (removed in v2.0)
- Static breakpoints (`interrupt_before`, `interrupt_after`) should only be used
  for debugging

### Migration from Pre-1.0

If using legacy approaches:

**Before (v0.x):**

```typescript
import { NodeInterrupt } from '@langchain/langgraph';

function humanNode(state: State) {
  throw new NodeInterrupt({ value: 'approval needed' });
}

// Or static breakpoints
const graph = builder.compile({
  checkpointer,
  interrupt_before: ['action'],
});
```

**After (v1.0+):**

```typescript
import { interrupt } from '@langchain/langgraph';

function humanNode(state: State) {
  const value = interrupt({ question: 'approval needed' });
  return { approved: value };
}

const graph = builder.compile({ checkpointer });
```

---

## Additional Resources

### Official Documentation

- [LangGraph JS Concepts: Human-in-the-Loop](https://langchain-ai.github.io/langgraphjs/concepts/human_in_the_loop/)
- [How-to: Add Human Intervention](https://langchain-ai.github.io/langgraphjs/how-tos/human_in_the_loop/add-human-in-the-loop/)
- [How-to: Wait for User Input](https://langchain-ai.github.io/langgraphjs/how-tos/wait-user-input/)
- [How-to: Review Tool Calls](https://langchain-ai.github.io/langgraphjs/how-tos/review-tool-calls/)

### API References

- [`interrupt()` Function](https://langchain-ai.github.io/langgraphjs/reference/functions/langgraph.interrupt-2.html)
- [`Command` Class](https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.Command.html)
- [Persistence & Checkpointers](https://langchain-ai.github.io/langgraphjs/concepts/persistence/)

### Community

- [LangChain Forum](https://github.com/langchain-ai/langgraph/discussions)
- [GitHub Issues](https://github.com/langchain-ai/langgraphjs/issues)

---

## Summary

Human-in-the-Loop in LangGraph JS provides a robust, production-ready way to
integrate human oversight into AI workflows. Key takeaways:

✅ **Use `interrupt()`** for all HITL workflows (official as of v1.0)  
✅ **Wrap side effects in `task()`** to prevent duplicate execution on resume  
✅ **Always enable checkpointing** with a persistent store in production  
✅ **Use `Command` objects** to resume with complex logic  
✅ **Avoid side effects before `interrupt()`** unless wrapped in `task()`  
✅ **Structure interrupt payloads** for clear communication  
✅ **Handle resumption properly** - nodes re-execute from the start  
✅ **Test thoroughly** with different approval/rejection scenarios

The combination of `interrupt()`, `task()`, and `Command` enables you to build
reliable, trustworthy AI agents that combine automation with human expertise at
critical decision points, while ensuring side effects execute exactly once.

---

**Key Pattern:**

```typescript
import { task, interrupt, Command } from '@langchain/langgraph';

// Wrap side effects
const apiCall = task('apiCall', async (data) => {
  return await fetch('/api/action', {
    method: 'POST',
    body: JSON.stringify(data),
  });
});

// Use in node with interrupt
async function approvalNode(state: State): Promise<Command> {
  // ✅ Executes once, cached on resume
  const result = await apiCall(state.data);

  // Pause for human approval
  const approved = interrupt({
    question: 'Approve this action?',
    result,
  });

  // Route based on approval
  return new Command({
    goto: approved ? 'execute' : 'cancel',
    update: { result, approved },
  });
}
```
