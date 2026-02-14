import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerDailyTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.tool(
    'aula_get_daily_overview',
    "Get today's daily overview for your child (attendance status, check-in/out times, notes).",
    {},
    async () => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      if (!client.CurrentChild) {
        return {
          content: [{ type: 'text' as const, text: 'No child selected. Re-authenticate with aula_login.' }],
          isError: true,
        };
      }

      try {
        const overview = await client.GetDailyOverview(client.CurrentChild.id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(overview, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch daily overview: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
