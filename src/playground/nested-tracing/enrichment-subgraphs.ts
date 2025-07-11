import dotenv from 'dotenv';
import { END, START, StateGraph } from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatVertexAI } from '@langchain/google-vertexai';

dotenv.config();

function createVertexAIModel(config: { model: string; temperature: number }) {
  return new ChatVertexAI({
    model: config.model,
    temperature: config.temperature,
  });
}
import { CategoryEnrichmentState, AllergenEnrichmentState, TranslationEnrichmentState } from './states';
import { MockMenuItem } from './types';
import { createCategoryEnrichmentTool, createAllergenAnalysisTool, createTranslationTool } from './tools';

// Category Enrichment Subgraph
async function categoryAnalysisNode(state: typeof CategoryEnrichmentState.State): Promise<Partial<typeof CategoryEnrichmentState.State>> {
  const { extractedItems } = state;
  
  if (!extractedItems || extractedItems.length === 0) {
    return { categorizedItems: [], errorLog: ['No items to categorize'] };
  }

  try {
    const categoryTool = createCategoryEnrichmentTool();
    const model = createVertexAIModel({ model: 'gemini-2.5-flash', temperature: 0.2 })
      .bindTools([categoryTool], { tool_choice: 'any' });

    console.log(`🏷️  Categorizing ${extractedItems.length} items...`);

    // Create mock categorization data
    const mockCategorizedItems = extractedItems.map(item => ({
      itemId: item.id,
      category: item.section.toLowerCase().includes('pizza') ? 'main-dish' : 
                item.section.toLowerCase().includes('drink') ? 'beverage' :
                item.section.toLowerCase().includes('dessert') ? 'dessert' : 'appetizer',
      confidence: Math.round((Math.random() * 0.3 + 0.7) * 100) / 100 // 0.7-1.0
    }));

    const messages = [
      new SystemMessage('Categorize the provided menu items into appropriate food categories. Use the tool to save categorization results.'),
      new HumanMessage({ 
        content: `Items to categorize: ${extractedItems.map(item => `${item.name} (${item.section})`).join(', ')}` 
      }),
    ];

    const response = await model.invoke(messages);
    const toolCall = response.tool_calls?.[0];

    if (toolCall?.name === 'categorize_menu_items') {
      console.log(`  ✅ Categorized ${mockCategorizedItems.length} items`);
      return { categorizedItems: mockCategorizedItems };
    }

    return { categorizedItems: [], errorLog: ['Category analysis tool call failed'] };
  } catch (e) {
    return { categorizedItems: [], errorLog: [`Category analysis failed: ${(e as Error).message}`] };
  }
}

export function createCategoryEnrichmentSubgraph() {
  const workflow = new StateGraph(CategoryEnrichmentState)
    .addNode('category_analysis_node', categoryAnalysisNode);

  workflow.addEdge(START, 'category_analysis_node');
  workflow.addEdge('category_analysis_node', END);

  return workflow.compile();
}

// Allergen Enrichment Subgraph
async function allergenAnalysisNode(state: typeof AllergenEnrichmentState.State): Promise<Partial<typeof AllergenEnrichmentState.State>> {
  const { extractedItems } = state;
  
  if (!extractedItems || extractedItems.length === 0) {
    return { allergenInfo: [], errorLog: ['No items to analyze for allergens'] };
  }

  try {
    const allergenTool = createAllergenAnalysisTool();
    const model = createVertexAIModel({ model: 'gemini-2.5-flash', temperature: 0.1 })
      .bindTools([allergenTool], { tool_choice: 'any' });

    console.log(`🥜 Analyzing allergens for ${extractedItems.length} items...`);

    // Create mock allergen data
    const commonAllergens = ['gluten', 'dairy', 'nuts', 'eggs', 'soy'];
    const mockAllergenInfo = extractedItems.map(item => ({
      itemId: item.id,
      allergens: commonAllergens.filter(() => Math.random() > 0.7), // Random allergens
      confidence: Math.round((Math.random() * 0.2 + 0.8) * 100) / 100 // 0.8-1.0
    }));

    const messages = [
      new SystemMessage('Analyze the menu items for potential allergen content. Use the tool to save allergen analysis results.'),
      new HumanMessage({ 
        content: `Items to analyze: ${extractedItems.map(item => `${item.name}: ${item.description || 'No description'}`).join('; ')}` 
      }),
    ];

    const response = await model.invoke(messages);
    const toolCall = response.tool_calls?.[0];

    if (toolCall?.name === 'analyze_allergens') {
      console.log(`  ✅ Analyzed allergens for ${mockAllergenInfo.length} items`);
      return { allergenInfo: mockAllergenInfo };
    }

    return { allergenInfo: [], errorLog: ['Allergen analysis tool call failed'] };
  } catch (e) {
    return { allergenInfo: [], errorLog: [`Allergen analysis failed: ${(e as Error).message}`] };
  }
}

export function createAllergenEnrichmentSubgraph() {
  const workflow = new StateGraph(AllergenEnrichmentState)
    .addNode('allergen_analysis_node', allergenAnalysisNode);

  workflow.addEdge(START, 'allergen_analysis_node');
  workflow.addEdge('allergen_analysis_node', END);

  return workflow.compile();
}

// Translation Enrichment Subgraph
async function translationNode(state: typeof TranslationEnrichmentState.State): Promise<Partial<typeof TranslationEnrichmentState.State>> {
  const { extractedItems } = state;
  
  if (!extractedItems || extractedItems.length === 0) {
    return { translatedItems: [], errorLog: ['No items to translate'] };
  }

  try {
    const translationTool = createTranslationTool();
    const model = createVertexAIModel({ model: 'gemini-2.5-flash', temperature: 0.3 })
      .bindTools([translationTool], { tool_choice: 'any' });

    console.log(`🌐 Translating ${extractedItems.length} items...`);

    const messages = [
      new SystemMessage('Translate the menu items to English. Use the tool to save translation results.'),
      new HumanMessage({ 
        content: `Items to translate: ${extractedItems.map(item => 
          `${item.name}${item.description ? ` - ${item.description}` : ''}`
        ).join('; ')}` 
      }),
    ];

    const response = await model.invoke(messages);
    const toolCall = response.tool_calls?.[0];

    if (toolCall?.name === 'translate_content') {
      // The tool should return translated items, but we'll create mock data
      const mockTranslatedItems = extractedItems.map(item => ({
        itemId: item.id,
        translatedName: `EN: ${item.name}`,
        translatedDescription: item.description ? `EN: ${item.description}` : undefined
      }));

      console.log(`  ✅ Translated ${mockTranslatedItems.length} items`);
      return { translatedItems: mockTranslatedItems };
    }

    return { translatedItems: [], errorLog: ['Translation tool call failed'] };
  } catch (e) {
    return { translatedItems: [], errorLog: [`Translation failed: ${(e as Error).message}`] };
  }
}

export function createTranslationEnrichmentSubgraph() {
  const workflow = new StateGraph(TranslationEnrichmentState)
    .addNode('translation_node', translationNode);

  workflow.addEdge(START, 'translation_node');
  workflow.addEdge('translation_node', END);

  return workflow.compile();
}