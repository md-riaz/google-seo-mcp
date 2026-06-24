FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Remove development dependencies to keep the image slim
RUN npm prune --production


FROM node:20-slim

WORKDIR /app

# Copy built app and production dependencies
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Default environment variables
ENV PORT=3000
ENV BASE_PATH=""
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start server in SSE mode
ENTRYPOINT ["node", "dist/index.js", "sse"]
