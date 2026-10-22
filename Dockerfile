FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @schlor/editor build

WORKDIR /app/apps/editor
ENV NODE_ENV=production
ENV PORT=3000
# The editor looks at pages with this Chromium. A BROWSER_URL (a Chromium in another container) takes its place.
ENV BROWSER_PATH=/usr/bin/chromium
ENV BROWSER_NO_SANDBOX=1
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
