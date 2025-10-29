/**
 * Task Utility for Durable Execution - Human-in-the-Loop Example
 *
 * Demonstrates the critical importance of wrapping side effects in task()
 * when using interrupt(). Shows before/after comparison with clear output.
 *
 * PROBLEM: When a node with interrupt() resumes, it re-executes from the start.
 * This causes:
 * - Duplicate API calls (wasted money, rate limits)
 * - Different transaction IDs (breaks idempotency)
 * - Different timestamps (logical errors)
 *
 * SOLUTION: Wrap side effects in task() to execute once and cache results.
 *
 * This example demonstrates:
 * 1. The problem: Side effects before interrupt re-execute on resume
 * 2. The solution: Using task() to wrap side effects
 * 3. Side-by-side comparison with visual proof
 * 4. Advanced patterns: multiple tasks, idempotency, error handling
 *
 * Guide reference: Lines 833-1401 in langgraph-js-human-in-the-loop-guide.md
 */

import { Annotation, Command, interrupt, task } from '@langchain/langgraph';
import { StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import type { FraudCheckResult, PaymentMetadata, PaymentResult, PaymentStatus } from './types.js';

// ============================================================================
// STATE DEFINITION
// ============================================================================

const PaymentStateAnnotation = Annotation.Root({
  amount: Annotation<number>,
  userId: Annotation<string>,
  transactionId: Annotation<string>,
  timestamp: Annotation<string>,
  fraudCheck: Annotation<FraudCheckResult | null>,
  paymentResult: Annotation<PaymentResult | null>,
  approved: Annotation<boolean>,
  status: Annotation<PaymentStatus>,
  metadata: Annotation<PaymentMetadata>,
});

// ============================================================================
// SIMULATED EXTERNAL SERVICES
// ============================================================================

let apiCallCounter = 0;

/**
 * Simulated fraud check API call
 * In production: Stripe Radar, Sift, etc.
 */
async function fraudCheckAPI(): Promise<FraudCheckResult> {
  apiCallCounter++;
  console.log(`  💸 [API CALL #${apiCallCounter}] Fraud check (cost: $0.05)`);

  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 100));

  const score = Math.random() * 100;
  return {
    score,
    risk: score > 70 ? 'high' : score > 40 ? 'medium' : 'low',
    factors: ['transaction_amount', 'user_history', 'device_fingerprint'],
  };
}

/**
 * Simulated payment processing API
 * In production: Stripe, PayPal, Square, etc.
 */
async function paymentAPI(): Promise<PaymentResult> {
  apiCallCounter++;
  console.log(`  💸 [API CALL #${apiCallCounter}] Process payment (cost: $0.10)`);

  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    success: true,
    paymentId: `pay_${Math.random().toString(36).substring(2, 11)}`,
    processedAt: new Date().toISOString(),
  };
}

// ============================================================================
// PART 1: BROKEN EXAMPLE (WITHOUT task())
// ============================================================================

/**
 * ⚠️ PROBLEMATIC NODE: Side effects before interrupt
 *
 * This demonstrates THREE critical problems:
 * 1. API calls execute multiple times (wasted money)
 * 2. Transaction ID changes on resume (breaks idempotency)
 * 3. Timestamp changes on resume (logical inconsistency)
 *
 * EXECUTION FLOW:
 * - First run: Generates ID "abc123", calls API, interrupts
 * - Resume: RE-GENERATES different ID "xyz789", RE-CALLS API, continues
 * - Result: Duplicate charges, inconsistent data, broken audit trail
 */
async function brokenFraudCheckNode(
  state: typeof PaymentStateAnnotation.State,
): Promise<Partial<typeof PaymentStateAnnotation.State>> {
  console.log('  [Broken Node] Starting fraud check...');

  // ⚠️ PROBLEM 1: Non-deterministic ID generation runs AGAIN on resume
  const transactionId = `txn_${Math.random().toString(36).substring(2, 11)}`;
  console.log(`  [Broken Node] Generated transaction ID: ${transactionId}`);

  // ⚠️ PROBLEM 2: Timestamp generation runs AGAIN on resume
  const timestamp = new Date().toISOString();
  console.log(`  [Broken Node] Timestamp: ${timestamp}`);

  // ⚠️ PROBLEM 3: API call executes AGAIN on resume
  const fraudCheck = await fraudCheckAPI();

  console.log(
    `  [Broken Node] Fraud score: ${fraudCheck.score.toFixed(2)} (${fraudCheck.risk} risk)`,
  );

  // Interrupt for human approval
  const approved = interrupt({
    type: 'payment_approval',
    message: 'Approve this payment?',
    transactionId, // ⚠️ Will be DIFFERENT on resume!
    timestamp, // ⚠️ Will be DIFFERENT on resume!
    amount: state.amount,
    fraudScore: fraudCheck.score,
    risk: fraudCheck.risk,
  });

  return {
    transactionId, // ⚠️ WRONG VALUE after resume
    timestamp, // ⚠️ WRONG VALUE after resume
    fraudCheck,
    approved: approved as boolean,
    status: 'awaiting_approval',
    metadata: {
      ...state.metadata,
      apiCallCount: apiCallCounter,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function brokenPaymentNode(
  state: typeof PaymentStateAnnotation.State,
): Promise<Partial<typeof PaymentStateAnnotation.State>> {
  console.log('  [Broken Node] Processing payment...');
  console.log(`  [Broken Node] Using transaction ID: ${state.transactionId}`);

  if (!state.approved) {
    return {
      status: 'cancelled',
      metadata: {
        ...state.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // This uses the WRONG transaction ID if resumed multiple times!
  const paymentResult = await paymentAPI();

  return {
    paymentResult,
    status: 'complete',
    metadata: {
      ...state.metadata,
      apiCallCount: apiCallCounter,
      updatedAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// PART 2: FIXED EXAMPLE (WITH task())
// ============================================================================

/**
 * ✅ SOLUTION: Wrap side effects in task()
 *
 * Each side effect is wrapped in task(), which:
 * 1. Executes the function on first run
 * 2. Saves the result to the checkpoint
 * 3. On resume, loads the cached result (no re-execution)
 *
 * Guide reference: Lines 854-876 (basic usage)
 */

// Task 1: Generate transaction ID (non-deterministic operation)
const generateTransactionId = task('generateTransactionId', async () => {
  const id = `txn_${Math.random().toString(36).substring(2, 11)}`;
  console.log(`  ✅ [Task] Generated transaction ID: ${id}`);
  return id;
});

// Task 2: Get timestamp (non-deterministic operation)
const getTimestamp = task('getTimestamp', async () => {
  const timestamp = new Date().toISOString();
  console.log(`  ✅ [Task] Generated timestamp: ${timestamp}`);
  return timestamp;
});

// Task 3: Fraud check API call (side effect)
const checkFraud = task('checkFraud', async () => {
  console.log('  ✅ [Task] Calling fraud check API...');
  const result = await fraudCheckAPI();
  console.log(`  ✅ [Task] Fraud score: ${result.score.toFixed(2)} (${result.risk} risk)`);
  return result;
});

// Task 4: Payment processing API call (side effect)
const processPayment = task('processPayment', async () => {
  console.log('  ✅ [Task] Calling payment API...');
  const result = await paymentAPI();
  console.log(`  ✅ [Task] Payment processed: ${result.paymentId}`);
  return result;
});

/**
 * ✅ FIXED NODE: All side effects wrapped in task()
 *
 * EXECUTION FLOW:
 * - First run: Executes all tasks, saves results to checkpoint, interrupts
 * - Resume: Loads all task results from checkpoint (no re-execution), continues
 * - Result: No duplicate charges, consistent data, correct audit trail
 *
 * Guide reference: Lines 854-876, 902-943
 */
async function fixedFraudCheckNode(
  state: typeof PaymentStateAnnotation.State,
): Promise<Partial<typeof PaymentStateAnnotation.State>> {
  console.log('  [Fixed Node] Starting fraud check...');

  // ✅ Tasks execute once, results cached on resume
  const transactionId = await generateTransactionId();
  const timestamp = await getTimestamp();

  const fraudCheck = await checkFraud();

  // Interrupt for human approval
  const approved = interrupt({
    type: 'payment_approval',
    message: 'Approve this payment?',
    transactionId, // ✅ SAME VALUE on resume
    timestamp, // ✅ SAME VALUE on resume
    amount: state.amount,
    fraudScore: fraudCheck.score,
    risk: fraudCheck.risk,
  });

  return {
    transactionId, // ✅ CORRECT VALUE after resume
    timestamp, // ✅ CORRECT VALUE after resume
    fraudCheck,
    approved: approved as boolean,
    status: 'awaiting_approval',
    metadata: {
      ...state.metadata,
      apiCallCount: apiCallCounter,
      updatedAt: timestamp,
    },
  };
}

async function fixedPaymentNode(
  state: typeof PaymentStateAnnotation.State,
): Promise<Partial<typeof PaymentStateAnnotation.State>> {
  console.log('  [Fixed Node] Processing payment...');
  console.log(`  [Fixed Node] Using transaction ID: ${state.transactionId}`);

  if (!state.approved) {
    return {
      status: 'cancelled',
      metadata: {
        ...state.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // ✅ Uses the CORRECT transaction ID from checkpoint
  const paymentResult = await processPayment();

  return {
    paymentResult,
    status: 'complete',
    metadata: {
      ...state.metadata,
      apiCallCount: apiCallCounter,
      updatedAt: state.timestamp,
    },
  };
}

// ============================================================================
// PART 3: ADVANCED PATTERN - Idempotency Keys
// ============================================================================

/**
 * Advanced Pattern: Combining task() with idempotency keys
 *
 * Production APIs (Stripe, PayPal) use idempotency keys to prevent duplicate
 * charges. Combine this with task() for maximum safety.
 *
 * Guide reference: Lines 994-1043
 */

const generateIdempotencyKey = task('generateIdempotencyKey', async () => {
  return `idem_${Math.random().toString(36).substring(2, 18)}`;
});

const chargeWithIdempotency = task(
  'chargeWithIdempotency',
  async (params: { amount: number; transactionId: string; idempotencyKey: string }) => {
    console.log(`  🔒 [Idempotent Task] Idempotency key: ${params.idempotencyKey}`);
    console.log('  🔒 [Idempotent Task] Processing payment...');

    // In production: This goes in headers
    // headers: { 'Idempotency-Key': params.idempotencyKey }

    apiCallCounter++;
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      success: true,
      paymentId: `pay_${Math.random().toString(36).substring(2, 11)}`,
      processedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
    };
  },
);

async function idempotentPaymentNode(state: typeof PaymentStateAnnotation.State): Promise<Command> {
  console.log('  [Idempotent Node] Starting...');

  // ✅ Generate idempotency key once
  const idempotencyKey = await generateIdempotencyKey();
  const transactionId = await generateTransactionId();

  const approved = interrupt({
    type: 'idempotent_approval',
    message: 'Approve payment with idempotency protection?',
    amount: state.amount,
    transactionId,
    idempotencyKey,
  });

  if (!approved) {
    return new Command({
      goto: '__end__',
      update: { status: 'cancelled' },
    });
  }

  // ✅ Charge with idempotency key - safe even if retried
  const result = await chargeWithIdempotency({
    amount: state.amount,
    transactionId,
    idempotencyKey,
  });

  return new Command({
    goto: '__end__',
    update: {
      paymentResult: result,
      status: 'complete',
      transactionId,
    },
  });
}

// ============================================================================
// GRAPH DEFINITIONS
// ============================================================================

const brokenGraph = new StateGraph(PaymentStateAnnotation)
  .addNode('fraud_check', brokenFraudCheckNode)
  .addNode('payment', brokenPaymentNode)
  .addEdge('__start__', 'fraud_check')
  .addEdge('fraud_check', 'payment')
  .addEdge('payment', '__end__')
  .compile({
    checkpointer: new MemorySaver(),
  });

const fixedGraph = new StateGraph(PaymentStateAnnotation)
  .addNode('fraud_check', fixedFraudCheckNode)
  .addNode('payment', fixedPaymentNode)
  .addEdge('__start__', 'fraud_check')
  .addEdge('fraud_check', 'payment')
  .addEdge('payment', '__end__')
  .compile({
    checkpointer: new MemorySaver(),
  });

const idempotentGraph = new StateGraph(PaymentStateAnnotation)
  .addNode('idempotent_payment', idempotentPaymentNode)
  .addEdge('__start__', 'idempotent_payment')
  .compile({
    checkpointer: new MemorySaver(),
  });

// ============================================================================
// DEMONSTRATION
// ============================================================================

async function demonstrateBrokenWorkflow(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('DEMONSTRATION 1: WITHOUT task() - THE PROBLEM');
  console.log('='.repeat(80));

  const config = { configurable: { thread_id: 'broken-example' } };

  apiCallCounter = 0;

  const initialState = {
    amount: 99.99,
    userId: 'user_123',
    transactionId: '',
    timestamp: '',
    fraudCheck: null,
    paymentResult: null,
    approved: false,
    status: 'pending' as PaymentStatus,
    metadata: {
      apiCallCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  console.log('\n📍 FIRST RUN: Execute until interrupt');
  console.log('-'.repeat(80));
  await brokenGraph.invoke(initialState, config);

  // Get state to inspect interrupt payload
  const state1 = await brokenGraph.getState(config);
  const interruptData = state1.tasks[0]?.interrupts?.[0]?.value as {
    transactionId: string;
    timestamp: string;
  };

  console.log(`\n✋ INTERRUPTED for approval`);
  console.log(`   Transaction ID: ${interruptData.transactionId}`);
  console.log(`   Timestamp: ${interruptData.timestamp}`);
  console.log(`   API calls so far: ${apiCallCounter}`);

  console.log('\n📍 RESUME: Approve and continue');
  console.log('-'.repeat(80));
  const result2 = await brokenGraph.invoke(new Command({ resume: true }), config);

  console.log('\n📊 FINAL RESULT:');
  console.log(`   Status: ${result2.status}`);
  console.log(`   Transaction ID: ${result2.transactionId}`);
  console.log(`   Total API calls: ${apiCallCounter}`);
  console.log('\n⚠️  PROBLEM: Transaction ID changed! API called multiple times!');
}

async function demonstrateFixedWorkflow(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('DEMONSTRATION 2: WITH task() - THE SOLUTION');
  console.log('='.repeat(80));

  const config = { configurable: { thread_id: 'fixed-example' } };

  apiCallCounter = 0;

  const initialState = {
    amount: 99.99,
    userId: 'user_123',
    transactionId: '',
    timestamp: '',
    fraudCheck: null,
    paymentResult: null,
    approved: false,
    status: 'pending' as PaymentStatus,
    metadata: {
      apiCallCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  console.log('\n📍 FIRST RUN: Execute until interrupt');
  console.log('-'.repeat(80));
  await fixedGraph.invoke(initialState, config);

  // Get state to inspect interrupt payload
  const state1 = await fixedGraph.getState(config);
  const interruptData = state1.tasks[0]?.interrupts?.[0]?.value as {
    transactionId: string;
    timestamp: string;
  };

  console.log(`\n✋ INTERRUPTED for approval`);
  console.log(`   Transaction ID: ${interruptData.transactionId}`);
  console.log(`   Timestamp: ${interruptData.timestamp}`);
  console.log(`   API calls so far: ${apiCallCounter}`);

  console.log('\n📍 RESUME: Approve and continue');
  console.log('-'.repeat(80));
  const result2 = await fixedGraph.invoke(new Command({ resume: true }), config);

  console.log('\n📊 FINAL RESULT:');
  console.log(`   Status: ${result2.status}`);
  console.log(`   Transaction ID: ${result2.transactionId}`);
  console.log(`   Total API calls: ${apiCallCounter}`);
  console.log('\n✅ SOLUTION: Same transaction ID! No duplicate API calls!');
}

async function demonstrateIdempotency(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('DEMONSTRATION 3: ADVANCED - Idempotency Keys');
  console.log('='.repeat(80));

  const config = { configurable: { thread_id: 'idempotent-example' } };

  apiCallCounter = 0;

  const initialState = {
    amount: 199.99,
    userId: 'user_456',
    transactionId: '',
    timestamp: '',
    fraudCheck: null,
    paymentResult: null,
    approved: false,
    status: 'pending' as PaymentStatus,
    metadata: {
      apiCallCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  console.log('\n📍 FIRST RUN: Execute until interrupt');
  console.log('-'.repeat(80));
  await idempotentGraph.invoke(initialState, config);

  console.log('\n📍 RESUME: Approve with idempotency protection');
  console.log('-'.repeat(80));
  const result = await idempotentGraph.invoke(new Command({ resume: true }), config);

  console.log('\n📊 FINAL RESULT:');
  console.log(`   Status: ${result.status}`);
  console.log(`   Payment ID: ${result.paymentResult?.paymentId}`);
  console.log(
    `   Idempotency Key: ${(result.paymentResult as { idempotencyKey?: string })?.idempotencyKey}`,
  );
  console.log('\n🔒 BEST PRACTICE: task() + idempotency keys = maximum safety');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '█'.repeat(80));
  console.log('Task Utility for Durable Execution - Human-in-the-Loop Demo');
  console.log('█'.repeat(80));
  console.log('\nThis example demonstrates why task() is critical when using');
  console.log('interrupt(). Nodes re-execute from the start on resume, causing');
  console.log('duplicate API calls and inconsistent data without task().\n');

  await demonstrateBrokenWorkflow();
  await demonstrateFixedWorkflow();
  await demonstrateIdempotency();

  console.log('\n' + '█'.repeat(80));
  console.log('KEY TAKEAWAYS');
  console.log('█'.repeat(80));
  console.log('1. ⚠️  WITHOUT task(): Side effects re-execute on every resume');
  console.log('2. ✅ WITH task(): Side effects execute once, results cached');
  console.log('3. 🔒 BEST PRACTICE: Combine task() with idempotency keys');
  console.log('4. 💰 COST SAVINGS: Prevent duplicate API charges');
  console.log('5. 🎯 CONSISTENCY: Same IDs/timestamps across resume');
  console.log('\nGuide reference: Lines 833-1401 in langgraph-js-human-in-the-loop-guide.md');
  console.log('█'.repeat(80) + '\n');
}

main().catch(console.error);
