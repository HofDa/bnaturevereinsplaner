FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile --production
FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY --from=dependencies --chown=bun:bun /app /app
COPY --chown=bun:bun apps/api apps/api
COPY --chown=bun:bun packages packages
# Mount point for the private document volume; owned by the unprivileged runtime user.
RUN mkdir -p /var/lib/bnature/documents && chown bun:bun /var/lib/bnature/documents
USER bun
EXPOSE 3000
CMD ["bun", "apps/api/src/server.ts"]
