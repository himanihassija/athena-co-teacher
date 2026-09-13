# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9

# Copy root workspace configs and manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/orchestrator/package.json ./apps/orchestrator/

# Install dependencies for workspace
RUN pnpm install --frozen-lockfile

# Copy shared source and orchestrator source
COPY packages/shared-types ./packages/shared-types
COPY apps/orchestrator ./apps/orchestrator

# Set production environment
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

EXPOSE 8787

WORKDIR /app/apps/orchestrator
CMD ["node", "--import", "tsx", "src/server.ts"]
