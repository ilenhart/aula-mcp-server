import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerMeebookTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.registerTool(
    'aula_get_meebook',
    {
      description: "Get MeeBook weekly plans and book lists for your child's class. Includes lesson plans, learning goals, and assigned reading.",
      inputSchema: {},
    },
    async () => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        const meebook = await client.getMeeBookInformation();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(meebook, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch MeeBook data: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
