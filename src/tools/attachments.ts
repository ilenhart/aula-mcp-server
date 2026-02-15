import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current file's directory (works in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is one level up from dist/ directory
const PROJECT_ROOT = path.join(__dirname, '..');

// Directory for storing downloaded attachments
const ATTACHMENTS_DIR = path.join(PROJECT_ROOT, 'data', 'attachments');

// Ensure attachments directory exists
if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

/**
 * Register attachment fetching tool on the MCP server.
 *
 * Tool:
 * - aula_get_attachment: Download an attachment from S3 and save locally, returning metadata only
 */
export function registerAttachmentTools(server: McpServer) {
  server.registerTool(
    'aula_get_attachment',
    {
      description: 'Download an attachment (image or file) from Aula and save it locally. Returns metadata and local file path WITHOUT including the actual file content in the response (to avoid overwhelming context). Use the attachment URL from aula_get_posts or aula_get_messages results.',
      inputSchema: {
        attachment_url: z
          .string()
          .url()
          .describe('The S3 URL of the attachment (from post/message attachment metadata)'),
        attachment_type: z
          .enum(['image', 'file'])
          .describe('Type of attachment: "image" for photos/pictures, "file" for PDFs/documents'),
        filename: z
          .string()
          .optional()
          .describe('Optional filename for saving and MIME type detection'),
        attachment_id: z
          .number()
          .optional()
          .describe('Optional attachment ID from Aula for tracking'),
      },
    },
    async ({ attachment_url, attachment_type, filename, attachment_id }) => {
      try {
        // Security: Only allow S3 URLs from Aula
        const url = new URL(attachment_url);
        if (!url.hostname.includes('amazonaws.com') && !url.hostname.includes('aula.dk')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Security error: Only Aula S3 URLs are allowed',
              },
            ],
            isError: true,
          };
        }

        // Fetch the attachment
        const response = await fetch(attachment_url);

        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Attachment URL has expired or is invalid. Please refetch the post/message to get a fresh URL.',
                },
              ],
              isError: true,
            };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check file size (limit to 10MB)
        const contentLength = response.headers.get('content-length');
        const fileSize = contentLength ? parseInt(contentLength) : 0;

        if (fileSize > 10 * 1024 * 1024) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `File is too large (${formatFileSize(fileSize)}). Maximum size is 10MB.`,
              },
            ],
            isError: true,
          };
        }

        // Get MIME type
        let mimeType = response.headers.get('content-type') || 'application/octet-stream';

        // If no MIME type from headers, try to detect from filename
        if (mimeType === 'application/octet-stream' && filename) {
          mimeType = detectMimeType(filename);
        }

        // Get file extension from filename or MIME type
        let extension = '';
        if (filename) {
          extension = path.extname(filename);
        } else {
          extension = getExtensionFromMimeType(mimeType);
        }

        // Generate a unique filename using hash of URL + timestamp
        const urlHash = crypto.createHash('md5').update(attachment_url).digest('hex').substring(0, 8);
        const timestamp = Date.now();
        const sanitizedOriginalName = filename
          ? path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
          : `attachment_${attachment_id || 'unknown'}`;

        const localFilename = `${timestamp}_${urlHash}_${sanitizedOriginalName}${extension}`;
        const localPath = path.join(ATTACHMENTS_DIR, localFilename);

        // Download and save the file
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(localPath, buffer);

        // Return metadata only (no base64 data)
        const metadata = {
          downloaded: true,
          filename: filename || sanitizedOriginalName,
          localPath: localPath,
          size: buffer.byteLength,
          sizeFormatted: formatFileSize(buffer.byteLength),
          mimeType: mimeType,
          type: attachment_type,
          attachmentId: attachment_id,
          sourceUrl: attachment_url,
          downloadedAt: new Date().toISOString(),
          note: `File downloaded and saved locally. The actual content is NOT included in this response to save context space.`,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: `Downloaded: ${filename || sanitizedOriginalName} (${formatFileSize(buffer.byteLength)})\n\nLocal path: ${localPath}\n\nOriginal S3 URL (clickable, may expire):\n${attachment_url}\n\nFull metadata:\n${JSON.stringify(metadata, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to fetch attachment: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── aula_view_attachment ────────────────────────────────────────────
  server.registerTool(
    'aula_view_attachment',
    {
      description: 'Load and view a previously downloaded attachment. Returns the actual file content (as base64 for images/files or text for text files). ONLY call this when the user explicitly asks to view/see/analyze an attachment. WARNING: MCP tool responses have a 1MB limit. Files larger than ~750KB will fail when base64-encoded. For large files, provide the user with the S3 URL or local file path instead.',
      inputSchema: {
        local_path: z
          .string()
          .describe('The local file path from a previous aula_get_attachment response'),
        max_size_mb: z
          .number()
          .min(0.1)
          .max(0.75)
          .default(0.75)
          .describe('Maximum file size in MB to load (default: 0.75MB to stay under 1MB MCP response limit when base64-encoded)'),
      },
    },
    async ({ local_path, max_size_mb }) => {
      try {
        // Security: Ensure path is within ATTACHMENTS_DIR
        const normalizedPath = path.normalize(local_path);
        const normalizedAttachmentsDir = path.normalize(ATTACHMENTS_DIR);

        if (!normalizedPath.startsWith(normalizedAttachmentsDir)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Security error: Can only view files from the attachments directory',
              },
            ],
            isError: true,
          };
        }

        // Check if file exists
        if (!fs.existsSync(normalizedPath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `File not found: ${normalizedPath}. It may have been deleted or the path is incorrect.`,
              },
            ],
            isError: true,
          };
        }

        // Check file size
        const stats = fs.statSync(normalizedPath);
        const maxSizeBytes = max_size_mb * 1024 * 1024;

        if (stats.size > maxSizeBytes) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `File is too large (${formatFileSize(stats.size)}) to view directly. Maximum size is ${max_size_mb}MB due to MCP's 1MB tool response limit.\n\nOptions:\n1. Click the S3 URL from the download response to view in browser\n2. Open the local file at: ${normalizedPath}\n3. For smaller files only, you can increase max_size_mb up to 0.75MB`,
              },
            ],
            isError: true,
          };
        }

        // Get MIME type from filename
        const filename = path.basename(normalizedPath);
        const mimeType = detectMimeType(filename);

        // Read file
        const buffer = fs.readFileSync(normalizedPath);

        // Return based on MIME type
        if (mimeType.startsWith('image/')) {
          // Return image as MCP image content block
          const base64 = buffer.toString('base64');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Viewing image: ${filename} (${formatFileSize(stats.size)})`,
              },
              {
                type: 'image' as const,
                data: base64,
                mimeType: mimeType,
              },
            ],
          };
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          // Return text content directly
          const text = buffer.toString('utf-8');
          return {
            content: [
              {
                type: 'text' as const,
                text: `File: ${filename} (${formatFileSize(stats.size)})\nMIME type: ${mimeType}\n\n${text}`,
              },
            ],
          };
        } else {
          // For binary files (PDFs, docs, etc.), return as base64 with metadata
          const base64 = buffer.toString('base64');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    filename: filename,
                    mimeType: mimeType,
                    size: stats.size,
                    sizeFormatted: formatFileSize(stats.size),
                    base64: base64,
                    note: 'For PDFs and documents, you can analyze the base64 content. For other binary files, you may need to save this elsewhere to open it.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to view attachment: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Detect MIME type from filename extension
 */
function detectMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',

    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',

    // Other
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
  };

  return ext ? (mimeTypes[ext] || 'application/octet-stream') : 'application/octet-stream';
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/json': '.json',
    'application/xml': '.xml',
    'text/html': '.html',
  };

  return mimeToExt[mimeType] || '';
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
