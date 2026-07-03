export type FeedbackStatus =
  | 'BACKLOG'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'REJECTED';

export interface FeedbackTaskResponse {
  id: string;
  title: string;
  description: string | null;
  status: FeedbackStatus;
  fuelCount: number;
  hasVoted: boolean;
  authorId: string | null;
  authorName: string | null;
  createdDate: string;
  modifyDate: string | null;
  adminNote: string | null;
}

export interface PagedResponse<T> {
  content: T[];
  page: number;
  size: number;
  total: number;
}

export interface CreateFeedbackTaskRequest {
  title: string;
  description?: string | null;
}

export interface UpdateFeedbackTaskRequest {
  title?: string;
  description?: string | null;
}

export interface UpdateStatusRequest {
  status: FeedbackStatus;
  adminNote?: string | null;
}

export type FeedbackSort = 'fuel' | 'new';
