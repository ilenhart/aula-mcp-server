# Aula MCP Server - Attachment Tool Guide

## What Was Added

### New Tools: Two-Tool Architecture for Context Efficiency

#### Tool 1: `aula_get_attachment`

Downloads an attachment from S3 and saves it locally, returning **metadata only** (no base64 content). This keeps the MCP tool response small (~1-2 KB) and doesn't overwhelm Claude's context.

**Parameters:**
- `attachment_url` (string, required): The S3 URL from post/message attachment metadata
- `attachment_type` (enum, required): Either `'image'` or `'file'`
- `filename` (string, optional): Filename for better MIME type detection and saving
- `attachment_id` (number, optional): Attachment ID from Aula for tracking

**Returns:**
- Download confirmation message
- Local file path where attachment was saved
- **Prominently displayed S3 URL** (clickable link for user to open directly in browser)
- Full metadata (size, MIME type, download timestamp)
- **Does NOT include file content** - keeps response tiny

**Features:**
- ✅ Security: Only allows S3 URLs from Aula/AWS
- ✅ Size limit: 10MB max to prevent memory issues
- ✅ MIME type detection from headers or filename
- ✅ Handles expired URLs gracefully (common with S3)
- ✅ Saves to local `data/attachments/` directory
- ✅ Supports 20+ file types (images, PDFs, Office docs, archives)

#### Tool 2: `aula_view_attachment`

Lazy-loads the actual file content for a previously downloaded attachment. **Only call this when the user explicitly asks to view/see/analyze an attachment.**

**Parameters:**
- `local_path` (string, required): The local file path from a previous `aula_get_attachment` response
- `max_size_mb` (number, optional): Maximum file size to load (default: 0.75MB, max: 0.75MB)

**Returns:**
- **For images**: MCP image content block (displays inline in Claude)
- **For text files**: File content as text
- **For binary files (PDFs, docs)**: Base64-encoded content with metadata

**Important Limitations:**
- ⚠️ **MCP has a 1MB tool response limit**
- Base64 encoding increases file size by ~33%
- Practical limit is ~750KB for files (0.75MB default enforced)
- For larger files, the tool returns an error with alternatives:
  - Click the S3 URL from the download response
  - Open the local file path directly
- This is why we split into two tools - download is always safe, viewing is opt-in and size-limited

---

## Enhanced Existing Tools

### Updated: `aula_get_posts`

Now returns **full attachment metadata** for each post:

```json
{
  "id": 12345,
  "title": "School trip to the zoo",
  "body": "<p>...</p>",
  "hasAttachments": true,
  "attachmentCount": 2,
  "attachments": [
    {
      "id": 67890,
      "name": "trip-details.pdf",
      "isImage": false,
      "isFile": true,
      "url": "https://s3.amazonaws.com/...",
      "thumbnailUrl": null,
      "fileName": "trip-details.pdf",
      "creator": "Teacher Name"
    },
    {
      "id": 67891,
      "name": "zoo-photo.jpg",
      "isImage": true,
      "isFile": false,
      "url": "https://s3.amazonaws.com/...",
      "thumbnailUrl": "https://s3.amazonaws.com/.../thumbnail",
      "fileName": null,
      "creator": "Teacher Name"
    }
  ]
}
```

### Updated: `aula_get_messages`

Same enhancement - full attachment metadata included in message responses.

---

## Example User Workflows

### Workflow 1: Download and View an Image

**User:** "What posts are there today?"

**Claude calls:** `aula_get_posts(days_back=1)`

**Claude sees:** A post with an image attachment

**User:** "Download that photo"

**Claude calls:** `aula_get_attachment(url="https://s3...", type="image", filename="zoo-photo.jpg")`

**Claude receives:** Metadata only (~1 KB response):
```
Downloaded: zoo-photo.jpg (245 KB)

Local path: c:\...\data\attachments\1739123456_a1b2c3d4_zoo-photo.jpg

Original S3 URL (clickable, may expire):
https://s3.amazonaws.com/...

Full metadata: { ... }
```

**Claude:** "Downloaded the photo to your local attachments folder. You can [click the S3 link](https://s3...) to view it in your browser."

**User:** "Actually, show it to me here"

**Claude calls:** `aula_view_attachment(local_path="c:\...\zoo-photo.jpg")`

**Claude displays:** The image inline in the chat (as MCP image content block)

---

### Workflow 2: Large File - S3 Link Only

**User:** "Do I have any messages with PDFs?"

**Claude calls:** `aula_get_messages(days_back=3)`

**Claude finds:** A message with a large PDF attachment (2.3 MB)

**User:** "Can you read that PDF and tell me what it says?"

**Claude calls:** `aula_get_attachment(url="https://...", type="file", filename="permissions.pdf")`

**Claude receives:** Downloaded successfully, local path + S3 URL

**Claude calls:** `aula_view_attachment(local_path="c:\...\permissions.pdf")`

**Claude receives:** Error - file too large (2.3 MB exceeds 0.75 MB limit)

**Claude:** "The PDF is too large (2.3 MB) to load into our conversation due to MCP's 1MB response limit. However, I've downloaded it to your local drive at c:\...\permissions.pdf. You can also [click here to open it directly from the Aula server](https://s3...)."

---

### Workflow 3: Multiple Attachments - Smart Download Strategy

**User:** "What's in the latest post from the teacher?"

**Claude calls:** `aula_get_posts(days_back=1, limit=1)`

**Claude sees:** Post has 3 attachments (2 images: 45 KB, 67 KB; 1 PDF: 1.8 MB)

**Claude:** "The post has 3 attachments: two photos (class-photo.jpg, art-project.jpg) and one PDF (supply-list.pdf). I can download them all for you. Would you like me to show the photos inline?"

**User:** "Yes, show me both photos"

**Claude calls (in parallel):**
1. `aula_get_attachment(url="...", type="image", filename="class-photo.jpg")`
2. `aula_get_attachment(url="...", type="image", filename="art-project.jpg")`
3. `aula_get_attachment(url="...", type="file", filename="supply-list.pdf")`

**All download successfully with metadata + S3 URLs**

**Claude calls (sequentially):**
1. `aula_view_attachment(local_path="...class-photo.jpg")`
2. `aula_view_attachment(local_path="...art-project.jpg")`

**Claude displays:** Both images inline, plus: "I also downloaded supply-list.pdf (1.8 MB) but it's too large to display here. [Click to open the PDF](https://s3...) or find it at c:\...\supply-list.pdf"

---

## Technical Details

### File Location
- **New tools:** `src/tools/attachments.ts` (both `aula_get_attachment` and `aula_view_attachment`)
- **Updated:** `src/tools/posts.ts` and `src/tools/messages.ts` (now return full attachment metadata)
- **Registered in:** `src/index.ts`
- **Storage:** Downloaded files saved to `data/attachments/` (gitignored)

### Dependencies
- Uses Node.js built-in `fetch()` (Node 18+)
- Uses `Buffer` for base64 encoding (only in `aula_view_attachment`)
- Uses `crypto` for generating unique filenames (MD5 hash of URL)
- Uses `path` and `fs` for file system operations
- Uses `import.meta.url` with `fileURLToPath` for reliable path resolution (works even when spawned from different working directory)

### Path Resolution Strategy
The MCP server may be spawned from any working directory (e.g., `C:\Windows\system32` when launched by Claude Desktop). To ensure reliable file paths:
```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..'); // dist/ -> project root
const ATTACHMENTS_DIR = path.join(PROJECT_ROOT, 'data', 'attachments');
```

### Security Measures
- **Download tool (`aula_get_attachment`):**
  - Only accepts URLs from `amazonaws.com` or `aula.dk` domains
  - 10MB file size limit
  - Validates URL format before fetching
  - Generates safe filenames (sanitizes input, adds hash to prevent collisions)

- **View tool (`aula_view_attachment`):**
  - Path validation: Only allows viewing files from `ATTACHMENTS_DIR`
  - Prevents directory traversal attacks
  - Enforces 0.75MB max file size (due to MCP 1MB response limit)

### Error Handling
- **Expired URLs (403/404):** Returns clear message to refetch the post/message
- **Network errors:** Returns error with details
- **File too large (download):** Returns size warning (10MB limit)
- **File too large (view):** Returns error with alternatives (S3 URL, local path)
- **Invalid URL:** Returns security error
- **File not found (view):** Returns clear message if local file was deleted
- **Path traversal (view):** Returns security error

### Supported File Types

**Images:**
- JPG, PNG, GIF, WebP, SVG, BMP

**Documents:**
- PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV

**Archives:**
- ZIP, RAR, 7Z

**Other:**
- JSON, XML, HTML

---

## Important Notes

### MCP 1MB Tool Response Limit
MCP (Model Context Protocol) has a **hard 1MB limit** on tool response size. This is why we split attachment handling into two separate tools:

1. **Download (`aula_get_attachment`)**: Always safe - returns only metadata (~1-2 KB)
2. **View (`aula_view_attachment`)**: Opt-in, size-limited - returns actual content

**The math:**
- Base64 encoding increases file size by ~33%
- A 750 KB file becomes ~1000 KB (1 MB) when base64-encoded
- Therefore, `aula_view_attachment` enforces a 0.75 MB default maximum

**Best practices:**
- Always download first (provides S3 URL + local path)
- Only call `aula_view_attachment` when user explicitly asks to see/analyze content
- For large files, provide the S3 URL or local path instead of trying to load into context

### S3 URL Expiration
Aula's attachment URLs are temporary S3 pre-signed URLs that **expire quickly** (typically within minutes to hours). If you get a 403/404 error:

1. Call `aula_get_posts` or `aula_get_messages` again to get a fresh URL
2. Immediately call `aula_get_attachment` with the new URL

**Why prominently display S3 URLs:**
- User can click directly in chat to open in browser
- Bypasses MCP size limits entirely
- Works even after local file is deleted
- May still work hours later if S3 URL hasn't expired yet

### Performance Considerations
- Downloading files takes time (network-dependent)
- `aula_get_attachment` is fast (just metadata response)
- `aula_view_attachment` may be slow for large files (reading + base64 encoding)
- Consider downloading multiple attachments in parallel, but viewing them sequentially

### Claude Desktop Integration
Once you restart Claude Desktop, the tools will be available. You can test them by:
1. Asking "What posts do I have?"
2. If any have attachments: "Download that PDF"
3. Click the S3 link in the response to view it, OR
4. Ask "Show me that image" to load it inline (if small enough)

---

## Testing Checklist

Once deployed:

**Setup:**
- [ ] Both tools appear in Claude Desktop's tool list (`aula_get_attachment` and `aula_view_attachment`)
- [ ] `data/attachments/` directory is created automatically on first download

**Download Tool (`aula_get_attachment`):**
- [ ] Can download image attachments successfully
- [ ] Can download PDF attachments successfully
- [ ] Returns metadata only (not base64 content)
- [ ] S3 URL is prominently displayed and clickable
- [ ] Local file path is correct and file exists on disk
- [ ] Expired URL error handling works (403/404 → clear message)
- [ ] Security validation blocks non-Aula URLs
- [ ] MIME type detection works correctly
- [ ] 10MB size limit prevents huge downloads

**View Tool (`aula_view_attachment`):**
- [ ] Can view small images inline (<750 KB)
- [ ] Can view text files as text
- [ ] Returns error for files >0.75 MB with helpful alternatives
- [ ] Security validation prevents viewing files outside attachments directory
- [ ] Returns clear error if file doesn't exist locally
- [ ] MCP image content blocks display correctly for images

**Integration:**
- [ ] `aula_get_posts` returns full attachment metadata including URLs
- [ ] `aula_get_messages` returns full attachment metadata including URLs
- [ ] Can download → view workflow works end-to-end
- [ ] Multiple parallel downloads work correctly
- [ ] Filename sanitization prevents path injection
