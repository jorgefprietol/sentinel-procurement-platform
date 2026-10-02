FROM node:22-alpine
# This service uses Node built-ins only; package managers are unnecessary at runtime.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY services/partner/server.mjs .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
