# Build context: root repository.
FROM node:22.23.4-alpine AS build
RUN npm install -g pnpm@10.13.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter web...
COPY frontend frontend
RUN pnpm --filter web build

FROM nginx:1.27.5-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
