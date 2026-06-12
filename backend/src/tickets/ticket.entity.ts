export interface Ticket {
  id: number;
  subject: string | null;
  status: string | null;
  ownerTeam: string | null;
  slaSolutionDate: string | null;
  slaSolutionDateIsPaused: boolean;
  opened_at: string | null;
  closed_at: string | null;
  last_update: string | null;
  responsavel: string | null;
  assigned_at: string | null;
  assignment_override: string | null;
  trello_card_id: string | null;
  trello_card_url: string | null;
  trello_card_name: string | null;
  trello_card_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketAiTriagePreview {
  id: number;
  status: 'completed';
  priority: 'baixa' | 'media' | 'alta' | 'critica';
  summary: string;
  likelyArea: string;
  confidence: 'baixa' | 'media' | 'alta';
  updated_at: string;
  finished_at: string | null;
}

export interface TicketDto {
  id: number;
  subject: string | null;
  status: string | null;
  ownerTeam: string | null;
  slaSolutionDate: string | null;
  slaSolutionDateIsPaused: boolean;
  opened_at: string | null;
  closed_at: string | null;
  last_update: string | null;
  responsavel: string | null;
  assigned_at: string | null;
  trello_card_id: string | null;
  trello_card_url: string | null;
  trello_card_name: string | null;
  trello_card_created_at: string | null;
  ai_triage: TicketAiTriagePreview | null;
}

export interface TicketMonthlyAnalyticsItem {
  month: string;
  label: string;
  opened: number;
  resolved_on_time: number;
  resolved_late: number;
  sla_paused: number;
}

export interface TicketMonthlyAnalyticsDto {
  generated_at: string;
  active_sla_paused: number;
  months: TicketMonthlyAnalyticsItem[];
  current_month: TicketMonthlyAnalyticsItem | null;
}

export interface TicketDetailInteractionDto {
  id: number | null;
  type: 'public' | 'internal';
  origin: number | null;
  status: string | null;
  author: string | null;
  authorEmail: string | null;
  createdDate: string | null;
  text: string;
  isDeleted: boolean;
}

export interface TicketDetailDto {
  id: number;
  subject: string | null;
  status: string | null;
  urgency: string | null;
  category: string | null;
  ownerTeam: string | null;
  ownerName: string | null;
  createdDate: string | null;
  lastUpdate: string | null;
  slaSolutionDate: string | null;
  clients: Array<{
    name: string | null;
    email: string | null;
    organization: string | null;
  }>;
  serviceFull: string[];
  tags: string[];
  summary: string;
  interactions: TicketDetailInteractionDto[];
  rawActionCount: number;
}

export interface SimilarTicketDto {
  id: number;
  subject: string | null;
  status: string | null;
  ownerTeam: string | null;
  responsavel: string | null;
  opened_at: string | null;
  slaSolutionDate: string | null;
  trello_card_url: string | null;
  score: number;
  reasons: string[];
  ai_triage: TicketAiTriagePreview | null;
}
