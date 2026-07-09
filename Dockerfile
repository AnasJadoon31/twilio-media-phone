FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable pnpm

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml* ./
RUN pnpm i --frozen-lockfile

# Generate Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN pnpm prisma generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js telemetry is disabled
ENV NEXT_TELEMETRY_DISABLED 1
ARG NEXT_PUBLIC_VOICE_AGENT_URL=https://voice-agent.anas31.qzz.io
ARG NEXT_PUBLIC_AI_CORE_URL=https://api.operaios.qzz.io
ENV NEXT_PUBLIC_VOICE_AGENT_URL=$NEXT_PUBLIC_VOICE_AGENT_URL
ENV NEXT_PUBLIC_AI_CORE_URL=$NEXT_PUBLIC_AI_CORE_URL

# Generate Prisma client again in builder just in case
RUN pnpm prisma generate

RUN pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Next.js telemetry is disabled
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output and public files
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Install production dependencies so Prisma CLI is available for startup schema sync.
RUN pnpm install --prod --frozen-lockfile && chown -R nextjs:nodejs node_modules

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

# Copy prisma schema/config and startup entrypoint.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs --chmod=755 /app/docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs

CMD ["/app/docker-entrypoint.sh"]
