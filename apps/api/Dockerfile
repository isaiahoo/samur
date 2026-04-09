FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm install --workspace=@samur/api --workspace=@samur/db --workspace=@samur/shared

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/db/ packages/db/
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# Generate Prisma client
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# Build packages in order
RUN npm run build -w packages/db && \
    npm run build -w packages/shared && \
    npm run build -w apps/api

# Production stage
FROM node:20-alpine
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/db/dist ./packages/db/dist
COPY --from=base /app/packages/db/package.json ./packages/db/
COPY --from=base /app/packages/db/prisma ./packages/db/prisma
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/api/package.json ./apps/api/
COPY --from=base /app/package.json ./

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
