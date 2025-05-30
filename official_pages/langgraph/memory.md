# LangGraph JS Memory: Definitive Guide

A comprehensive reference for implementing and managing memory in LangGraph.js applications, covering short-term memory, long-term memory, conversation history management, and advanced memory patterns.

## Table of Contents

1. [Overview](#overview)
2. [Core Memory Types](#core-memory-types)
3. [Short-Term Memory (Thread-Scoped)](#short-term-memory-thread-scoped)
4. [Managing Conversation History](#managing-conversation-history)
5. [Deleting Messages](#deleting-messages)
6. [Long-Term Memory (Cross-Thread)](#long-term-memory-cross-thread)
7. [Memory Stores and Persistence](#memory-stores-and-persistence)
8. [Advanced Memory Patterns](#advanced-memory-patterns)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

## Overview

Memory in AI applications refers to the ability to process, store, and effectively recall information from past interactions. In LangGraph.js, memory enables agents to learn from feedback, adapt to user preferences, and maintain context across conversations.

### Why Memory Matters

**Key Benefits:**
- **Continuity**: Maintain conversation context across interactions
- **Personalization**: Remember user preferences and adapt behavior
- **Efficiency**: Avoid repeating information or re-explaining concepts
- **Learning**: Improve performance based on past interactions
- **Context Management**: Balance precision, recall, latency, and cost

**Common Challenges:**
- Context window limitations in LLMs
- Managing growing conversation histories
- Balancing information retention vs. performance
- Cross-session persistence requirements

## Core Memory Types

LangGraph.js provides two fundamental types of memory based on recall scope:

### 1. Short-Term Memory (Thread-Scoped)
- **Scope**: Single conversational thread with a user
- **Storage**: Part of the agent's state, persisted via checkpoints
- **Use Cases**: Conversation history, session-specific data
- **Lifetime**: Duration of a single thread/conversation

### 2. Long-Term Memory (Cross-Thread)
- **Scope**: Shared across conversational threads
- **Storage**: Custom namespaces in memory stores
- **Use Cases**: User preferences, learned behaviors, facts about users
- **Lifetime**: Persistent across all conversations

## Short-Term Memory (Thread-Scoped)

Short-term memory in LangGraph is managed as part of the agent's state and persisted via thread-scoped checkpoints.

### Basic Setup with MessagesAnnotation

```javascript
import { 
  MessagesAnnotation, 
  StateGraph, 
  MemorySaver,
  START,
  END 
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// Use the built-in MessagesAnnotation for conversation history
const StateAnnotation = MessagesAnnotation;

// Initialize checkpointer for persistence
const checkpointer = new MemorySaver();

// Create a simple agent node
async function callModel(state) {
  const model = new ChatOpenAI({ model: "gpt-4o" });
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// Build the graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addEdge(START, "agent")
  .addEdge("agent", END);

const app = workflow.compile({ checkpointer });

// Usage with thread persistence
const config = { configurable: { thread_id: "conversation_1" } };

// First interaction
await app.invoke({
  messages: [new HumanMessage("Hi! My name is Alice.")]
}, config);

// Second interaction - agent remembers Alice
await app.invoke({
  messages: [new HumanMessage("What's my name?")]
}, config);
```

### Custom State with Additional Memory

```javascript
import { Annotation } from "@langchain/langgraph";

// Extend MessagesAnnotation with custom memory fields
const CustomStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  userProfile: Annotation({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),
  sessionData: Annotation({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),
  uploadedFiles: Annotation({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),
});

// Node that uses and updates custom memory
async function processWithMemory(state) {
  const { messages, userProfile, sessionData } = state;
  
  // Use existing memory in processing
  const model = new ChatOpenAI({ model: "gpt-4o" });
  const systemPrompt = `
    User Profile: ${JSON.stringify(userProfile)}
    Session Context: ${JSON.stringify(sessionData)}
  `;
  
  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    ...messages
  ]);
  
  // Update memory based on conversation
  const updates = {
    messages: [response]
  };
  
  // Extract and store user preferences
  if (response.content.includes("prefer")) {
    updates.userProfile = {
      preferences: extractPreferences(response.content)
    };
  }
  
  return updates;
}
```

## Managing Conversation History

Long conversations can exceed LLM context windows and degrade performance. LangGraph provides several strategies for managing conversation history.

### Strategy 1: Message Filtering

Filter messages before passing them to the LLM:

```javascript
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage } from "@langchain/core/messages";

// Simple filter - keep only the last N messages
const filterMessages = (messages, maxMessages = 10) => {
  if (messages.length <= maxMessages) {
    return messages;
  }
  
  // Keep system messages and last N messages
  const systemMessages = messages.filter(m => m.role === "system");
  const recentMessages = messages.slice(-maxMessages);
  
  return [...systemMessages, ...recentMessages];
};

// Advanced filter - token-based filtering
const filterMessagesByTokens = (messages, maxTokens = 4000) => {
  let tokenCount = 0;
  const filteredMessages = [];
  
  // Process messages in reverse order
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const messageTokens = estimateTokenCount(message.content);
    
    if (tokenCount + messageTokens <= maxTokens) {
      filteredMessages.unshift(message);
      tokenCount += messageTokens;
    } else {
      break;
    }
  }
  
  return filteredMessages;
};

// Node that applies filtering
async function callModelWithFiltering(state) {
  const model = new ChatAnthropic({ model: "claude-3-sonnet-20240229" });
  
  // Apply filtering before model call
  const filteredMessages = filterMessages(state.messages, 15);
  
  const response = await model.invoke(filteredMessages);
  return { messages: [response] };
}
```

### Strategy 2: Using LangChain's trimMessages

```javascript
import { trimMessages } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

async function callModelWithTrimming(state) {
  const model = new ChatOpenAI({ model: "gpt-4o" });
  
  // Trim messages to fit within token limit
  const trimmedMessages = await trimMessages(state.messages, {
    strategy: "last",
    tokenCounter: model,
    maxTokens: 4000,
    startOn: "human",
    endOn: ["human", "tool"],
    includeSystem: true,
  });
  
  const response = await model.invoke(trimmedMessages);
  return { messages: [response] };
}
```

### Strategy 3: Conversation Summarization

Summarize older parts of the conversation while keeping recent messages:

```javascript
import { MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, RemoveMessage } from "@langchain/core/messages";

// Extend state to include summary
const SummaryStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  summary: Annotation(),
});

async function summarizeConversation(state) {
  const { messages, summary } = state;
  const model = new ChatOpenAI({ model: "gpt-4o" });
  
  // Only summarize if we have many messages
  if (messages.length <= 10) {
    return {};
  }
  
  // Create summarization prompt
  const existingSummary = summary || "";
  let summaryPrompt;
  
  if (existingSummary) {
    summaryPrompt = 
      `This is a summary of the conversation so far: ${existingSummary}\n\n` +
      "Extend the summary by taking into account the new messages above:";
  } else {
    summaryPrompt = "Create a concise summary of the conversation above:";
  }
  
  // Include messages and summarization request
  const messagesToSummarize = [
    ...messages,
    new HumanMessage({ content: summaryPrompt })
  ];
  
  const response = await model.invoke(messagesToSummarize);
  
  // Delete all but the last 5 messages
  const deleteMessages = messages
    .slice(0, -5)
    .map(m => new RemoveMessage({ id: m.id }));
  
  return {
    summary: response.content,
    messages: deleteMessages,
  };
}

// Trigger summarization conditionally
function shouldSummarize(state) {
  return state.messages.length > 15 ? "summarize" : "continue";
}

const workflow = new StateGraph(SummaryStateAnnotation)
  .addNode("agent", callModel)
  .addNode("summarize", summarizeConversation)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldSummarize, {
    summarize: "summarize",
    continue: END
  })
  .addEdge("summarize", END);
```

### Strategy 4: Smart Context Management

Implement intelligent context management based on relevance:

```javascript
// Context-aware message filtering
async function filterRelevantMessages(messages, currentQuery, maxMessages = 10) {
  if (messages.length <= maxMessages) {
    return messages;
  }
  
  // Keep system messages
  const systemMessages = messages.filter(m => m.role === "system");
  const conversationMessages = messages.filter(m => m.role !== "system");
  
  // Always keep the last few messages
  const recentMessages = conversationMessages.slice(-5);
  const olderMessages = conversationMessages.slice(0, -5);
  
  // Score older messages by relevance to current query
  const scoredMessages = await Promise.all(
    olderMessages.map(async (message) => ({
      message,
      score: await calculateRelevanceScore(message.content, currentQuery)
    }))
  );
  
  // Select top relevant older messages
  const relevantOlderMessages = scoredMessages
    .sort((a, b) => b.score - a.score)
    .slice(0, maxMessages - recentMessages.length - systemMessages.length)
    .map(item => item.message);
  
  return [...systemMessages, ...relevantOlderMessages, ...recentMessages];
}

async function calculateRelevanceScore(messageContent, query) {
  // Simple keyword-based scoring (replace with semantic similarity in production)
  const queryWords = query.toLowerCase().split(' ');
  const messageWords = messageContent.toLowerCase().split(' ');
  const commonWords = queryWords.filter(word => messageWords.includes(word));
  return commonWords.length / queryWords.length;
}
```

## Deleting Messages

LangGraph provides several ways to delete messages from conversation history using the `RemoveMessage` modifier.

### Manual Message Deletion

Delete specific messages by ID:

```javascript
import { RemoveMessage } from "@langchain/core/messages";
import { MessagesAnnotation } from "@langchain/langgraph";

// Get current state and identify message to delete
const currentState = await app.getState(config);
const messages = currentState.values.messages;
const messageToDelete = messages[0]; // Delete first message

// Update state with RemoveMessage
await app.updateState(config, {
  messages: [new RemoveMessage({ id: messageToDelete.id })]
});

// Verify deletion
const updatedState = await app.getState(config);
console.log("Remaining messages:", updatedState.values.messages.length);
```

### Programmatic Message Deletion

Delete messages automatically within the graph:

```javascript
import { RemoveMessage } from "@langchain/core/messages";

// Node that deletes old messages
function deleteOldMessages(state) {
  const { messages } = state;
  const maxMessages = 10;
  
  if (messages.length > maxMessages) {
    // Delete messages beyond the limit
    const messagesToDelete = messages
      .slice(0, messages.length - maxMessages)
      .map(m => new RemoveMessage({ id: m.id }));
    
    return { messages: messagesToDelete };
  }
  
  return {};
}

// Conditional deletion based on criteria
function smartMessageDeletion(state) {
  const { messages } = state;
  const deletions = [];
  
  // Delete messages older than 1 hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const message of messages) {
    const messageTime = new Date(message.created_at || 0).getTime();
    if (messageTime < oneHourAgo) {
      deletions.push(new RemoveMessage({ id: message.id }));
    }
  }
  
  // Delete tool messages without keeping tool calls
  for (const message of messages) {
    if (message.role === "tool" && !isToolCallReferenced(message, messages)) {
      deletions.push(new RemoveMessage({ id: message.id }));
    }
  }
  
  return deletions.length > 0 ? { messages: deletions } : {};
}

function isToolCallReferenced(toolMessage, allMessages) {
  return allMessages.some(m => 
    m.tool_calls?.some(tc => tc.id === toolMessage.tool_call_id)
  );
}
```

### Bulk Message Operations

Perform bulk operations on message history:

```javascript
// Keep only specific message types
function keepOnlyHumanAndAI(state) {
  const { messages } = state;
  const allowedTypes = ["human", "ai"];
  
  const messagesToDelete = messages
    .filter(m => !allowedTypes.includes(m._getType()))
    .map(m => new RemoveMessage({ id: m.id }));
  
  return messagesToDelete.length > 0 ? { messages: messagesToDelete } : {};
}

// Delete messages matching pattern
function deleteMessagesByPattern(state, pattern) {
  const { messages } = state;
  
  const messagesToDelete = messages
    .filter(m => typeof m.content === "string" && pattern.test(m.content))
    .map(m => new RemoveMessage({ id: m.id }));
  
  return messagesToDelete.length > 0 ? { messages: messagesToDelete } : {};
}

// Example: Delete error messages
function deleteErrorMessages(state) {
  return deleteMessagesByPattern(state, /error|failed|exception/i);
}
```

### Custom Reducer for Message Management

Create a custom reducer that handles complex deletion logic:

```javascript
import { Annotation } from "@langchain/langgraph";

const ManagedMessagesAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (existing, updates) => {
      if (Array.isArray(updates)) {
        // Handle regular message additions
        return [...existing, ...updates];
      } else if (updates && typeof updates === "object") {
        // Handle custom deletion commands
        if (updates.type === "delete_by_age") {
          const cutoffTime = Date.now() - updates.maxAge;
          return existing.filter(m => {
            const messageTime = new Date(m.created_at || 0).getTime();
            return messageTime >= cutoffTime;
          });
        } else if (updates.type === "keep_last") {
          return existing.slice(-updates.count);
        } else if (updates.type === "delete_by_type") {
          return existing.filter(m => !updates.types.includes(m._getType()));
        }
      }
      return existing;
    },
    default: () => [],
  }),
});

// Usage examples
function managedDeletion(state) {
  return {
    messages: {
      type: "delete_by_age",
      maxAge: 60 * 60 * 1000, // 1 hour
    }
  };
}

function keepRecentMessages(state) {
  return {
    messages: {
      type: "keep_last",
      count: 20,
    }
  };
}
```

## Long-Term Memory (Cross-Thread)

Long-term memory allows information to persist across different conversations and sessions using LangGraph's Store interface.

### Basic Store Setup

```javascript
import { InMemoryStore } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";

// Create store (use database-backed store in production)
const store = new InMemoryStore();

// Define namespace structure
const getUserNamespace = (userId) => ["memories", userId];
const getOrgNamespace = (orgId) => ["organizations", orgId];

// Basic memory operations
async function storeUserMemory(userId, memoryType, data) {
  const namespace = getUserNamespace(userId);
  const key = `${memoryType}_${uuidv4()}`;
  
  await store.put(namespace, key, {
    type: memoryType,
    data: data,
    timestamp: new Date().toISOString(),
  });
  
  return key;
}

async function getUserMemories(userId, memoryType = null) {
  const namespace = getUserNamespace(userId);
  const filter = memoryType ? { type: memoryType } : {};
  
  return await store.search(namespace, { filter });
}

// Example usage
await storeUserMemory("user123", "preference", {
  theme: "dark",
  language: "javascript",
  notifications: true
});

await storeUserMemory("user123", "context", {
  currentProject: "langchain-app",
  expertise: "intermediate",
  goals: ["learn langgraph", "build chatbot"]
});
```

### Cross-Thread Graph Implementation

```javascript
import { 
  Annotation, 
  StateGraph, 
  START, 
  MemorySaver,
  LangGraphRunnableConfig 
} from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage } from "@langchain/core/messages";

const CrossThreadStateAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});

// Node that uses cross-thread memory
async function callModelWithMemory(state, config) {
  const store = config.store;
  const userId = config.configurable?.userId;
  
  if (!store || !userId) {
    throw new Error("Store and userId are required");
  }
  
  // Retrieve user memories
  const namespace = ["memories", userId];
  const memories = await store.search(namespace);
  
  // Format memories for the model
  const memoryInfo = memories
    .map(m => `${m.value.type}: ${JSON.stringify(m.value.data)}`)
    .join("\n");
  
  const systemMessage = `
    You are a helpful assistant. Here's what you know about the user:
    ${memoryInfo}
    
    Use this information to personalize your responses.
  `;
  
  // Check if we should store new memories
  const lastMessage = state.messages[state.messages.length - 1];
  if (shouldStoreMemory(lastMessage)) {
    await storeNewMemory(store, userId, lastMessage);
  }
  
  const model = new ChatAnthropic({ model: "claude-3-sonnet-20240229" });
  const response = await model.invoke([
    { role: "system", content: systemMessage },
    ...state.messages,
  ]);
  
  return { messages: [response] };
}

// Helper functions
function shouldStoreMemory(message) {
  if (typeof message.content !== "string") return false;
  
  const triggers = [
    "remember", "my name is", "i prefer", "i like", 
    "i don't like", "i'm working on", "my goal"
  ];
  
  return triggers.some(trigger => 
    message.content.toLowerCase().includes(trigger)
  );
}

async function storeNewMemory(store, userId, message) {
  const namespace = ["memories", userId];
  const key = uuidv4();
  
  // Extract memory type and data (simplified)
  let memoryType = "general";
  if (message.content.includes("name is")) memoryType = "identity";
  if (message.content.includes("prefer")) memoryType = "preference";
  if (message.content.includes("working on")) memoryType = "context";
  
  await store.put(namespace, key, {
    type: memoryType,
    data: message.content,
    timestamp: new Date().toISOString(),
  });
}

// Build graph with store
const workflow = new StateGraph(CrossThreadStateAnnotation)
  .addNode("call_model", callModelWithMemory)
  .addEdge(START, "call_model");

const app = workflow.compile({
  checkpointer: new MemorySaver(),
  store: store,
});
```

### Advanced Memory Management

```javascript
// Memory management with profiles
class UserProfileManager {
  constructor(store) {
    this.store = store;
  }
  
  async getProfile(userId) {
    const namespace = ["profiles", userId];
    const profile = await this.store.get(namespace, "profile");
    return profile?.value || this.getDefaultProfile();
  }
  
  async updateProfile(userId, updates) {
    const namespace = ["profiles", userId];
    const currentProfile = await this.getProfile(userId);
    const updatedProfile = { ...currentProfile, ...updates };
    
    await this.store.put(namespace, "profile", updatedProfile);
    return updatedProfile;
  }
  
  getDefaultProfile() {
    return {
      preferences: {},
      context: {},
      history: [],
      created: new Date().toISOString(),
    };
  }
  
  async addToHistory(userId, interaction) {
    const profile = await this.getProfile(userId);
    profile.history.push({
      ...interaction,
      timestamp: new Date().toISOString(),
    });
    
    // Keep only last 100 interactions
    if (profile.history.length > 100) {
      profile.history = profile.history.slice(-100);
    }
    
    await this.updateProfile(userId, { history: profile.history });
  }
}

// Memory collection manager
class MemoryCollectionManager {
  constructor(store) {
    this.store = store;
  }
  
  async addMemory(userId, memory) {
    const namespace = ["memories", userId];
    const key = uuidv4();
    
    await this.store.put(namespace, key, {
      ...memory,
      id: key,
      created: new Date().toISOString(),
    });
    
    return key;
  }
  
  async searchMemories(userId, query) {
    const namespace = ["memories", userId];
    
    // Search by content filter
    const memories = await this.store.search(namespace, {
      filter: { data: { $regex: new RegExp(query, 'i') } }
    });
    
    return memories.map(m => m.value);
  }
  
  async updateMemory(userId, memoryId, updates) {
    const namespace = ["memories", userId];
    const existing = await this.store.get(namespace, memoryId);
    
    if (existing) {
      const updated = {
        ...existing.value,
        ...updates,
        updated: new Date().toISOString(),
      };
      
      await this.store.put(namespace, memoryId, updated);
      return updated;
    }
    
    throw new Error(`Memory ${memoryId} not found`);
  }
  
  async deleteMemory(userId, memoryId) {
    const namespace = ["memories", userId];
    await this.store.delete(namespace, memoryId);
  }
}
```

## Memory Stores and Persistence

### InMemoryStore (Development)

```javascript
import { InMemoryStore } from "@langchain/langgraph";

// Basic in-memory store
const inMemoryStore = new InMemoryStore();

// With search indexing
const indexedStore = new InMemoryStore({
  index: {
    dims: 1536,
    embed: "openai:text-embedding-3-small",
  }
});

// Usage
await indexedStore.put(["users", "alice"], "preferences", {
  theme: "dark",
  language: "en",
  notifications: true
});

// Semantic search (requires embedding index)
const results = await indexedStore.search(
  ["users", "alice"], 
  { query: "user interface preferences" }
);
```

### Database-Backed Stores (Production)

```javascript
// Example: PostgreSQL-backed store
class PostgreSQLStore {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }
  
  async put(namespace, key, value) {
    const namespaceStr = namespace.join('/');
    const query = `
      INSERT INTO memory_store (namespace, key, value, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (namespace, key) 
      DO UPDATE SET value = $3, updated_at = NOW()
    `;
    
    await this.pool.query(query, [
      namespaceStr, 
      key, 
      JSON.stringify(value)
    ]);
  }
  
  async get(namespace, key) {
    const namespaceStr = namespace.join('/');
    const query = `
      SELECT value FROM memory_store 
      WHERE namespace = $1 AND key = $2
    `;
    
    const result = await this.pool.query(query, [namespaceStr, key]);
    return result.rows[0] ? {
      value: JSON.parse(result.rows[0].value)
    } : null;
  }
  
  async search(namespace, options = {}) {
    const namespaceStr = namespace.join('/');
    let query = `
      SELECT key, value FROM memory_store 
      WHERE namespace = $1
    `;
    const params = [namespaceStr];
    
    // Add filter conditions
    if (options.filter) {
      // Implement JSON filtering based on your database
      query += ` AND value @> $2`;
      params.push(JSON.stringify(options.filter));
    }
    
    const result = await this.pool.query(query, params);
    return result.rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value)
    }));
  }
  
  async delete(namespace, key) {
    const namespaceStr = namespace.join('/');
    const query = `
      DELETE FROM memory_store 
      WHERE namespace = $1 AND key = $2
    `;
    
    await this.pool.query(query, [namespaceStr, key]);
  }
}

// Redis-backed store example
class RedisStore {
  constructor(redis) {
    this.redis = redis;
  }
  
  async put(namespace, key, value) {
    const redisKey = `${namespace.join(':')}:${key}`;
    await this.redis.set(redisKey, JSON.stringify({
      value,
      created: new Date().toISOString()
    }));
  }
  
  async get(namespace, key) {
    const redisKey = `${namespace.join(':')}:${key}`;
    const result = await this.redis.get(redisKey);
    return result ? JSON.parse(result) : null;
  }
  
  async search(namespace, options = {}) {
    const pattern = `${namespace.join(':')}:*`;
    const keys = await this.redis.keys(pattern);
    
    const results = [];
    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value) {
        const parsed = JSON.parse(value);
        
        // Apply filters
        if (this.matchesFilter(parsed.value, options.filter)) {
          results.push({
            key: key.split(':').pop(),
            value: parsed.value
          });
        }
      }
    }
    
    return results;
  }
  
  matchesFilter(value, filter) {
    if (!filter) return true;
    
    // Simple filter matching
    for (const [key, expected] of Object.entries(filter)) {
      if (value[key] !== expected) return false;
    }
    
    return true;
  }
}
```

## Advanced Memory Patterns

### Pattern 1: Profile-Based Memory

```javascript
class ProfileMemoryPattern {
  constructor(store) {
    this.store = store;
  }
  
  async updateProfile(userId, conversation) {
    const namespace = ["profiles", userId];
    const currentProfile = await this.getProfile(userId);
    
    // Extract profile updates from conversation
    const updates = await this.extractProfileUpdates(
      conversation, 
      currentProfile
    );
    
    if (Object.keys(updates).length > 0) {
      const updatedProfile = { ...currentProfile, ...updates };
      await this.store.put(namespace, "profile", updatedProfile);
      return updatedProfile;
    }
    
    return currentProfile;
  }
  
  async getProfile(userId) {
    const namespace = ["profiles", userId];
    const result = await this.store.get(namespace, "profile");
    
    return result?.value || {
      name: null,
      preferences: {},
      expertise: {},
      goals: [],
      context: {},
      updated: new Date().toISOString()
    };
  }
  
  async extractProfileUpdates(conversation, currentProfile) {
    const model = new ChatOpenAI({ model: "gpt-4o" });
    
    const prompt = `
      Current profile: ${JSON.stringify(currentProfile, null, 2)}
      
      Conversation:
      ${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}
      
      Extract any new information about the user that should be added to their profile.
      Return only a JSON object with the updates, or {} if no updates needed.
      
      Focus on:
      - Name and identity
      - Preferences and settings
      - Expertise and skills
      - Goals and objectives
      - Current context and projects
    `;
    
    const response = await model.invoke([
      { role: "user", content: prompt }
    ]);
    
    try {
      return JSON.parse(response.content);
    } catch (error) {
      console.error("Failed to parse profile updates:", error);
      return {};
    }
  }
  
  async getPersonalizedPrompt(userId) {
    const profile = await this.getProfile(userId);
    
    let prompt = "You are a helpful assistant.";
    
    if (profile.name) {
      prompt += ` The user's name is ${profile.name}.`;
    }
    
    if (Object.keys(profile.preferences).length > 0) {
      prompt += ` User preferences: ${JSON.stringify(profile.preferences)}.`;
    }
    
    if (profile.expertise && Object.keys(profile.expertise).length > 0) {
      prompt += ` User expertise: ${JSON.stringify(profile.expertise)}.`;
    }
    
    if (profile.goals.length > 0) {
      prompt += ` User goals: ${profile.goals.join(', ')}.`;
    }
    
    return prompt;
  }
}
```

### Pattern 2: Document Collection Memory

```javascript
class DocumentCollectionPattern {
  constructor(store) {
    this.store = store;
  }
  
  async addMemoryDocument(userId, content, metadata = {}) {
    const namespace = ["memories", userId];
    const key = uuidv4();
    
    // Extract structured information from content
    const structured = await this.structureContent(content);
    
    const document = {
      id: key,
      content,
      structured,
      metadata,
      created: new Date().toISOString(),
      relevance_score: 1.0,
    };
    
    await this.store.put(namespace, key, document);
    
    // Update related memories
    await this.updateRelatedMemories(userId, document);
    
    return key;
  }
  
  async structureContent(content) {
    const model = new ChatOpenAI({ model: "gpt-4o" });
    
    const prompt = `
      Extract structured information from this content:
      "${content}"
      
      Return a JSON object with:
      - topics: array of main topics discussed
      - entities: array of people, places, things mentioned
      - intent: user's intent or goal
      - sentiment: positive/negative/neutral
      - actionable: boolean - does this require follow-up?
      
      Example: {"topics": ["coding"], "entities": ["Python"], "intent": "learn", "sentiment": "positive", "actionable": true}
    `;
    
    const response = await model.invoke([
      { role: "user", content: prompt }
    ]);
    
    try {
      return JSON.parse(response.content);
    } catch (error) {
      return {
        topics: [],
        entities: [],
        intent: "unknown",
        sentiment: "neutral",
        actionable: false
      };
    }
  }
  
  async searchMemories(userId, query, limit = 10) {
    const namespace = ["memories", userId];
    const memories = await this.store.search(namespace);
    
    // Score memories by relevance to query
    const scoredMemories = await Promise.all(
      memories.map(async memory => ({
        ...memory,
        relevance: await this.calculateRelevance(query, memory.value)
      }))
    );
    
    // Sort by relevance and return top results
    return scoredMemories
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(item => item.value);
  }
  
  async calculateRelevance(query, memory) {
    // Simple keyword-based relevance (upgrade to semantic similarity in production)
    const queryWords = query.toLowerCase().split(' ');
    const contentWords = memory.content.toLowerCase().split(' ');
    const structuredText = JSON.stringify(memory.structured).toLowerCase();
    
    const contentMatches = queryWords.filter(word => 
      contentWords.includes(word) || structuredText.includes(word)
    ).length;
    
    return contentMatches / queryWords.length;
  }
  
  async updateRelatedMemories(userId, newMemory) {
    const namespace = ["memories", userId];
    const allMemories = await this.store.search(namespace);
    
    // Find memories with shared topics or entities
    for (const memory of allMemories) {
      if (memory.key === newMemory.id) continue;
      
      const sharedTopics = this.findSharedElements(
        newMemory.structured.topics,
        memory.value.structured.topics
      );
      
      const sharedEntities = this.findSharedElements(
        newMemory.structured.entities,
        memory.value.structured.entities
      );
      
      if (sharedTopics.length > 0 || sharedEntities.length > 0) {
        // Update relevance scores or add cross-references
        memory.value.relevance_score = Math.min(
          memory.value.relevance_score + 0.1,
          2.0
        );
        
        memory.value.related = memory.value.related || [];
        if (!memory.value.related.includes(newMemory.id)) {
          memory.value.related.push(newMemory.id);
        }
        
        await this.store.put(namespace, memory.key, memory.value);
      }
    }
  }
  
  findSharedElements(array1, array2) {
    return array1.filter(item => array2.includes(item));
  }
}
```

### Pattern 3: Instruction Evolution

```javascript
class InstructionEvolutionPattern {
  constructor(store) {
    this.store = store;
  }
  
  async updateInstructions(agentId, conversation, performance) {
    const namespace = ["agent_instructions", agentId];
    const currentInstructions = await this.getCurrentInstructions(agentId);
    
    // Analyze conversation for improvement opportunities
    const improvements = await this.analyzePerformance(
      conversation,
      performance,
      currentInstructions
    );
    
    if (improvements.shouldUpdate) {
      const newInstructions = await this.generateUpdatedInstructions(
        currentInstructions,
        improvements
      );
      
      await this.store.put(namespace, "current", {
        instructions: newInstructions,
        version: currentInstructions.version + 1,
        updated: new Date().toISOString(),
        reasoning: improvements.reasoning,
      });
      
      // Archive previous version
      await this.store.put(
        namespace, 
        `version_${currentInstructions.version}`, 
        currentInstructions
      );
      
      return newInstructions;
    }
    
    return currentInstructions.instructions;
  }
  
  async getCurrentInstructions(agentId) {
    const namespace = ["agent_instructions", agentId];
    const result = await this.store.get(namespace, "current");
    
    return result?.value || {
      instructions: "You are a helpful assistant.",
      version: 1,
      updated: new Date().toISOString(),
    };
  }
  
  async analyzePerformance(conversation, performance, currentInstructions) {
    const model = new ChatOpenAI({ model: "gpt-4o" });
    
    const prompt = `
      Current instructions: ${currentInstructions.instructions}
      
      Conversation:
      ${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}
      
      Performance metrics:
      ${JSON.stringify(performance)}
      
      Analyze if the instructions should be updated based on:
      1. User feedback in the conversation
      2. Performance issues (errors, misunderstandings)
      3. Recurring patterns that could be addressed
      
      Return JSON:
      {
        "shouldUpdate": boolean,
        "reasoning": "explanation of why update is needed",
        "improvements": ["specific areas to improve"]
      }
    `;
    
    const response = await model.invoke([
      { role: "user", content: prompt }
    ]);
    
    try {
      return JSON.parse(response.content);
    } catch (error) {
      return { shouldUpdate: false };
    }
  }
  
  async generateUpdatedInstructions(current, improvements) {
    const model = new ChatOpenAI({ model: "gpt-4o" });
    
    const prompt = `
      Current instructions: ${current.instructions}
      
      Areas for improvement:
      ${improvements.improvements.join('\n')}
      
      Reasoning: ${improvements.reasoning}
      
      Generate updated instructions that address these issues while maintaining the core purpose.
      Return only the new instructions text.
    `;
    
    const response = await model.invoke([
      { role: "user", content: prompt }
    ]);
    
    return response.content;
  }
}
```

### Pattern 4: Few-Shot Example Management

```javascript
class FewShotExamplePattern {
  constructor(store) {
    this.store = store;
  }
  
  async addExample(category, input, output, metadata = {}) {
    const namespace = ["examples", category];
    const key = uuidv4();
    
    const example = {
      id: key,
      input,
      output,
      metadata,
      created: new Date().toISOString(),
      usage_count: 0,
      effectiveness_score: 0.5,
    };
    
    await this.store.put(namespace, key, example);
    return key;
  }
  
  async selectExamples(category, query, maxExamples = 3) {
    const namespace = ["examples", category];
    const allExamples = await this.store.search(namespace);
    
    // Score examples by relevance and effectiveness
    const scoredExamples = await Promise.all(
      allExamples.map(async example => ({
        ...example,
        relevance: await this.calculateExampleRelevance(query, example.value),
        effectiveness: example.value.effectiveness_score,
      }))
    );
    
    // Combined scoring: relevance * effectiveness * freshness
    const rankedExamples = scoredExamples
      .map(example => ({
        ...example,
        score: this.calculateCombinedScore(example)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxExamples);
    
    // Update usage counts
    for (const example of rankedExamples) {
      example.value.usage_count += 1;
      await this.store.put(namespace, example.key, example.value);
    }
    
    return rankedExamples.map(e => e.value);
  }
  
  async calculateExampleRelevance(query, example) {
    // Simple similarity (upgrade to semantic similarity in production)
    const queryWords = query.toLowerCase().split(' ');
    const inputWords = example.input.toLowerCase().split(' ');
    
    const matches = queryWords.filter(word => inputWords.includes(word));
    return matches.length / queryWords.length;
  }
  
  calculateCombinedScore(example) {
    const relevance = example.relevance;
    const effectiveness = example.effectiveness;
    const recency = this.calculateRecencyScore(example.value.created);
    
    return relevance * 0.4 + effectiveness * 0.4 + recency * 0.2;
  }
  
  calculateRecencyScore(createdDate) {
    const daysSinceCreated = (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - daysSinceCreated / 365); // Decay over a year
  }
  
  async updateEffectiveness(exampleId, category, feedback) {
    const namespace = ["examples", category];
    const example = await this.store.get(namespace, exampleId);
    
    if (example) {
      // Update effectiveness based on feedback
      const currentScore = example.value.effectiveness_score;
      const adjustment = feedback.positive ? 0.1 : -0.1;
      
      example.value.effectiveness_score = Math.max(0, Math.min(1, 
        currentScore + adjustment
      ));
      
      await this.store.put(namespace, exampleId, example.value);
    }
  }
  
  async formatExamplesForPrompt(examples) {
    return examples.map((example, index) => 
      `Example ${index + 1}:\nInput: ${example.input}\nOutput: ${example.output}`
    ).join('\n\n');
  }
}
```

## Best Practices

### 1. Memory Architecture Design

```javascript
// Design clear memory hierarchies
class MemoryArchitecture {
  constructor(stores) {
    this.sessionStore = stores.session;    // Short-term, thread-scoped
    this.userStore = stores.user;          // Long-term, user-scoped
    this.organizationStore = stores.org;   // Shared across organization
    this.globalStore = stores.global;      // System-wide knowledge
  }
  
  async getContext(userId, threadId, orgId) {
    // Combine memories from different scopes
    const [sessionData, userData, orgData, globalData] = await Promise.all([
      this.getSessionContext(threadId),
      this.getUserContext(userId),
      this.getOrganizationContext(orgId),
      this.getGlobalContext()
    ]);
    
    return {
      session: sessionData,
      user: userData,
      organization: orgData,
      global: globalData,
    };
  }
  
  async getSessionContext(threadId) {
    // Get conversation history and session-specific data
    return await this.sessionStore.search(["threads", threadId]);
  }
  
  async getUserContext(userId) {
    // Get user profile, preferences, and personal memories
    return await this.userStore.search(["users", userId]);
  }
  
  async getOrganizationContext(orgId) {
    // Get organization-wide knowledge and policies
    return await this.organizationStore.search(["orgs", orgId]);
  }
  
  async getGlobalContext() {
    // Get system-wide knowledge and instructions
    return await this.globalStore.search(["global"]);
  }
}
```

### 2. Performance Optimization

```javascript
// Implement caching for frequently accessed memories
class CachedMemoryManager {
  constructor(store, cacheSize = 1000) {
    this.store = store;
    this.cache = new Map();
    this.cacheSize = cacheSize;
    this.accessCounts = new Map();
  }
  
  async get(namespace, key) {
    const cacheKey = `${namespace.join(':')}:${key}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      this.accessCounts.set(cacheKey, 
        (this.accessCounts.get(cacheKey) || 0) + 1
      );
      return this.cache.get(cacheKey);
    }
    
    // Fetch from store
    const result = await this.store.get(namespace, key);
    
    // Cache the result
    if (result) {
      this.cacheWithEviction(cacheKey, result);
    }
    
    return result;
  }
  
  cacheWithEviction(key, value) {
    // Evict least recently used if cache is full
    if (this.cache.size >= this.cacheSize) {
      const lruKey = this.findLRUKey();
      this.cache.delete(lruKey);
      this.accessCounts.delete(lruKey);
    }
    
    this.cache.set(key, value);
    this.accessCounts.set(key, 1);
  }
  
  findLRUKey() {
    let minAccess = Infinity;
    let lruKey = null;
    
    for (const [key, count] of this.accessCounts) {
      if (count < minAccess) {
        minAccess = count;
        lruKey = key;
      }
    }
    
    return lruKey;
  }
  
  invalidate(namespace, key) {
    const cacheKey = `${namespace.join(':')}:${key}`;
    this.cache.delete(cacheKey);
    this.accessCounts.delete(cacheKey);
  }
}
```

### 3. Memory Lifecycle Management

```javascript
class MemoryLifecycleManager {
  constructor(store) {
    this.store = store;
  }
  
  // Automatic cleanup of old memories
  async cleanupOldMemories(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const cutoffDate = new Date(Date.now() - maxAge);
    
    // This would need to be implemented based on your store
    const namespaces = await this.getAllNamespaces();
    
    for (const namespace of namespaces) {
      const memories = await this.store.search(namespace);
      
      for (const memory of memories) {
        const created = new Date(memory.value.created || 0);
        if (created < cutoffDate) {
          await this.store.delete(namespace, memory.key);
        }
      }
    }
  }
  
  // Compress related memories
  async compressMemories(userId, threshold = 10) {
    const namespace = ["memories", userId];
    const memories = await this.store.search(namespace);
    
    // Group similar memories
    const groups = this.groupSimilarMemories(memories);
    
    for (const group of groups) {
      if (group.length >= threshold) {
        const compressed = await this.compressMemoryGroup(group);
        
        // Delete individual memories
        for (const memory of group) {
          await this.store.delete(namespace, memory.key);
        }
        
        // Store compressed version
        await this.store.put(namespace, uuidv4(), compressed);
      }
    }
  }
  
  groupSimilarMemories(memories) {
    // Simple grouping by topic similarity
    const groups = [];
    const processed = new Set();
    
    for (const memory of memories) {
      if (processed.has(memory.key)) continue;
      
      const group = [memory];
      processed.add(memory.key);
      
      for (const other of memories) {
        if (processed.has(other.key)) continue;
        
        if (this.areSimilar(memory.value, other.value)) {
          group.push(other);
          processed.add(other.key);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }
  
  areSimilar(memory1, memory2) {
    // Simple similarity check
    if (!memory1.structured || !memory2.structured) return false;
    
    const topics1 = memory1.structured.topics || [];
    const topics2 = memory2.structured.topics || [];
    
    const sharedTopics = topics1.filter(t => topics2.includes(t));
    return sharedTopics.length > 0;
  }
  
  async compressMemoryGroup(memories) {
    const model = new ChatOpenAI({ model: "gpt-4o" });
    
    const memoryTexts = memories.map(m => m.value.content).join('\n\n');
    
    const prompt = `
      Compress these related memories into a single, comprehensive summary:
      
      ${memoryTexts}
      
      Create a summary that preserves all important information while being more concise.
    `;
    
    const response = await model.invoke([
      { role: "user", content: prompt }
    ]);
    
    return {
      type: "compressed",
      content: response.content,
      original_count: memories.length,
      created: new Date().toISOString(),
      compressed_from: memories.map(m => m.key),
    };
  }
}
```

### 4. Error Handling and Resilience

```javascript
class ResilientMemoryManager {
  constructor(primaryStore, backupStore = null) {
    this.primaryStore = primaryStore;
    this.backupStore = backupStore;
    this.fallbackData = new Map();
  }
  
  async resilientGet(namespace, key) {
    try {
      return await this.primaryStore.get(namespace, key);
    } catch (error) {
      console.warn("Primary store failed, trying backup:", error);
      
      if (this.backupStore) {
        try {
          return await this.backupStore.get(namespace, key);
        } catch (backupError) {
          console.warn("Backup store also failed:", backupError);
        }
      }
      
      // Return fallback data if available
      const fallbackKey = `${namespace.join(':')}:${key}`;
      return this.fallbackData.get(fallbackKey) || null;
    }
  }
  
  async resilientPut(namespace, key, value) {
    const results = [];
    
    // Store in fallback cache immediately
    const fallbackKey = `${namespace.join(':')}:${key}`;
    this.fallbackData.set(fallbackKey, { value });
    
    // Try primary store
    try {
      await this.primaryStore.put(namespace, key, value);
      results.push({ store: "primary", success: true });
    } catch (error) {
      results.push({ store: "primary", success: false, error });
    }
    
    // Try backup store
    if (this.backupStore) {
      try {
        await this.backupStore.put(namespace, key, value);
        results.push({ store: "backup", success: true });
      } catch (error) {
        results.push({ store: "backup", success: false, error });
      }
    }
    
    // Check if at least one succeeded
    const hasSuccess = results.some(r => r.success);
    if (!hasSuccess) {
      throw new Error("All storage attempts failed");
    }
    
    return results;
  }
  
  async syncStores() {
    if (!this.backupStore) return;
    
    // Sync data between primary and backup stores
    try {
      const namespaces = await this.getAllNamespaces();
      
      for (const namespace of namespaces) {
        const primaryData = await this.primaryStore.search(namespace);
        const backupData = await this.backupStore.search(namespace);
        
        // Sync differences
        await this.syncNamespace(namespace, primaryData, backupData);
      }
    } catch (error) {
      console.error("Store sync failed:", error);
    }
  }
  
  async syncNamespace(namespace, primaryData, backupData) {
    const primaryKeys = new Set(primaryData.map(d => d.key));
    const backupKeys = new Set(backupData.map(d => d.key));
    
    // Add missing items to backup
    for (const item of primaryData) {
      if (!backupKeys.has(item.key)) {
        await this.backupStore.put(namespace, item.key, item.value);
      }
    }
    
    // Add missing items to primary
    for (const item of backupData) {
      if (!primaryKeys.has(item.key)) {
        await this.primaryStore.put(namespace, item.key, item.value);
      }
    }
  }
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Memory Not Persisting

```javascript
// Problem: Memories disappear between sessions
// Solution: Verify checkpointer and store configuration

// ❌ Wrong: No checkpointer
const graph = workflow.compile();

// ✅ Correct: With checkpointer and store
const graph = workflow.compile({
  checkpointer: new MemorySaver(),
  store: new InMemoryStore(),
});

// Verify configuration
async function debugMemoryPersistence(graph, config) {
  console.log("Graph has checkpointer:", !!graph.checkpointer);
  console.log("Graph has store:", !!graph.store);
  console.log("Config thread_id:", config.configurable?.thread_id);
  
  // Test basic memory operations
  const testMemory = { test: "value", timestamp: new Date().toISOString() };
  
  if (graph.store) {
    await graph.store.put(["test"], "debug", testMemory);
    const retrieved = await graph.store.get(["test"], "debug");
    console.log("Store test successful:", !!retrieved);
  }
}
```

#### 2. Context Window Overflow

```javascript
// Problem: Too much conversation history
// Solution: Implement smart context management

class ContextWindowManager {
  constructor(maxTokens = 4000) {
    this.maxTokens = maxTokens;
  }
  
  async manageContext(messages, summarizer) {
    const totalTokens = this.estimateTokenCount(messages);
    
    if (totalTokens <= this.maxTokens) {
      return messages;
    }
    
    // Strategy 1: Summarize old messages
    const [oldMessages, recentMessages] = this.splitMessages(messages, 0.3);
    
    if (oldMessages.length > 0) {
      const summary = await summarizer.summarize(oldMessages);
      return [
        { role: "system", content: `Previous conversation: ${summary}` },
        ...recentMessages
      ];
    }
    
    // Strategy 2: Aggressive filtering
    return this.aggressiveFilter(messages);
  }
  
  estimateTokenCount(messages) {
    // Rough estimation: 1 token ≈ 4 characters
    return messages.reduce((total, msg) => 
      total + (msg.content?.length || 0) / 4, 0
    );
  }
  
  splitMessages(messages, oldRatio) {
    const splitIndex = Math.floor(messages.length * oldRatio);
    return [
      messages.slice(0, splitIndex),
      messages.slice(splitIndex)
    ];
  }
  
  aggressiveFilter(messages) {
    // Keep system messages and last 5 exchanges
    const systemMessages = messages.filter(m => m.role === "system");
    const conversationMessages = messages.filter(m => m.role !== "system");
    const recentMessages = conversationMessages.slice(-10);
    
    return [...systemMessages, ...recentMessages];
  }
}
```

#### 3. Memory Retrieval Performance

```javascript
// Problem: Slow memory searches
// Solution: Optimize search and add indexing

class OptimizedMemorySearch {
  constructor(store) {
    this.store = store;
    this.searchCache = new Map();
    this.indexCache = new Map();
  }
  
  async optimizedSearch(namespace, query, options = {}) {
    const cacheKey = this.createCacheKey(namespace, query, options);
    
    // Check cache first
    if (this.searchCache.has(cacheKey)) {
      const cached = this.searchCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
        return cached.results;
      }
    }
    
    // Build search index if not exists
    const index = await this.getOrBuildIndex(namespace);
    
    // Perform optimized search
    const results = await this.searchWithIndex(index, query, options);
    
    // Cache results
    this.searchCache.set(cacheKey, {
      results,
      timestamp: Date.now()
    });
    
    return results;
  }
  
  async getOrBuildIndex(namespace) {
    const indexKey = namespace.join(':');
    
    if (this.indexCache.has(indexKey)) {
      return this.indexCache.get(indexKey);
    }
    
    // Build index
    const allMemories = await this.store.search(namespace);
    const index = this.buildSearchIndex(allMemories);
    
    this.indexCache.set(indexKey, index);
    return index;
  }
  
  buildSearchIndex(memories) {
    const index = {
      keywords: new Map(),
      topics: new Map(),
      entities: new Map(),
      memories: new Map()
    };
    
    for (const memory of memories) {
      index.memories.set(memory.key, memory.value);
      
      // Index keywords
      const words = this.extractWords(memory.value.content);
      for (const word of words) {
        if (!index.keywords.has(word)) {
          index.keywords.set(word, new Set());
        }
        index.keywords.get(word).add(memory.key);
      }
      
      // Index structured data
      if (memory.value.structured) {
        for (const topic of memory.value.structured.topics || []) {
          if (!index.topics.has(topic)) {
            index.topics.set(topic, new Set());
          }
          index.topics.get(topic).add(memory.key);
        }
      }
    }
    
    return index;
  }
  
  extractWords(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }
  
  searchWithIndex(index, query, options) {
    const queryWords = this.extractWords(query);
    const matchingKeys = new Set();
    
    // Find memories matching query words
    for (const word of queryWords) {
      const wordMatches = index.keywords.get(word);
      if (wordMatches) {
        for (const key of wordMatches) {
          matchingKeys.add(key);
        }
      }
    }
    
    // Convert to memory objects and score
    const results = Array.from(matchingKeys)
      .map(key => ({
        key,
        value: index.memories.get(key),
        score: this.calculateScore(query, index.memories.get(key))
      }))
      .sort((a, b) => b.score - a.score);
    
    // Apply limit
    if (options.limit) {
      return results.slice(0, options.limit);
    }
    
    return results;
  }
  
  calculateScore(query, memory) {
    const queryWords = this.extractWords(query);
    const memoryWords = this.extractWords(memory.content);
    
    const matches = queryWords.filter(word => memoryWords.includes(word));
    return matches.length / queryWords.length;
  }
  
  createCacheKey(namespace, query, options) {
    return `${namespace.join(':')}:${query}:${JSON.stringify(options)}`;
  }
  
  clearCache() {
    this.searchCache.clear();
    this.indexCache.clear();
  }
}
```

#### 4. Memory Consistency Issues

```javascript
// Problem: Inconsistent memory states across threads
// Solution: Implement memory validation and repair

class MemoryConsistencyManager {
  constructor(store) {
    this.store = store;
  }
  
  async validateMemoryConsistency(userId) {
    const issues = [];
    
    // Check for duplicate memories
    const duplicates = await this.findDuplicateMemories(userId);
    if (duplicates.length > 0) {
      issues.push({ type: "duplicates", data: duplicates });
    }
    
    // Check for orphaned references
    const orphaned = await this.findOrphanedReferences(userId);
    if (orphaned.length > 0) {
      issues.push({ type: "orphaned", data: orphaned });
    }
    
    // Check for invalid data
    const invalid = await this.findInvalidData(userId);
    if (invalid.length > 0) {
      issues.push({ type: "invalid", data: invalid });
    }
    
    return issues;
  }
  
  async findDuplicateMemories(userId) {
    const namespace = ["memories", userId];
    const memories = await this.store.search(namespace);
    const duplicates = [];
    const seen = new Map();
    
    for (const memory of memories) {
      const contentHash = this.hashContent(memory.value.content);
      
      if (seen.has(contentHash)) {
        duplicates.push({
          original: seen.get(contentHash),
          duplicate: memory
        });
      } else {
        seen.set(contentHash, memory);
      }
    }
    
    return duplicates;
  }
  
  async repairMemoryIssues(userId, issues) {
    for (const issue of issues) {
      switch (issue.type) {
        case "duplicates":
          await this.removeDuplicates(userId, issue.data);
          break;
        case "orphaned":
          await this.cleanupOrphanedReferences(userId, issue.data);
          break;
        case "invalid":
          await this.fixInvalidData(userId, issue.data);
          break;
      }
    }
  }
  
  async removeDuplicates(userId, duplicates) {
    const namespace = ["memories", userId];
    
    for (const duplicate of duplicates) {
      // Keep the newer version, delete the older
      const originalDate = new Date(duplicate.original.value.created);
      const duplicateDate = new Date(duplicate.duplicate.value.created);
      
      if (duplicateDate > originalDate) {
        await this.store.delete(namespace, duplicate.original.key);
      } else {
        await this.store.delete(namespace, duplicate.duplicate.key);
      }
    }
  }
  
  hashContent(content) {
    // Simple hash function (use crypto.createHash in production)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }
}
```

## Conclusion

Memory is a crucial component of sophisticated LangGraph.js applications. This guide covered:

- **Short-term memory**: Thread-scoped conversation history and session data
- **Long-term memory**: Cross-thread persistence using stores
- **Conversation management**: Strategies for handling growing message lists
- **Message deletion**: Programmatic and manual approaches
- **Advanced patterns**: Profile management, document collections, and instruction evolution
- **Best practices**: Performance optimization, error handling, and memory lifecycle management

**Key Takeaways:**

1. **Choose the right memory type**: Use short-term for conversation context, long-term for user knowledge
2. **Manage context windows**: Implement filtering, summarization, or smart selection strategies
3. **Design for scale**: Consider caching, indexing, and cleanup strategies early
4. **Handle errors gracefully**: Implement fallbacks and validation for production systems
5. **Monitor and optimize**: Track memory usage and performance to maintain good user experience

Memory management in LangGraph is highly customizable, allowing you to build sophisticated agents that learn and adapt while maintaining excellent performance and reliability.
