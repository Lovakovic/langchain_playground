import { DynamicStructuredTool } from '@langchain/core/tools';
import { 
  StructureAnalysisToolSchema, 
  ItemExtractionToolSchema, 
  CategoryEnrichmentToolSchema,
  AllergenAnalysisToolSchema 
} from './types';

// Mock tools that simulate the complex tools from monkey-ai
export const createStructureAnalysisTool = () =>
  new DynamicStructuredTool({
    name: 'analyze_menu_structure',
    description: 'Analyzes the structure of menu content and identifies sections',
    schema: StructureAnalysisToolSchema,
    func: async ({ sections }) => {
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 100));
      return { sections, analysisComplete: true };
    },
  });

export const createItemExtractionTool = () =>
  new DynamicStructuredTool({
    name: 'extract_menu_items',
    description: 'Extracts individual menu items from a menu section',
    schema: ItemExtractionToolSchema,
    func: async ({ items }) => {
      // Simulate processing delay  
      await new Promise(resolve => setTimeout(resolve, 150));
      return { items, extractionComplete: true };
    },
  });

export const createCategoryEnrichmentTool = () =>
  new DynamicStructuredTool({
    name: 'categorize_menu_items',
    description: 'Assigns categories to menu items based on content analysis',
    schema: CategoryEnrichmentToolSchema,
    func: async ({ categorizedItems }) => {
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 200));
      return { categorizedItems, categorizationComplete: true };
    },
  });

export const createAllergenAnalysisTool = () =>
  new DynamicStructuredTool({
    name: 'analyze_allergens',
    description: 'Analyzes menu items for allergen information',
    schema: AllergenAnalysisToolSchema,
    func: async ({ allergenInfo }) => {
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 180));
      return { allergenInfo, allergenAnalysisComplete: true };
    },
  });

export const createTranslationTool = () =>
  new DynamicStructuredTool({
    name: 'translate_content',
    description: 'Translates menu content to target language',
    schema: ItemExtractionToolSchema, // Reuse schema for simplicity
    func: async ({ items }) => {
      // Simulate translation processing
      await new Promise(resolve => setTimeout(resolve, 220));
      const translatedItems = items.map(item => ({
        itemId: `${item.name}-id`,
        translatedName: `Translated: ${item.name}`,
        translatedDescription: item.description ? `Translated: ${item.description}` : undefined
      }));
      return { translatedItems, translationComplete: true };
    },
  });