FROM node:20-alpine

# sharp needs vips, better-sqlite3 needs build tools
RUN apk add --no-cache vips-dev python3 make g++ ffmpeg fontconfig ttf-dejavu

WORKDIR /app
COPY app/package.json ./
RUN npm install --production
COPY app/ .
RUN if [ -f web/package.json ]; then cd web && npm ci && npm run build; fi

RUN mkdir -p /data/incoming /data/posted /data/incoming_video /data/posted_video /data/game_images /data/team

ENV PORT=3000 NODE_ENV=production DATA_DIR=/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/status || exit 1

CMD ["node", "src/server.js"]
