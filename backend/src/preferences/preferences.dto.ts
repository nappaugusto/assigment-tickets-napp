import { IsBoolean } from 'class-validator';

export interface MonthlyAnalyticsPreferenceDto {
  collapsed: boolean;
  summaryCollapsed: boolean;
}

export class SaveMonthlyAnalyticsPreferenceDto {
  @IsBoolean()
  collapsed: boolean;

  @IsBoolean()
  summaryCollapsed: boolean;
}
