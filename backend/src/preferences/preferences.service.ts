import { Inject, Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
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
  value: string;
}

@Injectable()
export class PreferencesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  getMonthlyAnalytics(userId: number): MonthlyAnalyticsPreferenceDto {
    const row = this.db
      .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
      .get(userId, MONTHLY_ANALYTICS_KEY) as PreferenceRow | undefined;

    if (!row) return DEFAULT_MONTHLY_ANALYTICS_PREFERENCE;

    try {
      const parsed = JSON.parse(row.value) as Partial<MonthlyAnalyticsPreferenceDto>;
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

  saveMonthlyAnalytics(userId: number, dto: SaveMonthlyAnalyticsPreferenceDto): void {
    this.db
      .prepare(`
        INSERT INTO user_preferences (user_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(userId, MONTHLY_ANALYTICS_KEY, JSON.stringify(dto));
  }
}
