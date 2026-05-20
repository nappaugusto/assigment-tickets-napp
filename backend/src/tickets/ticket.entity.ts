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
