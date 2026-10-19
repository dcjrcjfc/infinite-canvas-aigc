FROM node:22-alpine
WORKDIR /app
COPY proxy-server.js ./
COPY server ./server
COPY ["无限画布/", "./无限画布/"]
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/.local
EXPOSE 8787
CMD ["node", "proxy-server.js"]
