FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/pwa/package.json apps/pwa/
RUN npm install --workspace=@samur/pwa --workspace=@samur/shared

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/pwa/ apps/pwa/

RUN npm run build -w packages/shared && \
    npm run build -w apps/pwa

# Serve with nginx
FROM nginx:1.27-alpine
COPY --from=build /app/apps/pwa/dist /usr/share/nginx/html
COPY apps/pwa/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
