FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY server/package.json ./server/package.json
RUN cd server && pnpm install --prod --no-frozen-lockfile

# 种子脚本会读取仓库根目录的 src/data，因此同时复制前端数据源与服务端。
COPY src ./src
COPY server ./server

WORKDIR /app/server
EXPOSE 3000

CMD ["node", "src/index.js"]
