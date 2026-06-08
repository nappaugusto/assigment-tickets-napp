import { IsIn } from 'class-validator';

export type TriageStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TriageDecision = 'accepted' | 'ignored' | 'copied' | 'card_created';

export interface CodeSnippetDto {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface TicketAiTriageResult {
  tags: string[];
  priority: 'baixa' | 'media' | 'alta' | 'critica';
  shouldCreateCard: boolean;
  summary: string;
  symptom: string;
  likelyArea: string;
  reasoning: string;
  technicalHypothesis: string;
  evidence: string[];
  relevantFiles: Array<{
    path: string;
    reason: string;
  }>;
  nextSteps: string[];
  suggestedCard: {
    title: string;
    description: string;
    labels: string[];
  };
  customerQuestions: string[];
  confidence: 'baixa' | 'media' | 'alta';
}

export interface TicketAiTriageDto {
  id: number;
  ticket_id: number;
  provider: string;
  model: string;
  status: TriageStatus;
  triage: TicketAiTriageResult | null;
  input_summary: Record<string, unknown> | null;
  error: string | null;
  decision: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export class TriageDecisionDto {
  @IsIn(['accepted', 'ignored', 'copied', 'card_created'])
  decision!: TriageDecision;
}
