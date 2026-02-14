# Aula MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives Claude real-time access to [Aula.dk](https://www.aula.dk) — the Danish school communication platform. Ask Claude about your child's school day, upcoming events, messages from teachers, and more — all translated from Danish on the fly.

## Prerequisites

- **Node.js** 18+
- **Google Chrome** installed (used for MitID authentication)
- A **MitID** account linked to your child's Aula profile
- **Claude Desktop** (Windows, macOS, or Linux)

## Quick Start

Add this to your Claude Desktop config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aula": {
      "command": "npx",
      "args": ["-y", "@ilenhart/aula-mcp-server"],
      "env": {
        "BROWSER_EXECUTABLE_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "AULA_CHILD_NAME": "YourChildFirstName"
      }
    }
  }
}
```

Restart Claude Desktop. Then just ask Claude: **"Log me into Aula"** — a Chrome window will open for MitID authentication.

## How Authentication Works

Aula.dk uses Denmark's MitID national 2FA system. There's no API key — you authenticate by scanning a QR code with the MitID phone app.

1. Ask Claude to log into Aula
2. A Chrome window opens with the Aula login page
3. Click through to the MitID screen, enter your username, and scan the QR code with your MitID app
4. The server detects the completed login, captures the session cookie, and closes the browser
5. The session is kept alive automatically with background pings every 15 minutes

Sessions persist across Claude Desktop restarts (stored in `~/.aula-mcp/session.json`). You only need to re-authenticate if the session expires (typically after server maintenance).

## Available Tools

### Authentication

| Tool | Description |
|------|-------------|
| `aula_login` | Start MitID auth flow or confirm existing session |
| `aula_check_auth` | Poll for completed QR scan (called automatically) |
| `aula_session_status` | Check if current session is valid |

### School Data

| Tool | Description |
|------|-------------|
| `aula_get_posts` | Recent school announcements and updates |
| `aula_get_messages` | Recent messages from teachers and parents |
| `aula_get_thread` | Full conversation thread by ID |
| `aula_get_threads` | All active message threads |
| `aula_get_calendar` | Calendar events with type filtering |
| `aula_get_daily_overview` | Today's attendance status and notes |
| `aula_get_gallery` | Recent photo albums and media |
| `aula_find_people` | Search for parents, teachers, and staff |
| `aula_get_meebook` | Weekly lesson plans and book lists |

## Configuration

All configuration is via environment variables, set in the `"env"` block of your Claude Desktop config.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BROWSER_EXECUTABLE_PATH` | Yes | — | Path to Chrome executable |
| `AULA_CHILD_NAME` | Yes | — | Your child's first name (for profile selection) |
| `AULA_INSTITUTION_NAME` | No | *(first found)* | School name (partial match) |
| `AULA_API_URL` | No | `https://www.aula.dk/api/` | Aula API base URL |
| `PING_INTERVAL_MINUTES` | No | `15` | Session keepalive interval |
| `AULA_DATA_DIR` | No | `~/.aula-mcp/` | Directory for session data |

### Common Chrome paths

- **Windows:** `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **macOS:** `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- **Linux:** `/usr/bin/google-chrome`

## Example Conversations

> **You:** What's happening at school this week?
>
> **Claude:** *Fetches posts, calendar events, and messages, translates from Danish, and gives you a summary*

> **You:** Are there any messages from the teacher I should respond to?
>
> **Claude:** *Checks recent message threads, identifies ones needing a reply*

> **You:** What does my child's schedule look like next week?
>
> **Claude:** *Pulls calendar events and MeeBook weekly plans*

## Development

If you want to contribute or run from source:

```bash
git clone https://github.com/ilenhart/aula-mcp-server.git
cd aula-mcp-server
npm install
npm run build
```

For local development with auto-reload:

```bash
npm run dev
```

To use the local version in Claude Desktop, update your config to point at the built file:

```json
{
  "mcpServers": {
    "aula": {
      "command": "node",
      "args": ["C:/path/to/aula-mcp-server/dist/index.js"],
      "env": {
        "BROWSER_EXECUTABLE_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "AULA_CHILD_NAME": "YourChildFirstName"
      }
    }
  }
}
```

## Troubleshooting

**"No session stored" / "Session expired"**
Call `aula_login` to re-authenticate via MitID.

**Chrome doesn't open**
Verify `BROWSER_EXECUTABLE_PATH` points to your actual Chrome installation. The path must be the full path to the executable, not just the directory.

**"Failed to start login flow"**
Chrome may already be running with a conflicting profile. Try closing all Chrome windows first.

**Session dies frequently**
The default 15-minute ping interval should keep sessions alive. If you're still losing sessions, try reducing `PING_INTERVAL_MINUTES` to `10`.

## How It Works

This server uses the [`@ilenhart/aula-apiclient-ts`](https://github.com/ilenhart/AulaAPIClient) library to communicate with Aula's internal API. Authentication is handled via `puppeteer-core` (using your installed Chrome — no bundled browser) to capture the session cookie after MitID login.

All content from Aula is in Danish. Claude translates and interprets it conversationally when presenting it to you.

## License

MIT
