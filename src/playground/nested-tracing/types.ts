import { z } from 'zod';

/**
 * Type Definitions for Nested Tracing System
 * 
 * This file defines the core types used throughout the nested tracing demonstration.
 * These types mirror the patterns from monkey-ai while being simplified for
 * demonstration purposes.
 */

/**
 * Processing phases that mirror monkey-ai structure
 * 
 * These phases provide semantic meaning to the graph execution, allowing the tracer
 * to categorize events by business function rather than just technical node names.
 * 
 * This enum is used by the nodeToPhaseMap in the tracer to translate technical
 * node names into business-meaningful phases.
 */
export enum ProcessingPhase {
  FILE_PROCESSING = 'file_processing',    // Initial file handling and validation
  EXTRACTION = 'extraction',              // Content analysis and item extraction
  PRE_ENRICHMENT = 'pre_enrichment',      // Preparation for enrichment phases
  ENRICHMENT_1 = 'enrichment_1',          // First wave of parallel enrichment
  ENRICHMENT_2 = 'enrichment_2',          // Second wave of parallel enrichment
  ASSEMBLY = 'assembly',                  // Final result assembly and validation
  COMPLETED = 'completed',                // Successful completion
  FAILED = 'failed'                       // Error state
}

/**
 * Event types for our tracer
 * 
 * This interface defines the structure of events that the NestedTracer emits.
 * Each event represents a significant occurrence during graph execution.
 * 
 * The 'type' field indicates what kind of event occurred, while 'phase' provides
 * the business context for when it occurred.
 */
export interface ProcessingEvent {
  type: 'phase:start' | 'phase:end' | 'phase:error' | 'tool:end' | 'llm:end' | 'custom:event';
  phase: ProcessingPhase;                 // Which business phase this event belongs to
  message: string;                        // Human-readable description of the event
  metadata?: Record<string, any>;         // Additional context data (tool args, token usage, etc.)
}

/**
 * Predefined custom event types for common business operations
 * 
 * These constants provide standardized event names that can be used across
 * the nested graph architecture for consistent custom event tracking.
 */
export const CustomEventTypes = {
  // Progress tracking events
  PROGRESS_UPDATE: 'progress_update',
  ITEMS_PROCESSED: 'items_processed',
  BATCH_COMPLETED: 'batch_completed',
  
  // Business milestone events
  VALIDATION_STARTED: 'validation_started',
  VALIDATION_COMPLETED: 'validation_completed',
  ANALYSIS_STARTED: 'analysis_started',
  ANALYSIS_COMPLETED: 'analysis_completed',
  ENRICHMENT_STARTED: 'enrichment_started',
  ENRICHMENT_COMPLETED: 'enrichment_completed',
  
  // State transition events
  PHASE_TRANSITION: 'phase_transition',
  SUBGRAPH_ENTERED: 'subgraph_entered',
  SUBGRAPH_EXITED: 'subgraph_exited',
  
  // Error and recovery events
  VALIDATION_FAILED: 'validation_failed',
  RETRY_ATTEMPTED: 'retry_attempted',
  FALLBACK_TRIGGERED: 'fallback_triggered',
  ERROR_RECOVERED: 'error_recovered',
  
  // Performance and monitoring events
  CACHE_HIT: 'cache_hit',
  CACHE_MISS: 'cache_miss',
  API_TIMEOUT: 'api_timeout',
  RATE_LIMIT_HIT: 'rate_limit_hit',
  
  // Data flow events
  DATA_RECEIVED: 'data_received',
  DATA_VALIDATED: 'data_validated',
  DATA_TRANSFORMED: 'data_transformed',
  DATA_EXPORTED: 'data_exported',
} as const;

/**
 * Type for custom event names - either predefined constants or custom strings
 */
export type CustomEventName = typeof CustomEventTypes[keyof typeof CustomEventTypes] | string;

/**
 * Standard metadata interfaces for common custom event types
 */
export interface ProgressEventData {
  current: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining?: number;
  itemsPerSecond?: number;
}

export interface ValidationEventData {
  itemCount: number;
  validItems: number;
  invalidItems: number;
  validationRules: string[];
  errors?: string[];
}

export interface PerformanceEventData {
  duration?: number;
  memoryUsage?: number;
  apiCalls?: number;
  cacheHitRate?: number;
}

export interface StateTransitionEventData {
  fromPhase: ProcessingPhase | string;
  toPhase: ProcessingPhase | string;
  trigger: string;
  stateData?: Record<string, any>;
}

/**
 * Simplified menu item for demonstration
 * 
 * This represents the core business object that flows through the processing pipeline.
 * The tracer can show how these items are created, modified, and enriched as they
 * flow through the nested graph architecture.
 */
export interface MockMenuItem {
  id: string;                            // Unique identifier for tracking through pipeline
  name: string;                          // Primary item name
  description?: string;                  // Optional item description
  price?: number;                        // Optional pricing information
  section: string;                       // Which menu section this item belongs to
}

/**
 * Mock file metadata
 * 
 * Represents the input files that trigger the processing pipeline.
 * Simplified version of the complex file metadata used in monkey-ai.
 */
export interface MockFileMetadata {
  fileId: string;                        // Unique file identifier
  fileName: string;                      // Original file name
  content: string;                       // Processed file content (simplified)
}

/**
 * Tool Schema Definitions
 * 
 * These Zod schemas define the structure of tool calls that occur within the nested graphs.
 * The tracer captures these tool calls and associates them with their execution context.
 * 
 * In monkey-ai, these would be much more complex with sophisticated validation,
 * but these simplified versions demonstrate the same patterns.
 */

// Schema for structure analysis tool (used in extraction subgraph)
export const StructureAnalysisToolSchema = z.object({
  sections: z.array(z.object({
    name: z.string(),                    // Section name (e.g., "Appetizers", "Main Courses")
    itemCount: z.number()                // Estimated number of items in this section
  }))
});

// Schema for item extraction tool (used in extraction subgraph)
export const ItemExtractionToolSchema = z.object({
  items: z.array(z.object({
    name: z.string(),                    // Item name
    description: z.string().optional(),  // Item description
    price: z.number().optional(),        // Item price
    section: z.string()                  // Which section this item belongs to
  }))
});

// Schema for category enrichment tool (used in category enrichment subgraph)
export const CategoryEnrichmentToolSchema = z.object({
  categorizedItems: z.array(z.object({
    itemId: z.string(),                  // Reference to the original item
    category: z.string(),                // Assigned category (e.g., "main-dish", "appetizer")
    confidence: z.number()               // Confidence score for the categorization
  }))
});

// Schema for allergen analysis tool (used in allergen enrichment subgraph)
export const AllergenAnalysisToolSchema = z.object({
  allergenInfo: z.array(z.object({
    itemId: z.string(),                  // Reference to the original item
    allergens: z.array(z.string()),     // List of identified allergens
    confidence: z.number()               // Confidence score for the analysis
  }))
});

/**
 * Tool Schema Usage Pattern
 * 
 * These schemas demonstrate how structured tool calls work in nested graph architectures:
 * 
 * 1. **Context Association**: Each tool call happens within a specific node context
 * 2. **Structured Output**: Tools return structured data that flows through state channels
 * 3. **Validation**: Zod schemas ensure data integrity across graph boundaries
 * 4. **Traceability**: The tracer can show exactly which tool produced which data
 * 
 * In monkey-ai, these patterns are much more complex with sophisticated business logic,
 * but the core tracing requirements are the same - understanding where each tool call
 * occurred and how it contributed to the overall processing pipeline.
 */