import { BaseMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';

/**
 * Represents a single item in a batch that needs validation
 */
export interface ValidationItem<T = any> {
  id: string;
  data: T;
  status: 'pending' | 'valid' | 'invalid';
  error?: string;
  attempts?: number;
}

/**
 * Result of a partial validation - indicates what succeeded and what needs retry
 */
export interface PartialValidationResult<TInput = any, TOutput = any> {
  // Items that passed validation
  validItems: Array<{
    id: string;
    input: TInput;
    output: TOutput;
  }>;
  
  // Items that failed and need retry
  invalidItems: Array<{
    id: string;
    input: TInput;
    error: string;
    suggestion?: string; // Specific suggestion for fixing this item
  }>;
  
  // Whether all items are now valid
  isComplete: boolean;
  
  // Optional metadata about the validation
  metadata?: Record<string, any>;
}

/**
 * Generic validation state that accumulates results across attempts
 */
export interface AccumulativeValidationState<TInput = any, TOutput = any> {
  // Current attempt number
  currentAttempt: number;
  maxAttempts: number;
  
  // Accumulated valid results (persists across attempts)
  validatedItems: Map<string, {
    input: TInput;
    output: TOutput;
    validatedAt: number; // Attempt number when validated
  }>;
  
  // Items still requiring validation
  pendingItems: Map<string, {
    input: TInput;
    lastError?: string;
    attempts: number;
    suggestions: string[];
  }>;
  
  // Full history for audit trail
  history: Array<{
    attempt: number;
    timestamp: number;
    validCount: number;
    invalidCount: number;
    items: Array<{ id: string; status: 'valid' | 'invalid'; error?: string }>;
  }>;
  
  // Tool-specific metadata storage
  metadata: Record<string, any>;
  
  // Hints that accumulate to help the LLM
  globalHints: string[];
}

export interface ValidationConfigurable {
  validationState?: AccumulativeValidationState;
}

/**
 * Custom error class for validation failures that includes partial results
 */
export class PartialValidationError extends Error {
  constructor(
    message: string,
    public partialResult: PartialValidationResult
  ) {
    super(message);
    this.name = 'PartialValidationError';
  }
}

/**
 * Standard validation error for complete failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ModelToolValidationParams {
  modelName: string;
  tool: DynamicStructuredTool;
  messages: BaseMessage[];
  config?: RunnableConfig<ValidationConfigurable>;
  temperature?: number;
  maxApiRetries?: number; // For API/network errors (default: 3)
  maxValidationAttempts?: number; // For validation errors (default: 5)
  // New: callback to generate retry message based on partial results
  generateRetryMessage?: (partialResult: PartialValidationResult, state: AccumulativeValidationState) => string;
}

/**
 * Default retry message generator that focuses on failed items only
 */
function defaultRetryMessageGenerator(
  partialResult: PartialValidationResult,
  state: AccumulativeValidationState
): string {
  let message = '';
  
  // ALWAYS show what succeeded first so LLM knows not to include them
  if (partialResult.validItems.length > 0 || state.validatedItems.size > 0) {
    message += '✅ **SUCCESSFULLY VALIDATED** (already saved, DO NOT include in your response):\n';
    
    // Show newly validated items
    if (partialResult.validItems.length > 0) {
      partialResult.validItems.forEach(item => {
        message += `  ✓ ${item.id}: ${JSON.stringify(item.input)}\n`;
      });
    }
    
    // Show previously validated items
    if (state.validatedItems.size > 0) {
      state.validatedItems.forEach((value, id) => {
        // Don't duplicate if it was just validated
        if (!partialResult.validItems.find(v => v.id === id)) {
          message += `  ✓ ${id}: ${JSON.stringify(value.input)} (validated earlier)\n`;
        }
      });
    }
    
    message += '\n';
  }
  
  // Now show what failed and needs correction
  if (partialResult.invalidItems.length > 0) {
    message += '❌ **FAILED VALIDATION** (ONLY provide corrected versions of these):\n';
    partialResult.invalidItems.forEach(item => {
      message += `\n  ✗ ${item.id}:\n`;
      message += `    Input: ${JSON.stringify(item.input)}\n`;
      message += `    Error: ${item.error}\n`;
      if (item.suggestion) {
        message += `    Suggestion: ${item.suggestion}\n`;
      }
    });
    
    message += '\n📝 **IMPORTANT**: In your next response, ONLY provide the ${partialResult.invalidItems.length} failed item(s) listed above.\n';
    message += 'Do NOT include the successfully validated items as they have already been saved.\n';
    message += `Your response should contain exactly ${partialResult.invalidItems.length} item(s) with IDs: ${partialResult.invalidItems.map(i => i.id).join(', ')}`;
  }
  
  // Add global hints if we're on later attempts
  if (state.globalHints.length > 0 && state.currentAttempt >= 2) {
    message += `\n\n💡 Hints: ${state.globalHints.join('; ')}`;
  }
  
  return message;
}

/**
 * Executes a model with a bound tool, supporting partial validation and accumulation.
 * 
 * This function allows tools to return partial successes, accumulating valid results
 * while retrying only the invalid portions. This is ideal for batch processing where
 * some items may be valid while others need correction.
 * 
 * Tools should throw PartialValidationError with partial results to trigger
 * intelligent retry of only the failed items.
 * 
 * @param params - The execution parameters
 * @returns Promise containing the final accumulated output
 */
export async function executeModelWithToolValidation<R>(
  params: ModelToolValidationParams
): Promise<R> {
  const { 
    modelName, 
    temperature, 
    tool, 
    messages, 
    config = {},
    maxApiRetries = 3,
    maxValidationAttempts = 5,
    generateRetryMessage = defaultRetryMessageGenerator
  } = params;

  if (!messages || messages.length === 0) {
    throw new Error('Messages array must contain at least one message');
  }

  // Check if we have at least one HumanMessage (required by Vertex AI)
  const hasHumanMessage = messages.some(message => message.getType() === 'human');
  if (!hasHumanMessage) {
    throw new Error('Messages array must contain at least one HumanMessage (required by Vertex AI API)');
  }

  const model = new ChatVertexAI({
    model: modelName,
    temperature: temperature ?? 0.4,
  });

  // Bind the tool with forced execution
  const modelWithTool = model.bindTools([tool], { tool_choice: 'any' });

  // Initialize validation state if not provided
  if (!config.configurable) {
    config.configurable = {};
  }
  
  if (!config.configurable.validationState) {
    config.configurable.validationState = {
      currentAttempt: 0,
      maxAttempts: maxValidationAttempts,
      validatedItems: new Map(),
      pendingItems: new Map(),
      history: [],
      metadata: {},
      globalHints: []
    };
  }

  const validationState = config.configurable.validationState;
  let lastApiError: Error | undefined;
  let currentMessages = [...messages];
  let : AIMessage | undefined;

  // Outer loop for API retries
  for (let apiAttempt = 1; apiAttempt <= maxApiRetries; apiAttempt++) {
    try {
      // Validation loop (runs within a single API attempt)
      while (validationState.currentAttempt < validationState.maxAttempts) {
        validationState.currentAttempt++;
        
        // Call the model
        const modelResponse = await modelWithTool.invoke(currentMessages, config);
        lastModelResponse = modelResponse;

        if (!modelResponse.tool_calls || modelResponse.tool_calls.length === 0) {
          throw new Error(`Model did not call the expected tool "${tool.name}"`);
        }

        const toolCall = modelResponse.tool_calls.find((call) => call.name === tool.name);
        if (!toolCall) {
          throw new Error(`Model called unexpected tool. Expected "${tool.name}"`);
        }

        try {
          // Execute the tool with validation state in config
          const result = await tool.invoke(toolCall.args, config) as R;
          
          // If we get here, validation was completely successful
          const historyEntry = {
            attempt: validationState.currentAttempt,
            timestamp: Date.now(),
            validCount: validationState.validatedItems.size,
            invalidCount: 0,
            items: [{ id: 'complete', status: 'valid' as const }]
          };
          validationState.history.push(historyEntry);
          
          return result;
          
        } catch (toolError: unknown) {
          // Handle partial validation error specially
          if (toolError instanceof PartialValidationError) {
            const partialResult = toolError.partialResult;
            
            // Record valid items in state
            partialResult.validItems.forEach(item => {
              validationState.validatedItems.set(item.id, {
                input: item.input,
                output: item.output,
                validatedAt: validationState.currentAttempt
              });
              // Remove from pending if it was there
              validationState.pendingItems.delete(item.id);
            });
            
            // Update pending items with new errors
            partialResult.invalidItems.forEach(item => {
              const existing = validationState.pendingItems.get(item.id);
              validationState.pendingItems.set(item.id, {
                input: item.input,
                lastError: item.error,
                attempts: (existing?.attempts || 0) + 1,
                suggestions: item.suggestion 
                  ? [...(existing?.suggestions || []), item.suggestion]
                  : (existing?.suggestions || [])
              });
            });
            
            // Record history
            const historyEntry = {
              attempt: validationState.currentAttempt,
              timestamp: Date.now(),
              validCount: partialResult.validItems.length,
              invalidCount: partialResult.invalidItems.length,
              items: [
                ...partialResult.validItems.map(item => ({ 
                  id: item.id, 
                  status: 'valid' as const 
                })),
                ...partialResult.invalidItems.map(item => ({ 
                  id: item.id, 
                  status: 'invalid' as const, 
                  error: item.error 
                }))
              ]
            };
            validationState.history.push(historyEntry);
            
            // Check if we're complete
            if (partialResult.isComplete || validationState.pendingItems.size === 0) {
              // All items validated! Return accumulated results
              // The tool should format the final response appropriately
              return partialResult as unknown as R;
            }
            
            // Check if we've reached max attempts
            if (validationState.currentAttempt >= validationState.maxAttempts) {
              throw new Error(
                `Partial validation incomplete after ${validationState.maxAttempts} attempts. ` +
                `Validated: ${validationState.validatedItems.size} items, ` +
                `Still pending: ${validationState.pendingItems.size} items`
              );
            }
            
            // Generate retry message focusing only on failed items
            const retryMessageContent = generateRetryMessage(partialResult, validationState);
            
            // Create tool message with targeted feedback
            const toolMessage = new ToolMessage({
              content: retryMessageContent,
              tool_call_id: toolCall.id!
            });

            // Update messages for next iteration
            currentMessages = [...currentMessages, modelResponse, toolMessage];
            
            // Continue validation loop with only the failed items
            
          } else if (toolError instanceof ValidationError || 
                     (toolError instanceof Error && 
                      (toolError.message.includes('validation') || 
                       toolError.message.includes('invalid') ||
                       toolError.message.includes('failed')))) {
            // Handle complete validation failure (no partial results)
            const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
            
            // Record in history
            const historyEntry = {
              attempt: validationState.currentAttempt,
              timestamp: Date.now(),
              validCount: 0,
              invalidCount: 1,
              items: [{ id: 'all', status: 'invalid' as const, error: errorMessage }]
            };
            validationState.history.push(historyEntry);
            
            // Check if we've reached max attempts
            if (validationState.currentAttempt >= validationState.maxAttempts) {
              throw new Error(
                `Validation failed after ${validationState.maxAttempts} attempts. ` +
                `Last error: ${errorMessage}`
              );
            }
            
            // Create tool message with error feedback
            const toolMessage = new ToolMessage({
              content: errorMessage,
              tool_call_id: toolCall.id!
            });

            // Update messages for next iteration
            currentMessages = [...currentMessages, modelResponse, toolMessage];
            
          } else {
            // Not a validation error, propagate it
            throw toolError;
          }
        }
      }
      
      // If we exit the validation loop without returning, we've exceeded attempts
      throw new Error(
        `Exceeded maximum validation attempts (${maxValidationAttempts}). ` +
        `Validated: ${validationState.validatedItems.size} items, ` +
        `Pending: ${validationState.pendingItems.size} items`
      );
      
    } catch (error) {
      // Check if it's a validation failure (already exceeded attempts) or API error
      if (error instanceof Error && 
          (error.message.includes('Validation failed after') || 
           error.message.includes('Exceeded maximum validation attempts') ||
           error.message.includes('Partial validation incomplete'))) {
        throw error; // Don't retry validation failures
      }
      
      lastApiError = error instanceof Error ? error : new Error(String(error));
      
      if (apiAttempt === maxApiRetries) {
        break;
      }

      // Exponential backoff for API retries: 1s, 2s, 4s
      const delayMs = Math.pow(2, apiAttempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Failed to execute model with tool after ${maxApiRetries} API attempts. ` +
    `Last error: ${lastApiError?.message || 'Unknown error'}`
  );
}