# Langchain Multimodal Inputs Guide

A quick reference for passing images to models in Langchain.

## Setup

```javascript
import * as fs from "node:fs/promises";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";

const model = new ChatAnthropic({
  model: "claude-3-sonnet-20240229",
});
```

## Method 1: Base64 Encoded Images

For local image files, encode them as base64:

```javascript
const imageData = await fs.readFile("path/to/image.jpg");

const message = new HumanMessage({
  content: [
    {
      type: "text",
      text: "What does this image contain?",
    },
    {
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${imageData.toString("base64")}`,
      },
    },
  ],
});

const response = await model.invoke([message]);
```

## Method 2: HTTP URLs

Some providers (like OpenAI) support direct image URLs:

```javascript
import { ChatOpenAI } from "@langchain/openai";

const openAIModel = new ChatOpenAI({ model: "gpt-4o" });

const message = new HumanMessage({
  content: [
    {
      type: "text",
      text: "Describe the weather in this image",
    },
    {
      type: "image_url",
      image_url: { url: "https://example.com/image.jpg" },
    },
  ],
});

const response = await openAIModel.invoke([message]);
```

## Multiple Images

Pass multiple images in the same message:

```javascript
const message = new HumanMessage({
  content: [
    {
      type: "text",
      text: "Are these two images the same?",
    },
    {
      type: "image_url",
      image_url: { url: imageUrl1 },
    },
    {
      type: "image_url",
      image_url: { url: imageUrl2 },
    },
  ],
});
```

## Key Points

- Uses OpenAI's multimodal format standard
- Langchain converts formats for other providers automatically
- Images must be in `image_url` content blocks
- Combine text and images in the same message
- Support varies by model provider
