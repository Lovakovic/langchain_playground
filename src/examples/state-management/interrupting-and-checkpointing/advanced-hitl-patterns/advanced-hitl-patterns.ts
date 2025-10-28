/**
 * Advanced Human-in-the-Loop Patterns
 *
 * This example demonstrates advanced HITL patterns from the comprehensive guide:
 * 1. Multiple sequential interrupts across workflow
 * 2. Input validation loops (multiple interrupts in ONE node)
 * 3. Tool call review/edit/reject pattern
 * 4. Command.update for state editing during resume
 * 5. Command.goto for conditional routing
 * 6. Both invoke() and stream() usage patterns
 * 7. Side effect handling best practices
 *
 * Use Case: Content Publishing Workflow
 * - Generate content draft → Human review with validation
 * - Plan image generation → Tool call review
 * - Generate final content → Final approval
 * - Publish → Complete
 *
 * This example focuses on PATTERNS, not production features.
 * For production PostgreSQL setup, see interrupt-and-postgres-saver.ts
 */

import { Annotation, interrupt, StateGraph, Command } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { HumanMessage } from '@langchain/core/messages';
import * as readline from 'readline';
import dotenv from 'dotenv';
import type {
  ContentState,
  WorkflowStatus,
  ContentMetadata,
  ToolCallProposal,
  ImageGenerationResult,
} from './types';

dotenv.config();

/**
 * Stream chunk with interrupt information
 */
interface StreamChunkWithInterrupt {
  __interrupt__: Array<{
    value: unknown;
  }>;
}

/**
 * Type guards for interrupt data
 */
interface DraftReviewInterrupt {
  type: 'draft_review';
  question: string;
  draft: string;
  options: string[];
}

interface ToolCallReviewInterrupt {
  type: 'tool_call_review';
  question: string;
  tool: ToolCallProposal;
  instructions: string;
}

interface FinalApprovalInterrupt {
  type: 'final_approval';
  question: string;
  content: string;
  image: string;
  options: string[];
}

/**
 * Type guards for interrupt data
 * Union: DraftReviewInterrupt | ToolCallReviewInterrupt | FinalApprovalInterrupt
 */
function isDraftReviewInterrupt(data: unknown): data is DraftReviewInterrupt {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'draft_review' &&
    'question' in data
  );
}

function isToolCallReviewInterrupt(data: unknown): data is ToolCallReviewInterrupt {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'tool_call_review' &&
    'tool' in data
  );
}

function isFinalApprovalInterrupt(data: unknown): data is FinalApprovalInterrupt {
  return (
    typeof data === 'object' && data !== null && 'type' in data && data.type === 'final_approval'
  );
}

/**
 * State Definition
 *
 * Note: Using simple replacers for clarity in this pattern-focused example.
 * For production reducers, see interrupt-and-postgres-saver.ts
 */
const ContentStateAnnotation = Annotation.Root({
  topic: Annotation<string>,
  targetAudience: Annotation<string>,
  draft: Annotation<string>,
  finalContent: Annotation<string>,
  draftFeedback: Annotation<string>,
  imagePrompt: Annotation<string>,
  imageResult: Annotation<ImageGenerationResult | null>,
  status: Annotation<WorkflowStatus>,
  metadata: Annotation<ContentMetadata>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewCount: 0,
      toolCallsReviewed: 0,
    }),
  }),
  humanReviewed: Annotation<boolean>,
  publishUrl: Annotation<string>,
});

// Initialize LLM
function createLLM(): ChatVertexAI {
  if (!process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. ' +
        'Please set it to the path of your service account key file.',
    );
  }

  return new ChatVertexAI({
    model: 'gemini-2.0-flash-exp',
    temperature: 0.7,
  });
}

/**
 * Node 1: Generate Initial Draft
 *
 * ✅ PATTERN: Side effect (LLM call) placement
 * - LLM call happens BEFORE any interrupt in workflow
 * - This is safe because it's in a separate node
 * - Next node has the interrupt, so this won't re-run
 */
async function generateDraftNode(
  state: typeof ContentStateAnnotation.State,
): Promise<Partial<ContentState>> {
  console.log('\n📝 Generating content draft...');

  const llm = createLLM();
  const prompt = `Create a ${state.targetAudience} blog post about: ${state.topic}

Requirements:
- 300-400 words
- Engaging introduction
- 3 main points
- Clear conclusion

Write the complete draft:`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const draft = response.content.toString();

  console.log('✅ Draft generated');
  console.log('\n--- DRAFT ---');
  console.log(draft);
  console.log('--- END DRAFT ---\n');

  return {
    draft,
    status: 'awaiting_draft_review',
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Node 2: Human Review with Validation Loop
 *
 * ⭐ PATTERN: Multiple interrupts in ONE node (Validation Loop)
 * - Uses while(true) loop with interrupt()
 * - Validates human input before accepting
 * - Re-prompts with helpful error messages
 * - Demonstrates guide section: "5. Validate Human Input" (lines 483-514)
 *
 * CRITICAL: Each interrupt() call happens sequentially in the SAME node
 * The node will re-execute from the start on each resume, but the
 * interrupt() calls are consumed in order from the resume values list.
 */
async function humanDraftReviewNode(state: typeof ContentStateAnnotation.State): Promise<Command> {
  console.log('\n👤 Awaiting human review of draft...');

  let question = `Review the draft. Options:
  - 'approve': Accept and continue
  - 'revise': Request changes (provide specific feedback)
  - 'cancel': Abort workflow

Your choice:`;

  // ⭐ VALIDATION LOOP PATTERN
  while (true) {
    const response = interrupt({
      type: 'draft_review',
      question,
      draft: state.draft,
      options: ['approve', 'revise', 'cancel'],
    });

    // Validate input
    if (response === 'approve') {
      console.log('✅ Draft approved');

      // ⭐ PATTERN: Command.update + Command.goto
      // We update state AND route to next node in one command
      return new Command({
        goto: 'plan_image',
        update: {
          status: 'planning_image' as WorkflowStatus,
          humanReviewed: true,
          metadata: {
            ...state.metadata,
            reviewCount: state.metadata.reviewCount + 1,
            updatedAt: new Date().toISOString(),
          },
        },
      });
    }

    if (response === 'cancel') {
      console.log('❌ Workflow cancelled by user');
      return new Command({
        goto: '__end__',
        update: {
          status: 'cancelled' as WorkflowStatus,
        },
      });
    }

    // Check if it's a revision request
    if (typeof response === 'string' && response.startsWith('revise:') && response.length > 8) {
      const feedback = response.substring(7).trim();
      console.log(`📋 Revision requested: ${feedback}`);

      return new Command({
        goto: 'revise_draft',
        update: {
          draftFeedback: feedback,
          status: 'revising_draft' as WorkflowStatus,
          metadata: {
            ...state.metadata,
            reviewCount: state.metadata.reviewCount + 1,
            updatedAt: new Date().toISOString(),
          },
        },
      });
    }

    // Invalid input - loop again with new question
    // ⭐ This demonstrates multiple interrupts in one node
    question = `❌ Invalid input: '${response}'

Valid options:
  - 'approve': Accept draft as-is
  - 'revise: YOUR FEEDBACK': Request changes
  - 'cancel': Abort workflow

Example: 'revise: Add more examples in section 2'

Your choice:`;
  }
}

/**
 * Node 3: Revise Draft Based on Feedback
 *
 * ✅ PATTERN: Side effects after validation
 * - LLM call happens in separate node, after feedback validated
 * - Won't be re-executed if next node has interrupt
 */
async function reviseDraftNode(
  state: typeof ContentStateAnnotation.State,
): Promise<Partial<ContentState>> {
  console.log(`\n🔄 Revising draft based on feedback: "${state.draftFeedback}"`);

  const llm = createLLM();
  const prompt = `Revise this draft based on the feedback:

ORIGINAL DRAFT:
${state.draft}

FEEDBACK:
${state.draftFeedback}

Provide the revised draft (keep same length ~300-400 words):`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const revisedDraft = response.content.toString();

  console.log('✅ Draft revised');
  console.log('\n--- REVISED DRAFT ---');
  console.log(revisedDraft);
  console.log('--- END REVISED DRAFT ---\n');

  return {
    draft: revisedDraft,
    status: 'awaiting_draft_review',
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Node 4: Plan Image Generation (Proposes Tool Call)
 *
 * ✅ PATTERN: Prepare tool call for review
 * - Generates tool call proposal
 * - Does NOT execute yet
 * - Next node will review it
 */
async function planImageNode(
  state: typeof ContentStateAnnotation.State,
): Promise<Partial<ContentState>> {
  console.log('\n🎨 Planning image generation...');

  const llm = createLLM();
  const prompt = `Based on this content, create a DALL-E prompt for a header image.
Return ONLY the image prompt, nothing else.

CONTENT:
${state.draft}

Image prompt:`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const imagePrompt = response.content.toString().trim();

  console.log(`✅ Image prompt created: "${imagePrompt}"`);

  return {
    imagePrompt,
    status: 'awaiting_tool_review',
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Node 5: Review Tool Call
 *
 * ⭐ PATTERN: Tool Call Review/Edit/Reject
 * - Demonstrates guide section: "3. Review Tool Calls" (lines 378-430)
 * - Human can approve, edit args, or reject
 * - Uses structured response format [action, data]
 * - Routes based on decision using Command.goto
 */
async function reviewToolCallNode(state: typeof ContentStateAnnotation.State): Promise<Command> {
  console.log('\n👤 Awaiting tool call review...');

  const toolProposal: ToolCallProposal = {
    name: 'generate_image',
    args: {
      prompt: state.imagePrompt,
      size: '1024x1024',
      quality: 'standard',
    },
    estimatedCost: 0.04,
    reasoning: 'Generate header image for blog post',
  };

  // ⭐ PATTERN: Tool call review interrupt
  const review = interrupt({
    type: 'tool_call_review',
    question: 'Review this image generation request',
    tool: toolProposal,
    instructions: `Options:
    1. ['approve', null] - Execute as-is
    2. ['edit', { prompt: 'new prompt' }] - Modify and execute
    3. ['reject', 'reason'] - Skip image generation`,
  });

  // Validate review structure
  if (!Array.isArray(review) || review.length !== 2) {
    throw new Error(
      `Invalid tool review format. Expected [action, data], got: ${JSON.stringify(review)}`,
    );
  }

  const [action, data] = review as [string, unknown];

  console.log(`📋 Tool call ${action}ed`);

  if (action === 'approve') {
    return new Command({
      goto: 'generate_image',
      update: {
        status: 'generating_image' as WorkflowStatus,
        metadata: {
          ...state.metadata,
          toolCallsReviewed: state.metadata.toolCallsReviewed + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  if (action === 'edit') {
    // Apply human edits to tool call
    const editedPrompt =
      typeof data === 'object' && data !== null && 'prompt' in data
        ? (data.prompt as string)
        : state.imagePrompt;

    console.log(`✏️ Using edited prompt: "${editedPrompt}"`);

    return new Command({
      goto: 'generate_image',
      update: {
        imagePrompt: editedPrompt,
        status: 'generating_image' as WorkflowStatus,
        metadata: {
          ...state.metadata,
          toolCallsReviewed: state.metadata.toolCallsReviewed + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  if (action === 'reject') {
    const reason = typeof data === 'string' ? data : 'No reason provided';
    console.log(`❌ Tool call rejected: ${reason}`);

    // Skip image generation, go straight to final approval
    return new Command({
      goto: 'final_approval',
      update: {
        status: 'awaiting_final_approval' as WorkflowStatus,
        metadata: {
          ...state.metadata,
          toolCallsReviewed: state.metadata.toolCallsReviewed + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  throw new Error(`Unknown tool review action: ${action}`);
}

/**
 * Node 6: Execute Tool Call (Generate Image)
 *
 * ✅ PATTERN: Side effects after approval
 * - Only runs after human approval
 * - Simulates image generation API call
 */
async function generateImageNode(
  state: typeof ContentStateAnnotation.State,
): Promise<Partial<ContentState>> {
  console.log('\n🎨 Generating image...');
  console.log(`Prompt: "${state.imagePrompt}"`);

  // Simulate image generation API call
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const imageResult: ImageGenerationResult = {
    url: `https://example.com/images/${Date.now()}.png`,
    prompt: state.imagePrompt,
    cost: 0.04,
    timestamp: new Date().toISOString(),
  };

  console.log(`✅ Image generated: ${imageResult.url}`);

  return {
    imageResult,
    status: 'awaiting_final_approval',
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Node 7: Final Approval
 *
 * ⭐ PATTERN: Simple interrupt with boolean response
 * - Demonstrates basic approve/reject flow
 * - Uses Command.goto for routing
 */
async function finalApprovalNode(state: typeof ContentStateAnnotation.State): Promise<Command> {
  console.log('\n👤 Final approval required...');

  const approved = interrupt({
    type: 'final_approval',
    question: 'Approve for publishing?',
    content: state.draft,
    image: state.imageResult?.url || 'No image',
    options: ['true', 'false'],
  });

  if (approved === true || approved === 'true') {
    console.log('✅ Approved for publishing');
    return new Command({
      goto: 'publish',
      update: {
        status: 'publishing' as WorkflowStatus,
        finalContent: state.draft,
      },
    });
  }

  console.log('❌ Publishing cancelled');
  return new Command({
    goto: '__end__',
    update: {
      status: 'cancelled' as WorkflowStatus,
    },
  });
}

/**
 * Node 8: Publish Content
 *
 * ✅ PATTERN: Final side effect
 * - Only runs after all approvals
 * - Simulates publishing API call
 */
async function publishNode(
  state: typeof ContentStateAnnotation.State,
): Promise<Partial<ContentState>> {
  console.log('\n🚀 Publishing content...');

  // Simulate publishing API call
  await new Promise((resolve) => setTimeout(resolve, 500));

  const publishUrl = `https://blog.example.com/posts/${Date.now()}`;

  console.log(`✅ Published successfully!`);
  console.log(`📍 URL: ${publishUrl}`);
  console.log(`\n=== PUBLISH SUMMARY ===`);
  console.log(`Topic: ${state.topic}`);
  console.log(`Reviews: ${state.metadata.reviewCount}`);
  console.log(`Tool calls reviewed: ${state.metadata.toolCallsReviewed}`);
  console.log(`Image: ${state.imageResult ? 'Yes' : 'No'}`);

  return {
    publishUrl,
    status: 'complete',
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Build Content Publishing Workflow
 *
 * Demonstrates multiple HITL patterns in sequence:
 * 1. Draft → Review (validation loop)
 * 2. Optional: Revise → Review again
 * 3. Plan tool call → Review tool call
 * 4. Execute tool call
 * 5. Final approval → Publish
 */
function buildContentWorkflow() {
  const workflow = new StateGraph(ContentStateAnnotation)
    .addNode('generate_draft', generateDraftNode)
    .addNode('human_review', humanDraftReviewNode)
    .addNode('revise_draft', reviseDraftNode)
    .addNode('plan_image', planImageNode)
    .addNode('review_tool', reviewToolCallNode)
    .addNode('generate_image', generateImageNode)
    .addNode('final_approval', finalApprovalNode)
    .addNode('publish', publishNode)
    .addEdge('__start__', 'generate_draft')
    .addEdge('generate_draft', 'human_review')
    // human_review uses Command.goto, no edge needed
    .addEdge('revise_draft', 'human_review')
    .addEdge('plan_image', 'review_tool')
    // review_tool uses Command.goto, no edge needed
    .addEdge('generate_image', 'final_approval')
    // final_approval uses Command.goto, no edge needed
    .addEdge('publish', '__end__');

  return workflow;
}

/**
 * Example 1: Using invoke() with getState()
 *
 * ⭐ PATTERN: Detecting interrupts with invoke()
 * - invoke() does NOT return interrupt info
 * - Must call getState() to access interrupts
 * - Check state.tasks for pending interrupts
 */
async function runWithInvoke(): Promise<void> {
  console.log('\n=== Running with invoke() pattern ===\n');

  const checkpointer = new MemorySaver();
  const workflow = buildContentWorkflow();
  const graph = workflow.compile({ checkpointer });

  const threadId = `content-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  // Initial invoke
  const topic = await question('Enter blog topic: ');
  const audience = await question('Enter target audience (e.g., "developers"): ');

  await graph.invoke(
    {
      topic,
      targetAudience: audience,
    },
    config,
  );

  // Main loop: check for interrupts and resume
  while (true) {
    // ⭐ CRITICAL: Must use getState() to detect interrupts with invoke()
    const state = await graph.getState(config);

    // Check if workflow completed
    if (state.next.length === 0) {
      console.log('\n✅ Workflow completed!');
      break;
    }

    // Check for interrupts
    const pendingTask = state.tasks.find((task) => task.interrupts && task.interrupts.length > 0);

    if (pendingTask?.interrupts && pendingTask.interrupts.length > 0) {
      const interruptData = pendingTask.interrupts[0];
      if (!interruptData?.value) {
        console.error('Invalid interrupt data');
        break;
      }

      const value = interruptData.value;

      console.log('\n🛑 Interrupt detected');

      if (isDraftReviewInterrupt(value)) {
        console.log('Type:', value.type);
        console.log('Question:', value.question);
        const answer = await question('\nYour response: ');
        await graph.invoke(new Command({ resume: answer }), config);
      } else if (isToolCallReviewInterrupt(value)) {
        console.log('Type:', value.type);
        console.log('Question:', value.question);
        console.log('\nTool:', JSON.stringify(value.tool, null, 2));
        const action = await question('\nAction (approve/edit/reject): ');

        if (action === 'edit') {
          const newPrompt = await question('Enter new prompt: ');
          await graph.invoke(new Command({ resume: [action, { prompt: newPrompt }] }), config);
        } else {
          const data = action === 'reject' ? await question('Reason: ') : null;
          await graph.invoke(new Command({ resume: [action, data] }), config);
        }
      } else if (isFinalApprovalInterrupt(value)) {
        console.log('Type:', value.type);
        console.log('Question:', value.question);
        const answer = await question('\nApprove? (true/false): ');
        await graph.invoke(new Command({ resume: answer === 'true' }), config);
      }
    } else {
      // No interrupt, continue execution
      await graph.invoke(null, config);
    }
  }

  rl.close();
}

/**
 * Example 2: Using stream()
 *
 * ⭐ PATTERN: Detecting interrupts with stream()
 * - Interrupt info comes directly in stream chunks
 * - Look for chunk.__interrupt__
 * - More convenient than invoke() + getState()
 */
async function runWithStream(): Promise<void> {
  console.log('\n=== Running with stream() pattern ===\n');

  const checkpointer = new MemorySaver();
  const workflow = buildContentWorkflow();
  const graph = workflow.compile({ checkpointer });

  const threadId = `content-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  const topic = await question('Enter blog topic: ');
  const audience = await question('Enter target audience (e.g., "developers"): ');

  // Initial stream
  for await (const chunk of await graph.stream(
    {
      topic,
      targetAudience: audience,
    },
    config,
  )) {
    // ⭐ PATTERN: Interrupt info in stream chunk
    if ('__interrupt__' in chunk) {
      const interrupts = (chunk as StreamChunkWithInterrupt).__interrupt__;
      if (interrupts && Array.isArray(interrupts) && interrupts.length > 0) {
        const interrupt = interrupts[0];
        if (!interrupt) {
          console.error('Invalid interrupt data');
          break;
        }
        const value = interrupt.value;
        if (!value) {
          console.error('Invalid interrupt data');
          break;
        }
        console.log('\n🛑 Interrupt detected');

        let resumeValue: unknown;

        if (isDraftReviewInterrupt(value)) {
          console.log('Type:', value.type);
          console.log('Question:', value.question);
          resumeValue = await question('\nYour response: ');
        } else if (isToolCallReviewInterrupt(value)) {
          console.log('Type:', value.type);
          console.log('Question:', value.question);
          console.log('\nTool:', JSON.stringify(value.tool, null, 2));
          const action = await question('\nAction (approve/edit/reject): ');

          if (action === 'edit') {
            const newPrompt = await question('Enter new prompt: ');
            resumeValue = [action, { prompt: newPrompt }];
          } else {
            const data = action === 'reject' ? await question('Reason: ') : null;
            resumeValue = [action, data];
          }
        } else if (isFinalApprovalInterrupt(value)) {
          console.log('Type:', value.type);
          console.log('Question:', value.question);
          const answer = await question('\nApprove? (true/false): ');
          resumeValue = answer === 'true';
        }

        // Resume with stream
        for await (const resumeChunk of await graph.stream(
          new Command({ resume: resumeValue }),
          config,
        )) {
          if ('__interrupt__' in resumeChunk) {
            // Handle nested interrupts recursively (not implemented for brevity)
            console.log('\n⚠️ Nested interrupt detected - restart to handle');
            rl.close();
            return;
          }
        }
      }
    }
  }

  console.log('\n✅ Workflow completed!');
  rl.close();
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
  console.log('=== Advanced HITL Patterns Demo ===');
  console.log('\nThis example demonstrates:');
  console.log('1. Multiple sequential interrupts');
  console.log('2. Validation loops (multiple interrupts in one node)');
  console.log('3. Tool call review/edit/reject');
  console.log('4. Command.update and Command.goto');
  console.log('5. Both invoke() and stream() patterns\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('Choose execution mode:');
  console.log('1. invoke() + getState() pattern');
  console.log('2. stream() pattern');

  const choice = await question('\n> ');
  rl.close();

  if (choice === '1') {
    await runWithInvoke();
  } else if (choice === '2') {
    await runWithStream();
  } else {
    console.log('Invalid choice');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

/**
 * KEY PATTERNS DEMONSTRATED
 *
 * 1. VALIDATION LOOP (humanDraftReviewNode)
 *    - Multiple interrupt() calls in one node
 *    - while(true) loop for validation
 *    - Guide reference: lines 483-514
 *
 * 2. TOOL CALL REVIEW (reviewToolCallNode)
 *    - Structured review: [action, data]
 *    - Support approve/edit/reject
 *    - Guide reference: lines 378-430
 *
 * 3. COMMAND.UPDATE + COMMAND.GOTO
 *    - Update state while routing
 *    - Used throughout for clean flow control
 *    - Guide reference: lines 268-291
 *
 * 4. INVOKE() VS STREAM()
 *    - invoke() requires getState() to detect interrupts
 *    - stream() surfaces interrupts in chunks
 *    - Guide reference: lines 589-642
 *
 * 5. SIDE EFFECT PLACEMENT
 *    - LLM calls in separate nodes before interrupts
 *    - No re-execution issues
 *    - Guide reference: lines 647-691
 *
 * 6. MULTIPLE SEQUENTIAL INTERRUPTS
 *    - Draft review → Tool review → Final approval
 *    - Each is a separate checkpoint
 *    - State preserved between interrupts
 */
