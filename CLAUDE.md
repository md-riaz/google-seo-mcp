# CLAUDE.md

Guidelines and commands for developing, building, and running the Search Console MCP server.

For comprehensive architectural patterns and guidelines on co-hosting multiple MCP servers on a single VPS, see [@AGENTS.md](AGENTS.md).

## 🛠️ Build and Development Commands

- **Build Project**: `npm run build`
- **Lint / Type Check**: `npx tsc --noEmit`
- **Start Local (STDIO)**: `node dist/index.js`
- **Start Local (SSE mode)**: `PORT=3000 BASE_PATH=/search-console node dist/index.js sse`
- **Interactive Setup Wizard**: `node dist/index.js setup`
- **Run Unit Tests**: `npm run test`

## 📐 Project Conventions

- **VPS Co-Hosting**: This service is designed to run alongside other MCP servers on a shared server.
- **Port Selection**: Typically uses port `3000` (can be overridden with `PORT` env var).
- **Routing**: Use the `BASE_PATH` env var (e.g. `/search-console`) to map the service to its reverse proxy subpath.
- **Security**: Configure and validate `MCP_API_KEY` for secure connections.
