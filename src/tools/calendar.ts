import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerCalendarTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.tool(
    'aula_get_calendar',
    'Get calendar events from Aula (school events, excursions, holidays, lessons, etc.).',
    {
      days_back: z.number().min(0).max(30).default(3).describe('Days to look back (default: 3)'),
      days_forward: z.number().min(1).max(60).default(14).describe('Days to look forward (default: 14)'),
      filter: z
        .enum(['all', 'all_except_lessons', 'lessons_only', 'excursions_only', 'special_events'])
        .default('all_except_lessons')
        .describe('Which event types to include (default: all_except_lessons)'),
    },
    async ({ days_back, days_forward, filter }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        let events;
        switch (filter) {
          case 'lessons_only':
            events = await client.GetCalendarEventsOnlyLessons(days_back, days_forward);
            break;
          case 'excursions_only':
            events = await client.GetCalendarEventsOnlyExcursions(days_back, days_forward);
            break;
          case 'special_events':
            events = await client.GetCalendarEventsSpecialEvents(days_back, days_forward);
            break;
          case 'all_except_lessons':
            events = await client.GetCalendarEventsExceptLessons(days_back, days_forward);
            break;
          case 'all':
          default:
            events = await client.GetCalendarEvents(days_back, days_forward);
            break;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                events.map((e) => ({
                  id: e.id,
                  title: e.title,
                  startDateTime: e.startDateTime,
                  endDateTime: e.endDateTime,
                  allDay: e.allDay,
                  type: e.type,
                  institutionName: e.institutionName,
                  creatorName: e.creatorName,
                  addedToInstitutionCalendar: e.addedToInstitutionCalendar,
                  responseRequired: e.responseRequired,
                  responseDeadline: e.responseDeadline,
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch calendar: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
