FROM node:22-alpine
WORKDIR /app
COPY services/partner/server.mjs .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
