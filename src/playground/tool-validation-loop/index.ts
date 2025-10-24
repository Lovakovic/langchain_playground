import * as dotenv from 'dotenv';
import { HumanMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { 
  executeModelWithToolValidation, 
  PartialValidationError,
  ValidationConfigurable
} from './model-loop-util';
import { RunnableConfig } from "@langchain/core/runnables";

dotenv.config();

// Simulated tool that progressively accepts items based on attempt number
// This simulates how an LLM might fix items progressively
const progressiveValidationTool = new DynamicStructuredTool({
  name: 'validate_user_data',
  description: 'Validates user data with progressive acceptance',
  schema: z.object({
    users: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      age: z.number()
    })).describe('Array of user data to validate')
  }),
  func: async ({ users }, manager, config?: RunnableConfig<ValidationConfigurable>) => {
    const state = config?.configurable?.validationState;
    const attempt = state?.currentAttempt || 1;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ATTEMPT #${attempt}: LLM sent ${users.length} user(s) to validate`);
    console.log(`${'='.repeat(60)}`);
    
    // Show what the LLM sent this time
    console.log('\n📥 Items received from LLM in this call:');
    users.forEach(u => {
      console.log(`  - ${u.id}: ${u.name} (${u.email}, age ${u.age})`);
    });
    
    // Show what we already have saved
    const alreadyValidated = state?.validatedItems || new Map();
    if (alreadyValidated.size > 0) {
      console.log('\n✅ Already validated and saved (NOT sent by LLM):');
      alreadyValidated.forEach((value, id) => {
        const user = value.input as any;
        console.log(`  - ${id}: ${user.name} (validated in attempt #${value.validatedAt})`);
      });
    }
    
    const validItems: Array<{ id: string; input: any; output: any }> = [];
    const invalidItems: Array<{ id: string; input: any; error: string; suggestion?: string }> = [];
    
    // Simulate progressive fixing: 
    // - Attempt 1: Accept users with valid emails
    // - Attempt 2: Accept users with ages > 0
    // - Attempt 3+: Accept all remaining
    
    for (const user of users) {
      let isValid = true;
      let error = '';
      
      // Email validation
      if (!user.email.includes('@')) {
        isValid = false;
        error = 'Invalid email format';
      }
      
      // Age validation (gets more lenient over time)
      if (attempt === 1 && user.age < 18) {
        isValid = false;
        error = error ? `${error}; Age must be 18+` : 'Age must be 18+';
      } else if (attempt === 2 && user.age <= 0) {
        isValid = false;
        error = error ? `${error}; Age must be positive` : 'Age must be positive';
      }
      
      // Name validation (only strict on first attempt)
      if (attempt === 1 && user.name.length < 2) {
        isValid = false;
        error = error ? `${error}; Name too short` : 'Name too short';
      }
      
      if (isValid) {
        validItems.push({
          id: user.id,
          input: user,
          output: { ...user, validated: true, validatedAt: attempt }
        });
        console.log(`  ✓ ${user.id} passed validation`);
      } else {
        invalidItems.push({
          id: user.id,
          input: user,
          error: error,
          suggestion: attempt >= 2 ? `Fix: ${error}` : undefined
        });
        console.log(`  ✗ ${user.id} failed: ${error}`);
      }
    }
    
    console.log(`\n📊 Results for attempt #${attempt}:`);
    console.log(`  - Valid in this batch: ${validItems.length}`);
    console.log(`  - Invalid in this batch: ${invalidItems.length}`);
    console.log(`  - Total validated so far: ${alreadyValidated.size + validItems.length}`);
    console.log(`  - Still need fixing: ${invalidItems.length}`);
    
    if (invalidItems.length > 0) {
      console.log('\n🔄 LLM will be asked to fix only the invalid items...');
      
      throw new PartialValidationError(
        `Batch validation: ${validItems.length} passed, ${invalidItems.length} failed`,
        {
          validItems,
          invalidItems,
          isComplete: false,
          metadata: {
            attempt,
            batchSize: users.length,
            totalValidatedSoFar: alreadyValidated.size + validItems.length
          }
        }
      );
    }
    
    // All valid!
    console.log('\n🎉 All items are now valid! Combining with previously validated items...');
    
    const allUsers = [...validItems];
    alreadyValidated.forEach((value, id) => {
      if (!allUsers.find(u => u.id === id)) {
        allUsers.push({
          id,
          input: value.input,
          output: value.output
        });
      }
    });
    
    return {
      success: true,
      totalUsers: allUsers.length,
      users: allUsers.map(u => u.output),
      validationSummary: {
        totalAttempts: attempt,
        itemsPerAttempt: state?.history.map(h => ({
          attempt: h.attempt,
          newlyValid: h.validCount,
          stillInvalid: h.invalidCount
        }))
      }
    };
  }
});

async function demonstrateProgressiveReduction() {
  console.log('🔄 PROGRESSIVE TASK REDUCTION DEMONSTRATION\n');
  console.log('This example shows how the LLM\'s task size reduces as items are validated.');
  console.log('Watch how the LLM sends fewer items in each attempt.\n');

  try {
    const messages = [
      new HumanMessage({
        content: `Please validate these 6 users:
        
        1. ID: U001, Name: Alice Johnson, Email: alice@company.com, Age: 25
        2. ID: U002, Name: Bob Smith, Email: bob@gmail.com, Age: 17
        3. ID: U003, Name: C, Email: charlie-no-at-symbol.com, Age: 30
        4. ID: U004, Name: Diana Prince, Email: diana@amazon.com, Age: 0
        5. ID: U005, Name: Eve Adams, Email: eve@tech.com, Age: -5
        6. ID: U006, Name: Frank Miller, Email: frank-invalid, Age: 45
        
        Validate all users and fix any issues.`
      })
    ];

    const result = await executeModelWithToolValidation({
      modelName: 'gemini-2.5-flash',
      tool: progressiveValidationTool,
      messages: messages,
      temperature: 0.1,
      maxValidationAttempts: 5
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ FINAL RESULT - All users validated!');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Final error:', error instanceof Error ? error.message : error);
  }
}

async function showRetryMessages() {
  console.log('\n📝 RETRY MESSAGE STRUCTURE DEMONSTRATION\n');
  console.log('This shows the exact retry messages sent to the LLM.\n');

  // Create a simple tool that always fails some items
  const demoTool = new DynamicStructuredTool({
    name: 'demo_validation',
    description: 'Demo tool to show retry messages',
    schema: z.object({
      items: z.array(z.object({
        id: z.string(),
        value: z.string()
      }))
    }),
    func: async ({ items }, manager, config) => {
      const state = config?.configurable?.validationState;
      console.log(`\n📨 Received ${items.length} items: ${items.map(i => i.id).join(', ')}`);
      
      const validItems = [];
      const invalidItems = [];
      
      for (const item of items) {
        if (item.value.startsWith('valid')) {
          validItems.push({ id: item.id, input: item, output: { ...item, processed: true } });
        } else {
          invalidItems.push({ 
            id: item.id, 
            input: item, 
            error: `Value must start with "valid"`,
            suggestion: `Change "${item.value}" to "valid_${item.value}"`
          });
        }
      }
      
      if (invalidItems.length > 0) {
        console.log(`  ✓ Valid: ${validItems.map(v => v.id).join(', ') || 'none'}`);
        console.log(`  ✗ Invalid: ${invalidItems.map(i => i.id).join(', ')}`);
        
        throw new PartialValidationError('Partial validation', {
          validItems,
          invalidItems,
          isComplete: false
        });
      }
      
      return { success: true, items: validItems };
    }
  });

  try {
    const messages = [
      new HumanMessage({
        content: 'Validate these items: A1:valid_data, A2:invalid, A3:valid_info, A4:bad, A5:wrong'
      })
    ];

    await executeModelWithToolValidation({
      modelName: 'gemini-2.5-flash',
      tool: demoTool,
      messages,
      maxValidationAttempts: 3,
      // Custom message generator to show the structure
      generateRetryMessage: (partialResult, state) => {
        const msg = `
✅ **SUCCESSFULLY VALIDATED** (already saved, DO NOT include in your response):
${partialResult.validItems.map(i => `  ✓ ${i.id}: ${JSON.stringify(i.input)}`).join('\n')}
${Array.from(state.validatedItems.entries()).map(([id, v]) => `  ✓ ${id}: ${JSON.stringify(v.input)} (from earlier)`).join('\n')}

❌ **FAILED VALIDATION** (ONLY provide corrected versions of these):
${partialResult.invalidItems.map(i => `  ✗ ${i.id}: ${i.error} - Suggestion: ${i.suggestion}`).join('\n')}

📝 **IMPORTANT**: Only send the ${partialResult.invalidItems.length} failed items (${partialResult.invalidItems.map(i => i.id).join(', ')})
The ${partialResult.validItems.length + state.validatedItems.size} successful items are already saved.`;
        
        console.log('\n' + '─'.repeat(60));
        console.log('RETRY MESSAGE SENT TO LLM:');
        console.log('─'.repeat(60));
        console.log(msg);
        console.log('─'.repeat(60));
        
        return msg;
      }
    });
  } catch (error) {
    console.log('\nExpected partial failure for demonstration');
  }
}

if (require.main === module) {
  (async () => {
    await demonstrateProgressiveReduction();
    // Uncomment to see retry message structure:
    // await showRetryMessages();
  })().catch(console.error);
}
