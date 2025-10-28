# Basics

Fundamental LangChain/LangGraph patterns. Start here for core LLM interaction concepts.

## Examples

### simple-text-input
Basic LLM API call using OpenAI's o3 model with reasoning capabilities.

### structured-output
Force LLM responses to match Zod schemas. Demonstrates guaranteed JSON output with validation.

### image-input
Vision-based tool use - send local images to models, bind structured analysis tools, compare Gemini vs OpenAI.

### gemini-image-capacity
Test Gemini's multi-image processing limits. Fetches multiple cat images, encodes to base64, sends all in single request.

## Quick Start

```bash
yarn run-example src/examples/basics/simple-text-input/simple-text-input.ts
```
