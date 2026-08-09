FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# 种子脚本会读取仓库根目录的 src/data，因此同时复制前端数据源与服务端。
COPY src ./src
COPY server ./server

# 必须在最终源码 COPY 后安装依赖。这样宿主机残留的 node_modules
# 不会覆盖镜像内的生产依赖，且构建阶段会提前校验关键依赖。
RUN cd server && pnpm install --prod --no-frozen-lockfile \
    && node --input-type=module -e "await import('dotenv/config'); await import('mysql2/promise'); await import('sql.js'); console.log('server-dependencies-ok')"

WORKDIR /app/server
EXPOSE 3000

# 直接 docker run 与 Compose 都能获得统一的 API 存活状态；使用 Node 内置 fetch，
# 不额外引入 curl/wget 等运行时依赖。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
