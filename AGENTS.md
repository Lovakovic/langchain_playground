# LangChain/LangGraph Playground - AGENTS.md

LangChain/LangGraph examples playground. High-quality, type-safe reference implementations for building production applications.

## Targets

- `yarn quality` - Format, compile, lint (run before commit)
- `yarn run-example <path>` - Compile and run specific example
- `yarn build` - Compile TypeScript
- `yarn format` - Format code with Prettier

## Code Standards

- Ultra-strict TypeScript + ESLint - NO exceptions, fix ALL errors
- Interfaces only (no anonymous types)
- Explicit return types required
- Prefer non-null properties (use `?` sparingly and only when truly necessary)
- **NO type re-exports** - direct imports only (`import { X } from './source'`)
- **NO legacy code** - delete old implementations completely when replacing
- **NO direct process.env** - all env vars through ConfigService
- No `any` types - use proper typing or `unknown` with guards
- Zero tolerance: zero errors, zero warnings

## Example Structure

Each example in `src/examples/`:
- Self-contained, runnable independently
- Named file matches directory (e.g., `image-input/image-input.ts`)
- Single concept demonstration
- Full type definitions for all data structures

These are **reference implementations** - quality and type safety are mandatory.
