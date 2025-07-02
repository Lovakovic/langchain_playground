# Langchain Playground

This repository contains working examples of Langchain usage.

## Structure

- `src/examples`: Contains standalone examples, each in its own directory.
  - Each example directory has an `index.ts` file that can be run directly (e.g., using `ts-node src/examples/some-example/index.ts`).
- `src/shared`: Contains shared utility code, like model configurations.
- `assets`: Contains any assets (images, etc.) used by the examples.
- `official_pages`: Contains markdown files with guides or documentation that the examples are based on.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- Yarn or npm package manager

### Installation

1. Clone the repository and install dependencies:
   ```bash
   yarn install
   ```

### Environment Configuration

Most examples in this repository use Large Language Models (LLMs) and require API keys. 

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Configure your API keys in the `.env` file:
   - **GOOGLE_APPLICATION_CREDENTIALS** (required for most examples): Path to your Google Cloud service account JSON file
   - **OPENAI_API_KEY** (optional): For using OpenAI models
   - **ANTHROPIC_API_KEY** (optional): For using Anthropic's Claude models
   - **TAVILY_API_KEY** (optional): For examples that use web search functionality

### Note on Model Flexibility

**Most models in the examples are swappable!** If an example uses `ChatVertexAI` but you don't have a Google Cloud account, you can easily switch to another provider:

```typescript
// Instead of:
import { ChatVertexAI } from "@langchain/google-vertexai";
const model = new ChatVertexAI({ model: "gemini-2.5-pro" });

// You can use:
import { ChatOpenAI } from "@langchain/openai";
const model = new ChatOpenAI({ model: "gpt-4" });

// Or:
import { ChatAnthropic } from "@langchain/anthropic";
const model = new ChatAnthropic({ model: "claude-3-opus-20240229" });
```

## Running Examples

Each example is self-contained and can be run independently:

```bash
npx ts-node src/examples/[example-name]/index.ts
```

For example, to run the image input example:

```bash
npx ts-node src/examples/image-input/index.ts
```
