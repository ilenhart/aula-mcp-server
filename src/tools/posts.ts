import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerPostsTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.registerTool(
    'aula_get_posts',
    {
      description: 'Get recent general posts from Aula (announcements, updates from school). Content is in Danish — Claude can translate.',
      inputSchema: {
        days_back: z.number().min(1).max(30).default(3).describe('Number of days to look back (default: 3)'),
        limit: z.number().min(1).max(50).default(10).describe('Maximum number of posts to return (default: 10)'),
      },
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
        const posts = await client.GetPosts(days_back, limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                posts.map((p) => ({
                  id: p.id,
                  title: p.title,
                  body: p.content?.html,
                  timestamp: p.timestamp,
                  ownerName: p.ownerProfile?.fullName,
                  ownerInstitutionName: p.ownerProfile?.institution?.institutionName,
                  isImportant: p.isImportant,
                  hasAttachments: (p.attachments?.length ?? 0) > 0,
                  attachmentCount: p.attachments?.length ?? 0,
                  attachments: p.attachments?.map((a) => ({
                    id: a.id,
                    name: a.name,
                    isImage: a.IsImage(),
                    isFile: a.IsFile(),
                    url: a.IsImage()
                      ? a.AsImage()?.GetFullSizeUrl()
                      : a.AsFile()?.GetFileUrl(),
                    thumbnailUrl: a.IsImage() ? a.AsImage()?.GetThumbnailUrl() : null,
                    fileName: a.IsFile() ? a.AsFile()?.GetFileName() : null,
                    creator: a.creator?.name,
                  })) || [],
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
          content: [{ type: 'text' as const, text: `Failed to fetch posts: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
