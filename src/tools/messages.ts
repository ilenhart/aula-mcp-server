import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerMessagesTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.tool(
    'aula_get_messages',
    'Get recent messages from Aula (individual or group messages from teachers/parents). Content is in Danish.',
    {
      days_back: z.number().min(1).max(30).default(3).describe('Number of days to look back (default: 3)'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum messages to return (default: 20)'),
    },
    async ({ days_back, limit }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        const messages = await client.GetAulaMessages(days_back, limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  threadId: m.threadId,
                  threadSubject: m.threadSubject,
                  text: m.text,
                  sendDateTime: m.sendDateTime,
                  hasAttachments: (m.attachments?.length ?? 0) > 0,
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
          content: [{ type: 'text' as const, text: `Failed to fetch messages: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'aula_get_thread',
    'Get a full message thread by thread ID, including all messages in the conversation.',
    {
      thread_id: z.string().describe('The thread ID to fetch'),
    },
    async ({ thread_id }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        const thread = await client.GetAulaThreadSingle(thread_id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(thread, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch thread: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'aula_get_threads',
    'Get all message threads with recent activity, including full message history for each thread.',
    {
      days_back: z.number().min(1).max(30).default(3).describe('Number of days to look back for active threads (default: 3)'),
    },
    async ({ days_back }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        const threads = await client.GetAulaThreads(days_back);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(threads, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch threads: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
