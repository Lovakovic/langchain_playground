/**
 * Type definitions for advanced HITL patterns example
 */

export interface ContentMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewCount: number;
  readonly toolCallsReviewed: number;
}

export interface ToolCallProposal {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly estimatedCost: number;
  readonly reasoning: string;
}

export interface ToolCallReview {
  readonly action: 'approve' | 'edit' | 'reject';
  readonly editedArgs?: Record<string, unknown>;
  readonly rejectionReason?: string;
}

export interface ImageGenerationResult {
  readonly url: string;
  readonly prompt: string;
  readonly cost: number;
  readonly timestamp: string;
}

export type WorkflowStatus =
  | 'drafting'
  | 'awaiting_draft_review'
  | 'revising_draft'
  | 'planning_image'
  | 'awaiting_tool_review'
  | 'generating_image'
  | 'awaiting_final_approval'
  | 'publishing'
  | 'complete'
  | 'cancelled';

export interface ContentState {
  readonly topic: string;
  readonly targetAudience: string;
  readonly draft: string;
  readonly finalContent: string;
  readonly draftFeedback: string;
  readonly imagePrompt: string;
  readonly imageResult: ImageGenerationResult | null;
  readonly status: WorkflowStatus;
  readonly metadata: ContentMetadata;
  readonly humanReviewed: boolean;
  readonly publishUrl: string;
}
