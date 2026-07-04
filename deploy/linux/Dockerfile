FROM node:20-alpine AS build

WORKDIR /app

COPY server-generic/package*.json ./server-generic/
WORKDIR /app/server-generic
RUN npm ci

COPY server-generic/ ./
RUN npm run build
RUN npm prune --omit=dev

WORKDIR /app
COPY dist ./dist

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV APP_PORT=3000
ENV STATIC_DIR=/app/dist

WORKDIR /app
COPY --from=build /app/server-generic/dist ./server-generic/dist
COPY --from=build /app/server-generic/migrations ./server-generic/migrations
COPY --from=build /app/server-generic/node_modules ./server-generic/node_modules
COPY --from=build /app/server-generic/package*.json ./server-generic/
COPY --from=build /app/dist ./dist

WORKDIR /app/server-generic
EXPOSE 3000
CMD ["node", "dist/index.js"]
