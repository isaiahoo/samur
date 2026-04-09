FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/telegram/package.json apps/telegram/
RUN npm install --workspace=@samur/telegram --workspace=@samur/shared

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/telegram/ apps/telegram/

RUN npm run build -w packages/shared && \
    npm run build -w apps/telegram

# Production stage
FROM node:20-alpine
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/apps/telegram/dist ./apps/telegram/dist
COPY --from=base /app/apps/telegram/package.json ./apps/telegram/
COPY --from=base /app/package.json ./

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

CMD ["node", "apps/telegram/dist/index.js"]
