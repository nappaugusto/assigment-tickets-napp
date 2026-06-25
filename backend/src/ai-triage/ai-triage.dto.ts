import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  diagnosticQueries: Array<{
    title: string;
    purpose: string;
    sql: string;
    expectedEvidence: string;
  }>;
  executedQueries: Array<{
    title: string;
    sql: string;
    status: 'completed' | 'failed' | 'skipped';
    rowCount: number | null;
    durationMs: number;
    error: string;
    columns: string[];
    sampleRows: Array<Record<string, unknown>>;
    sampleTruncated: boolean;
  }>;
  codeInvestigationPaths: Array<{
    path: string;
    symbol: string;
    reason: string;
    check: string;
  }>;
  nextSteps: string[];
  suggestedCard: {
    title: string;
    description: string;
    labels: string[];
  };
  suggestedCustomerReply: string;
  similarTickets: Array<{
    id: number;
    subject: string;
    reason: string;
  }>;
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
  follow_up_messages: TicketAiTriageMessageDto[];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface TicketAiTriageMessageDto {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AiTriageMemoryDto {
  id: number;
  status: 'candidate' | 'validated' | 'rejected';
  likelyArea: string;
  technicalPattern: string;
  codePaths: TicketAiTriageResult['codeInvestigationPaths'];
  diagnosticQueries: TicketAiTriageResult['diagnosticQueries'];
  confidence: TicketAiTriageResult['confidence'];
}

export class TriageDecisionDto {
  @IsIn(['accepted', 'ignored', 'copied', 'card_created'])
  decision!: TriageDecision;
}

export class TriageFollowUpDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  message!: string;
}

export class CodeAnalysisContextDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  sellerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  eans?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  notes?: string;
}
