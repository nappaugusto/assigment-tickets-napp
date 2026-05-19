import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import {
  MonthlyAnalyticsPreferenceDto,
  SaveMonthlyAnalyticsPreferenceDto,
} from './preferences.dto';

const MONTHLY_ANALYTICS_KEY = 'monthlyAnalytics';
const DEFAULT_MONTHLY_ANALYTICS_PREFERENCE: MonthlyAnalyticsPreferenceDto = {
  collapsed: false,
  summaryCollapsed: false,
};

interface PreferenceRow {
  value: unknown;
}

@Injectable()
export class PreferencesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getMonthlyAnalytics(
    userId: number,
  ): Promise<MonthlyAnalyticsPreferenceDto> {
    const result = await this.db.query<PreferenceRow>(
      'SELECT value FROM user_preferences WHERE user_id = $1 AND key = $2',
      [userId, MONTHLY_ANALYTICS_KEY],
    );
    const row = result.rows[0];

    if (!row) return DEFAULT_MONTHLY_ANALYTICS_PREFERENCE;

    try {
      const parsed =
        typeof row.value === 'string'
          ? (JSON.parse(row.value) as Partial<MonthlyAnalyticsPreferenceDto>)
          : (row.value as Partial<MonthlyAnalyticsPreferenceDto>);
      return {
        collapsed:
          typeof parsed.collapsed === 'boolean'
            ? parsed.collapsed
            : DEFAULT_MONTHLY_ANALYTICS_PREFERENCE.collapsed,
        summaryCollapsed:
          typeof parsed.summaryCollapsed === 'boolean'
            ? parsed.summaryCollapsed
            : DEFAULT_MONTHLY_ANALYTICS_PREFERENCE.summaryCollapsed,
      };
    } catch {
      return DEFAULT_MONTHLY_ANALYTICS_PREFERENCE;
    }
  }

  async saveMonthlyAnalytics(
    userId: number,
    dto: SaveMonthlyAnalyticsPreferenceDto,
  ): Promise<void> {
    await this.db.query(
      `
        INSERT INTO user_preferences (user_id, key, value, updated_at)
        VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      [userId, MONTHLY_ANALYTICS_KEY, JSON.stringify(dto)],
    );
  }
}
