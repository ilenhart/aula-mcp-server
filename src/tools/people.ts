import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerPeopleTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.tool(
    'aula_find_people',
    'Search for people (parents, children, teachers, employees) connected to your school on Aula.',
    {
      name: z.string().describe('Name or partial name to search for'),
      role: z
        .enum(['any', 'parent', 'child', 'teacher', 'preschool_teacher', 'leader', 'employee'])
        .default('any')
        .describe('Filter by role (default: any)'),
    },
    async ({ name, role }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        let results;
        switch (role) {
          case 'parent':
            results = await client.FindAnyParents(name);
            break;
          case 'child':
            results = await client.FindAnyChildren(name);
            break;
          case 'teacher':
            results = await client.FindAnyTeachers(name);
            break;
          case 'preschool_teacher':
            results = await client.FindAnyPreschoolTeachers(name);
            break;
          case 'leader':
            results = await client.FindAnyLeaders(name);
            break;
          case 'employee':
            results = await client.FindAnyEmployees(name);
            break;
          case 'any':
          default:
            results = await client.FindAnyPeople(name);
            break;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                results.map((r) => ({
                  id: r.id,
                  name: r.name,
                  shortName: r.shortName,
                  portalRole: r.portalRole,
                  institutionRole: r.institutionRole,
                  institutionName: r.institutionName,
                  aulaEmail: r.aulaEmail,
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
          content: [{ type: 'text' as const, text: `Failed to search people: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
