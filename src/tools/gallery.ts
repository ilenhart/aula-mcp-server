import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AulaAPIClient } from '@ilenhart/aula-apiclient-ts';

export function registerGalleryTools(
  server: McpServer,
  getClient: () => AulaAPIClient | null
) {
  server.registerTool(
    'aula_get_gallery',
    {
      description: 'Get recent photo albums and media from Aula. Returns album metadata and media URLs (not the actual images).',
      inputSchema: {
        days_back: z.number().min(1).max(60).default(7).describe('Number of days to look back (default: 7)'),
        album_limit: z.number().min(1).max(20).default(5).describe('Maximum albums to return (default: 5)'),
        media_limit: z.number().min(1).max(50).default(10).describe('Maximum media items per album (default: 10)'),
      },
    },
    async ({ days_back, album_limit, media_limit }) => {
      const client = getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Call aula_login first.' }],
          isError: true,
        };
      }

      try {
        const albums = await client.GetGalleryAlbumMedia(album_limit, media_limit, undefined, days_back);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                albums.map((a) => ({
                  id: a.id,
                  title: a.title,
                  description: a.description,
                  creationDate: a.creationDate,
                  isDefaultMyChildAlbum: a.IsDefaultMyChildAlbum,
                  mediaCount: a.Media?.length ?? 0,
                  media: a.Media?.map((m) => ({
                    id: m.id,
                    title: m.title,
                    mediaType: m.mediaType,
                    fileName: m.file?.name,
                    fileUrl: m.file?.url,
                    fileCreated: m.file?.created,
                    thumbnailUrl: m.thumbnailUrl,
                    creatorName: m.creator?.name,
                  })),
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
          content: [{ type: 'text' as const, text: `Failed to fetch gallery: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
