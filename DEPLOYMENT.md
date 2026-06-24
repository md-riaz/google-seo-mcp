# Shared Self-Hosted Deployment Guide for Google SEO MCP

This guide explains how to deploy the Google SEO MCP server centrally in your company's hosting infrastructure (VPS) using Docker and Nginx. This setup allows multiple team members to connect to the server with a shared API key, leveraging a single set of centrally managed search engine credentials.

---

## 🏗️ Docker Deployment

To deploy this MCP server as a container:

### 1. Build the Docker Image
Build the image from the root of the repository:
```bash
docker build -t company-google-seo-mcp .
```

### 2. Configure Environment Variables
You should configure the following environment variables on the VPS/container:

| Variable | Description | Example |
|---|---|---|
| `PORT` | The internal port the containerized Express app listens on. | `3000` |
| `BASE_PATH` | The URL prefix subpath (vital for running behind Nginx). | `/search-console` |
| `MCP_API_KEY` | The security key team members must use to connect. | `your-secure-shared-token` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google Service Account JSON file (inside container). | `/secrets/google-sa.json` |

### 3. Run the Container
```bash
docker run -d \
  --name google-seo-mcp \
  -p 3000:3000 \
  -v /path/to/local/google-sa.json:/secrets/google-sa.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/google-sa.json \
  -e PORT=3000 \
  -e BASE_PATH=/search-console \
  -e MCP_API_KEY="your-secure-shared-token" \
  company-google-seo-mcp
```

---

## 🔀 Nginx Configuration (Hosting Multiple MCP Servers)

If you are hosting multiple MCP servers (e.g., Search Console, GitHub, Databases) on the same VPS, you can proxy them using a single Nginx server block with subpath routing.

> [!NOTE]
> **Why `BASE_PATH` is needed:**
> In the SSE protocol, the server instructs the client on where to POST messages. If you rewrite/strip the subpath (e.g., rewriting `/search-console/sse` to `/sse`) at the Nginx level, the server will tell the client to POST messages to `/messages` instead of `/search-console/messages`. This will cause routing collisions on Nginx.
> By passing `BASE_PATH=/search-console` to the container, Nginx can route directly to the server without rewrites, and the server will correctly tell the client to POST to `/search-console/messages`.

Here is an example Nginx configuration (`/etc/nginx/sites-available/mcp.conf`):

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.yourcompany.com;

    # SSL Config (e.g., Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/mcp.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.yourcompany.com/privkey.pem;

    # 1. Google SEO MCP (runs internally on port 3000, mapped to /search-console)
    location /search-console/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # Crucial for Server-Sent Events (SSE) streaming stability
        proxy_set_header Connection '';
        proxy_set_header Content-Type 'text/event-stream';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;

        # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. GitHub MCP Server (runs internally on port 3001, mapped to /github)
    location /github/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Content-Type 'text/event-stream';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 👥 Team Member Setup (Connecting Claude Code)

Once the server is hosted, team members can connect their local Claude Code client to it.

### Method 1: Claude CLI Command
In their terminals, team members can run:
```bash
claude mcp add search-console https://mcp.yourcompany.com/search-console/sse --headers "Authorization=Bearer your-secure-shared-token"
```

### Method 2: Manual JSON Configuration
Alternatively, they can add it manually to their Claude config file (usually located at `~/.claudecode/mcp.json` or configured via `claude mcp add-json`):

```json
{
  "mcpServers": {
    "search-console": {
      "type": "sse",
      "url": "https://mcp.yourcompany.com/search-console/sse",
      "headers": {
        "Authorization": "Bearer your-secure-shared-token"
      }
    }
  }
}
```
Once added, Claude will connect to the central server and load the GSC and GA4 tools using the shared central credentials automatically.
