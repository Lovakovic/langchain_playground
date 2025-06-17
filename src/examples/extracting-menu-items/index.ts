import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { geminiBase } from '../../shared/utils/models/vertexai';
import { gptBase } from '../../shared/utils/models/openai';

interface MenuItemInput {
  originalName: string;
  englishName?: string;
  description?: string;
  price: number;
  currency?: string;
  ingredients?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

interface ExtractMenuItemsInput {
  items: MenuItemInput[];
  remarks?: string;
}

const menuItemSchema = z.object({
  originalName: z.string().describe('The original name of the menu item as it appears on the menu'),
  englishName: z.string().optional().describe('English translation of the item name (if original is not in English)'),
  description: z.string().optional().describe('Description of the menu item'),
  price: z.number().describe('Price of the item as a decimal number'),
  currency: z.string().optional().describe('Currency code (e.g., EUR, USD)'),
  ingredients: z.array(z.string()).optional().describe('List of main ingredients if explicitly mentioned'),
  notes: z.string().optional().describe('Special notes like dietary info (vegan, gluten-free, etc.)'),
  metadata: z.object({
    position: z.number().optional().describe('Position/order in the original menu'),
    section: z.string().optional().describe('Menu section (e.g., Appetizers, Main Courses)'),
  }).optional().describe('Additional metadata about the item'),
});

const extractionSchema = z.object({
  items: z.array(menuItemSchema).describe('Array of all extracted menu items'),
  remarks: z.string().optional().describe('General observations about the menu (language, structure, special notes)'),
});

const extractMenuItemsTool = new DynamicStructuredTool({
  name: 'extract_menu_items',
  description: 'Extract and structure all menu items from the provided menu content',
  schema: extractionSchema,
  func: async (input: unknown) => {
    const typedInput = input as ExtractMenuItemsInput;

    for (const item of typedInput.items) {
      if (!item.originalName || typeof item.price !== 'number') {
        throw new Error('Each item must have originalName and price');
      }
    }

    return JSON.stringify({
      items: typedInput.items.map((item) => ({
        ...item,
        currency: item.currency || 'EUR',
      })),
      remarks: typedInput.remarks,
      success: true,
    });
  },
});

async function loadImages(imagesDir: string): Promise<Buffer[]> {
  const files = await fs.readdir(imagesDir);
  const imageFiles = files.filter(f => f.match(/\.(jpg|jpeg|png)$/i)).sort();
  
  const images: Buffer[] = [];
  for (const file of imageFiles) {
    const imagePath = path.join(imagesDir, file);
    const imageBuffer = await fs.readFile(imagePath);
    images.push(imageBuffer);
  }
  
  return images;
}

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'Gemini 2.5 Flash': {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 3.5,
  },
  'Gemini 2.5 Pro': {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
  },
  'OpenAI o4-mini': {
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
  },
  'OpenAI o3': {
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
  },
};

function calculateCost(tokenUsage: TokenUsage, pricing: ModelPricing): number {
  const inputCost = (tokenUsage.inputTokens || 0) / 1_000_000 * pricing.inputPricePerMillion;
  const outputCost = (tokenUsage.outputTokens || 0) / 1_000_000 * pricing.outputPricePerMillion;
  return inputCost + outputCost;
}

async function extractWithModel(
  modelName: string,
  model: any,
  images: Buffer[]
): Promise<{ modelName: string; result: any; duration: number; tokenUsage: TokenUsage; cost?: number; startTime: number; endTime: number }> {
  const startTime = Date.now();
  
  const imageMessages = images.map(buffer => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    },
  }));

  const message = new HumanMessage({
    content: [
      {
        type: 'text',
        text: 'Extract all menu items from these menu images. Include original names, descriptions, prices, and any other relevant information you can find.',
      },
      ...imageMessages,
    ],
  });

  try {
    const response = await model.bindTools([extractMenuItemsTool], {
      tool_choice: 'any',
    }).invoke([message]);

    const endTime = Date.now();
    const duration = endTime - startTime;

    const toolCalls = response.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      throw new Error('No tool calls in response');
    }

    // Extract token usage from response
    let tokenUsage: TokenUsage = {};

    // Check usage_metadata first (both providers use this)
    if (response.usage_metadata) {
      tokenUsage = {
        inputTokens: response.usage_metadata.input_tokens,
        outputTokens: response.usage_metadata.output_tokens,
        totalTokens: response.usage_metadata.total_tokens,
      };
    } else if (response.response_metadata) {
      const metadata = response.response_metadata;
      
      // OpenAI format
      if (metadata.usage) {
        tokenUsage = {
          inputTokens: metadata.usage.prompt_tokens,
          outputTokens: metadata.usage.completion_tokens,
          totalTokens: metadata.usage.total_tokens,
        };
      } 
      // Gemini format
      else if (metadata.usage_metadata) {
        tokenUsage = {
          inputTokens: metadata.usage_metadata.input_tokens,
          outputTokens: metadata.usage_metadata.output_tokens,
          totalTokens: metadata.usage_metadata.total_tokens,
        };
      }
    }

    // Calculate cost if we have pricing for this model
    const pricing = MODEL_PRICING[modelName];
    const cost = pricing && tokenUsage.inputTokens && tokenUsage.outputTokens
      ? calculateCost(tokenUsage, pricing)
      : undefined;

    return {
      modelName,
      result: toolCalls[0].args,
      duration,
      tokenUsage,
      cost,
      startTime,
      endTime,
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    return {
      modelName,
      result: { error: error instanceof Error ? error.message : 'Unknown error' },
      duration,
      tokenUsage: {},
      cost: undefined,
      startTime,
      endTime,
    };
  }
}

async function main() {
  console.log('Starting menu extraction comparison...\n');

  const imagesDir = path.join(__dirname, 'images');
  const images = await loadImages(imagesDir);
  console.log(`Loaded ${images.length} images\n`);

  const geminiFlashModel = geminiBase({ 
    streaming: false, 
    model: 'gemini-2.5-flash-preview-05-20'
  });
  
  const geminiProModel = geminiBase({ 
    streaming: false, 
    model: 'gemini-2.5-pro-preview-05-06'
  });
  
  const openaiO4Model = gptBase({ 
    streaming: false,
    enableThinking: true,
    model: 'o4-mini'
  });
  
  const openaiO3Model = gptBase({ 
    streaming: false,
    enableThinking: true,
    model: 'o3'
  });

  const models = [
    { name: 'Gemini 2.5 Flash', instance: geminiFlashModel },
    { name: 'Gemini 2.5 Pro', instance: geminiProModel },
    { name: 'OpenAI o4-mini', instance: openaiO4Model },
    { name: 'OpenAI o3', instance: openaiO3Model },
  ];

  // Create output directory first - use process.cwd() to ensure correct path
  const outputDir = path.join(process.cwd(), 'src/examples/extracting-menu-items/results');
  await fs.mkdir(outputDir, { recursive: true });

  console.log('=== EXTRACTION RESULTS ===\n');
  console.log('Processing models in parallel...\n');

  let totalCost = 0;
  const globalStartTime = Date.now();

  // Create promises for all models - start them all at once
  const modelPromises = models.map(({ name, instance }) => 
    extractWithModel(name, instance, images)
  );

  // Wait for all to complete and collect results
  const results = await Promise.all(modelPromises);
  
  // Sort results by completion time to show which finished first
  results.sort((a, b) => a.endTime - b.endTime);
  
  // Display results in order of completion
  for (const result of results) {
    const relativeStartTime = ((result.startTime - globalStartTime) / 1000).toFixed(2);
    const relativeEndTime = ((result.endTime - globalStartTime) / 1000).toFixed(2);
    
    console.log(`\n${result.modelName}:`);
    console.log(`Started at: +${relativeStartTime}s, Completed at: +${relativeEndTime}s, Duration: ${(result.duration / 1000).toFixed(2)}s`);
    console.log('-'.repeat(70));
    
    // Display token usage and cost
    if (result.tokenUsage.totalTokens) {
      console.log(`Tokens - Input: ${result.tokenUsage.inputTokens || 'N/A'}, Output: ${result.tokenUsage.outputTokens || 'N/A'}, Total: ${result.tokenUsage.totalTokens}`);
      if (result.cost !== undefined) {
        console.log(`Cost: $${result.cost.toFixed(6)} (Input: $${((result.tokenUsage.inputTokens || 0) / 1_000_000 * (MODEL_PRICING[result.modelName]?.inputPricePerMillion || 0)).toFixed(6)}, Output: $${((result.tokenUsage.outputTokens || 0) / 1_000_000 * (MODEL_PRICING[result.modelName]?.outputPricePerMillion || 0)).toFixed(6)})`);
        totalCost += result.cost;
      }
    } else if (result.tokenUsage.inputTokens || result.tokenUsage.outputTokens) {
      console.log(`Tokens - Input: ${result.tokenUsage.inputTokens || 'N/A'}, Output: ${result.tokenUsage.outputTokens || 'N/A'}`);
    } else {
      console.log('Token usage: Not available');
    }
    
    if (result.result.error) {
      console.log(`Error: ${result.result.error}`);
    } else {
      console.log(`Items found: ${result.result.items?.length || 0}`);
      if (result.result.remarks) {
        console.log(`Remarks: ${result.result.remarks}`);
      }
      
      if (result.result.items && result.result.items.length > 0) {
        console.log('\nFirst 3 items:');
        result.result.items.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`\n${idx + 1}. ${item.originalName}`);
          if (item.englishName) console.log(`   English: ${item.englishName}`);
          if (item.description) console.log(`   Description: ${item.description}`);
          console.log(`   Price: ${item.price} ${item.currency || 'EUR'}`);
          if (item.metadata?.section) console.log(`   Section: ${item.metadata.section}`);
        });
      }
    }
    
    // Save result
    if (!result.result.error) {
      const filename = `${result.modelName.toLowerCase().replace(/\s+/g, '-')}-results.json`;
      await fs.writeFile(
        path.join(outputDir, filename),
        JSON.stringify({ result: result.result, tokenUsage: result.tokenUsage, cost: result.cost }, null, 2)
      );
      console.log(`\nResults saved to: ${filename}`);
    }
    
    console.log('\n' + '='.repeat(70) + '\n');
  }

  console.log(`\n\n=== COST SUMMARY ===`);
  console.log(`Total cost for all models: $${totalCost.toFixed(6)}`);
  console.log(`\nAll results saved to ${outputDir}`);
}

main().catch(console.error);
