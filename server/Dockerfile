FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# 先使用工作区锁文件安装可复现的后端生产依赖；源码变化不会让依赖层失效。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
RUN pnpm install --filter kaoyan-server --prod --frozen-lockfile \
    && cd server \
    && node --input-type=module -e "await import('dotenv/config'); await import('mysql2/promise'); await import('sql.js'); await import('xlsx'); console.log('server-dependencies-ok')"

# 种子脚本会读取仓库根目录的 src/data，因此同时复制前端数据源与服务端。
COPY src ./src
COPY server ./server

WORKDIR /app/server
EXPOSE 3000

# 直接 docker run 与 Compose 都能获得统一的 API 存活状态；使用 Node 内置 fetch，
# 不额外引入 curl/wget 等运行时依赖。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
