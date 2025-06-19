export interface SearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
  timestamp: string;
  cost: number;
}

export interface Source {
  title: string;
  url: string;
  relevanceScore: number;
  summary: string;
  searchQuery: string;
}

export type ResearchStatus = 
  | "parsing"
  | "initial_search"
  | "deep_diving"
  | "analyzing"
  | "summarizing"
  | "awaiting_feedback"
  | "refining"
  | "complete";

export interface ResearchMetadata {
  startTime: string;
  lastUpdateTime: string;
  checkpointCount: number;
}