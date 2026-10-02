FROM node:22-alpine AS build
WORKDIR /src
COPY apps/web/package*.json .
RUN npm ci
COPY apps/web/ .
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.30.5-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY docs/openapi.yaml /usr/share/nginx/html/openapi.yaml
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
