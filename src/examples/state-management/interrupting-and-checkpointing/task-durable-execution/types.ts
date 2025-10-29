/**
 * Type definitions for task-durable-execution example
 */

export type PaymentStatus =
  | 'pending'
  | 'fraud_check'
  | 'awaiting_approval'
  | 'processing'
  | 'complete'
  | 'cancelled';

export interface FraudCheckResult {
  readonly score: number;
  readonly risk: 'low' | 'medium' | 'high';
  readonly factors: readonly string[];
}

export interface PaymentResult {
  readonly success: boolean;
  readonly paymentId: string;
  readonly processedAt: string;
}

export interface PaymentMetadata {
  readonly apiCallCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
