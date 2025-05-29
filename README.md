# Langchain Playground

This repository contains working examples of Langchain usage.

## Structure

- `src/examples`: Contains standalone examples, each in its own directory.
  - Each example directory has an `index.ts` file that can be run directly (e.g., using `ts-node src/examples/some-example/index.ts`).
- `src/shared`: Contains shared utility code, like model configurations.
- `assets`: Contains any assets (images, etc.) used by the examples.
- `official_pages`: Contains markdown files with guides or documentation that the examples are based on.

## Running Examples

1. Ensure you have Node.js and npm/yarn installed.
2. Install dependencies: `npm install` or `yarn install`.
3. Set up your environment variables. Copy `.env.example` to `.env` and fill in the required credentials (e.g., `GOOGLE_APPLICATION_CREDENTIALS`).
4. Run an example using ts-node: `npx ts-node src/examples/directory-name/index.ts`

For example, to run the image input example:

`npx ts-node src/examples/image-input/index.ts`
