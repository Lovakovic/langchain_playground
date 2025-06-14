# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a LangChain playground repository for experimenting with LangChain features, LLM integrations, and document processing capabilities.

## Commands

### Development Commands
- `yarn install` - Install dependencies
- `yarn build` - Compile TypeScript to JavaScript (runs `tsc`)
- `yarn start` - Build and run the application
- `yarn dev` - Development mode with watch and auto-restart
- `npx ts-node src/examples/[example-name]/index.ts` - Run a specific example directly

### Running Examples
Each example in `src/examples/` can be run independently:
```bash
npx ts-node src/examples/image-input/index.ts
npx ts-node src/examples/tool-calling/index.ts
```

## Environment Setup

Before running any code, ensure `.env` file exists with required credentials:
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Google Cloud service account JSON (required for Vertex AI)
- `OPENAI_API_KEY` - OpenAI API key (optional)
- `ANTHROPIC_API_KEY` - Anthropic API key (optional)

## Architecture

### Core Structure
- **Examples** (`src/examples/`): Self-contained demonstrations of LangChain features. Each example should be runnable independently with its own `index.ts`.
- **Shared Utilities** (`src/shared/utils/`): Reusable code including model configurations for different providers (Anthropic, OpenAI, Vertex AI).
- **Playground** (`src/playground/`): Experimental utilities for PDF processing, content formatting, and other explorations.

### Key Dependencies
- **LangChain Ecosystem**: Core framework with provider-specific packages (@langchain/core, @langchain/anthropic, @langchain/openai, @langchain/google-vertexai, @langchain/langgraph)
- **PDF Processing**: Multiple libraries for different PDF operations (pdf-parse, pdf2pic, pdfjs-dist, unpdf)
- **Image Processing**: sharp for image manipulation, @napi-rs/canvas for canvas operations
- **Validation**: zod for schema validation

### TypeScript Configuration
- Strict mode enabled
- Target: ES2016
- Module: CommonJS
- Source: `src/`
- Output: `dist/`
- JSON module resolution enabled

## Development Guidelines

When adding new examples:
1. Create a new directory under `src/examples/`
2. Include a self-contained `index.ts` that demonstrates the feature
3. Use shared model configurations from `src/shared/utils/models/`
4. Ensure all required environment variables are documented

When working with LLM providers:
- Model configurations are centralized in `src/shared/utils/models/`
- Use the appropriate provider-specific package from @langchain namespace
- Handle API keys through environment variables