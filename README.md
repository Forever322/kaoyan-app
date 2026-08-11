# 考研择校助手 — 项目说明文档

> 版本 4.4 | 2026-08-11 | 全栈 SPA + TWA + REST API + 后台数据 Agent

本文档是项目的完整技术说明，包含架构设计、API 接口、数据库 Schema、构建流程和后续升级指南。

---

## 目录

1. [项目概览](#1-项目概览)
2. [项目结构](#2-项目结构)
3. [前端架构](#3-前端架构)
4. [后端架构](#4-后端架构)
5. [数据库设计](#5-数据库设计)
6. [API 接口文档](#6-api-接口文档)
7. [Android TWA 构建](#7-android-twa-构建)
8. [升级与扩展指南](#8-升级与扩展指南)
9. [常见问题](#9-常见问题)

---

## 1. 项目概览

**考研择校助手** 是一款面向考研学生的院校查询与分数分析工具，支持根据初试分数、学位类型、学科门类和招生分区智能匹配目标院校。

| 维度 | 技术选型 |
|------|----------|
| 前端框架 | 原生 ES Modules（无框架 SPA） |
| 构建工具 | Vite 8 |
| 包管理器 | pnpm 11 |
| CSS 方案 | 液态玻璃主题（7 模块 CSS） |
| 本地存储 | IndexedDB + localStorage |
| PWA | Service Worker + Web Manifest |
| 后端运行时 | Node.js 24 + Express 5 |
| 数据库 | MySQL 8.4（Docker 持久卷；`sql.js` 仅用于历史数据导入） |
| Android 壳 | Jetpack Compose + TWA |
| 设计工具 | Pencil (.pen) |
| 测试框架 | Vitest（42 用例） |
| 代码规范 | ESLint + Prettier |
| 后台 Agent | 口述/文件抽取 + 双重审核 + checksum 确认 + 审计告警 |

---

## 2. 项目结构

```
kaoyan-app/
├── index.html                  # Vite 入口 HTML
├── package.json                # 前端依赖与脚本
├── pnpm-workspace.yaml         # pnpm monorepo 配置
├── vite.config.js              # Vite 构建配置
├── vitest.config.js            # 测试配置
├── eslint.config.js            # ESLint 配置
│
├── public/                     # PWA 静态资源
│   ├── manifest.json           # Web App Manifest
│   ├── sw.js                   # Service Worker
│   ├── version.json            # 版本标记
│   └── icons/                  # PWA 图标
│
├── src/                        # 前端源码
│   ├── main.js                 # 入口：挂载 App + 注册 SW
│   ├── app.js                  # 核心：路由/导航/事件/筛选/详情/弹窗
│   ├── render.js               # 视图渲染引擎
│   ├── matcher.js              # 院校匹配算法
│   ├── db.js                   # IndexedDB 封装
│   ├── storage.js              # localStorage 封装
│   ├── seed.js                 # 初次启动数据种子脚本
│   ├── modal.js                # 弹窗逻辑
│   ├── detail.js               # 院校详情渲染
│   ├── photos.js               # 校园图片处理
│   ├── utils.js                # 工具函数
│   ├── style.css               # 入口样式
│   ├── assets/campus-heroes/   # 校园封面图
│   ├── assets/fonts/           # KaoyanSansSC 可变字体
│   ├── data/                   # 静态数据（7500+ 行，356KB）
│   │   ├── universities.js     # 700 所院校库
│   │   ├── uni-details.js      # 90 所院校详情
│   │   ├── uni-requirements.js # 报考要求
│   │   ├── admission-scores.js # 录取分数线
│   │   ├── national-lines.js   # 国家线
│   │   └── uni-photos.js       # 校园照片索引
│   ├── views/                  # 视图组件
│   │   ├── home-view.js        # 首页
│   │   ├── filter-view.js      # 筛选面板
│   │   ├── results-view.js     # 匹配结果
│   │   ├── detail-view.js      # 院校详情
│   │   ├── fail-view.js        # 未过国家线
│   │   ├── modal-view.js       # 弹窗
│   │   ├── footer-view.js      # 底部导航
│   │   ├── my-view.js          # 我的
│   │   └── prep-view.js        # 备考
│   └── styles/liquid-glass/    # CSS 主题
│       ├── base.css            # 全局变量/重置/卡片/动画
│       ├── home.css            # 首页
│       ├── filter.css          # 筛选面板
│       ├── results.css         # 结果 + 未过线 + 底部导航
│       ├── detail.css          # 详情页
│       ├── modal.css           # 弹窗
│       ├── my.css              # 我的页面
│       └── prep.css            # 备考
│
├── server/                     # 后端 API 服务
│   ├── package.json
│   ├── data/kaoyan.db          # 旧 sql.js 导入源（非运行数据库）
│   ├── src/
│   │   ├── index.js            # Express 入口 (端口 3000)
│   │   ├── db/
│   │   │   ├── migrations/     # 版本化 MySQL DDL
│   │   │   ├── index.js        # 异步 MySQL 连接池 / 迁移执行器
│   │   │   ├── migrate.js      # MySQL CLI 迁移
│   │   │   └── seed.js         # 从 src/data/*.js 导入参考数据
│   │   └── routes/
│   │       ├── universities.js # /api/universities
│   │       ├── national-lines.js # /api/national-lines
│   │       ├── match.js        # /api/match
│   │       └── admin-agent.js  # 数据摄取、审核、确认、日志与告警
│   ├── scripts/                # 后端运维脚本
│   └── analyze-data.mjs        # 数据分析辅助脚本
│
├── android-twa/                # Android TWA 壳
│   ├── build.gradle.kts        # AGP 8.10.1
│   ├── gradle.properties
│   ├── app/build.gradle.kts    # TWA + Compose
│   └── ...
│
├── designs/pencil/             # Pencil UI 设计稿
│   └── pencil-new.pen
│
├── tools/data-maintenance/      # 静态数据维护工具
│   ├── collect.cjs              # 采集真实分数到 real-scores.json
│   ├── apply.cjs                # 将 real-scores.json 应用到 admission-scores.js
│   ├── convert.cjs              # 按院校白名单重生成 admission-scores.js
│   ├── province-schools.json    # 研招网院校白名单
│   └── real-scores.json         # 采集的真实录取分数数据
│
├── docs/                        # 运维、Agent、后台 API 文档
│   └── archive/README.legacy.md # 旧版说明备份
│
└── dist/                        # Vite 构建输出（不提交）
```

---

## 3. 前端架构

### 3.1 SPA 路由（7 个屏幕）

| screen | 视图 | 说明 |
|--------|------|------|
| `homeScreen` | 首页 | 择校画像 + 匹配按钮 + 推荐院校 |
| `filterScreen` | 筛选 | 分数/学位/学科/分区/培养方式 |
| `resultsScreen` | 匹配结果 | 稳过/大概率/冲刺 三级分布 + 院校列表 |
| `detailScreen` | 院校详情 | 封面/录取表格/复试线/档案/优缺点 |
| `failScreen` | 未过线 | A/B 区对比 + 调整建议 |
| `prepScreen` | 备考 | 倒计时/今日任务/学习数据 |
| `profileScreen` | 我的 | 统计指标/快捷入口 |

底部导航: `[为你推荐] [院校库] [备考] [我的]`

### 3.2 数据流

```
src/data/*.js (静态 JS)
  → 首次启动: seed.js → IndexedDB
  → 运行时: matcher.js 计算匹配（国家线 + 分区 + 学位 + 学科）
  → 分级: 稳过 / 大概率 / 冲刺 / 差距较大
```

### 3.3 样式加载顺序

```
base.css → home.css → filter.css → results.css → detail.css → modal.css → my.css → prep.css
```

---

## 4. 后端架构

### 4.1 启动命令

```bash
cd server
pnpm install
pnpm db:migrate          # 运行版本化 MySQL 迁移
pnpm db:seed             # 从 src/data/*.js 导入参考数据
pnpm dev                 # 开发模式 → http://localhost:3000
pnpm start               # 生产模式
```

### 4.2 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `express` | ^5.0 | HTTP 框架 |
| `cors` | ^2.8 | 跨域 |
| `mysql2` | ^3 | MySQL 连接池、参数化查询和事务 |
| `sql.js` | ^1.14 | 仅用于将旧 SQLite/sql.js 数据一次性导入 MySQL |

### 4.3 数据库接口

```js
import { getDB } from './db/index.js';
const db = await getDB();
const rows = await db.all('SELECT * FROM universities WHERE zone = ?', ['A']);
```

运行 API 前需要可连接的 MySQL；Docker 环境由 `docker-compose.backend.yml` 提供 `mysql` 服务。生产发布时保持 `RUN_MIGRATIONS_ON_START=false`，先运行一次性 `api-migrate` 再启动或更新 API。

后台 `/admin/` 的数据库管理 Agent 支持浏览器口述转写和 CSV/TXT/JSON/SQL/XLSX/DB 导入。输入会先转成暂存任务，经过确定性规则与模型语义审核；模型没有写库权限，只有超级管理员确认未变化的 checksum 后，服务端才会事务写入并生成来源、变更、访问和告警记录。完整契约见 `docs/admin-api.md`。

---

## 5. 数据库设计

### 5.1 表结构（版本化 MySQL migration）

下图仅展示院校参考数据主关系；用户、认证、学习、计划、Agent 审计与后续扩展表以 `server/src/db/migrations/` 为准。

```
universities ──1:1──→ uni_details
     │
     ├──1:N──→ uni_photos (filename, label)
     ├──1:N──→ admission_scores (year, degree, category, score)
     └──1:N──→ uni_requirements (degree, category, requirement)

national_lines (year, degree, category, zone, score)
```

### 5.2 数据统计

| 表 | 行数 | 说明 |
|----|------|------|
| universities | 700 | 全国 A/B 区 |
| national_lines | 330 | 2022-2026 学硕/专硕全学科 |
| uni_details | 90 | 含优缺点 |
| uni_photos | 160 | 校园实景索引 |

---

## 6. API 接口文档

### 6.1 已实现

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/universities?zone=A&keyword=清华` | 院校查询 |
| `GET` | `/api/universities/:id` | 院校详情 |
| `POST` | `/api/universities` | 新增院校 |
| `GET` | `/api/national-lines?year=2026&degree=学硕` | 国家线 |
| `POST` | `/api/national-lines` | 录入国家线 |
| `GET` | `/api/match?score=378&degree=学硕&category=工学&zone=A` | 智能匹配 |

匹配算法: 用户分数 vs 近 4 年院线均值 → 稳过 / 大概率过 / 冲刺 / 差距较大

### 6.2 预留（升级时实现）

| 方法 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| `POST` | `/api/auth/login` | 登录 | 高 |
| `POST` | `/api/auth/register` | 注册 | 高 |
| `GET/POST` | `/api/favorites` | 收藏 | 中 |
| `GET` | `/api/compare` | 多校对比 | 中 |
| `POST` | `/api/alerts` | 分数线订阅 | 低 |

---

## 7. Android TWA 构建

| 组件 | 版本 |
|------|------|
| AGP | 8.10.1 |
| Kotlin | 2.2.0 |
| Compose | BOM 2024.12.01 |
| compileSdk | 36 |
| minSdk | 24 |

```bash
cd android-twa
gradlew.bat --no-daemon assembleDebug assembleRelease
# APK → app/build/outputs/apk/debug|release/
```

---

## 8. 升级与扩展指南

### 8.1 前端接入后端 API

```js
// API 优先，失败 fallback 静态数据
const res = await fetch('/api/universities').catch(() => null);
const data = res ? (await res.json()).data
  : (await import('./data/universities.js')).UNIVERSITIES;
```

### 8.2 数据库操作

```bash
cd server
pnpm db:migrate     # 追加式 MySQL migration（保留数据）
pnpm db:seed        # 受控更新参考数据
# 仅开发空库：ALLOW_DB_RESET=true pnpm db:reset
```

新增表/字段：新增 migration 文件，不能改写已部署 migration；生产前先备份并通过 `api-migrate` 串行执行。旧 `sql.js` 数据导入使用 `pnpm db:import:mysql -- --source /path/to/kaoyan.db` 预览，确认后才追加 `--apply`，随后运行一次 `pnpm db:seed` 补齐新参考字段。

### 8.3 添加新页面

1. `src/views/new-view.js` — HTML 生成函数
2. `src/styles/liquid-glass/new.css` — 样式
3. `src/style.css` — `@import`
4. `src/app.js` — 注册 screen + 导航

### 8.4 扩展路线图

| 功能 | 技术方案 | 优先级 |
|------|----------|--------|
| 用户系统 | JWT + `user` 表 | 高 |
| 收藏同步 | `user_favorites` 表 + REST | 中 |
| 实时推送 | WebSocket 分数线变动 | 中 |
| 全文搜索 | MySQL FULLTEXT / 专用搜索服务 | 中 |
| Docker | Dockerfile + compose | 低 |
| CI/CD | GitHub Actions | 低 |

---

## 9. 常见问题

### Agent 前端接入

Agent 前端请求、提案确认与开发期身份说明见 [Agent 前端接入文档](docs/agent-frontend-integration.md)。

部署、模型配置、后续 Agent 功能、工具调用和安全约束见 [Agent 开发与部署手册](docs/agent-development-and-deployment.md)。

**Q: 如何启动前端开发？**
```bash
pnpm dev          # http://localhost:5173
pnpm build        # 生产构建 → dist/
```

**Q: 如何运行测试？**
```bash
pnpm test         # 42 用例
```

**Q: 如何部署？**
```bash
pnpm build                    # 前端
# 后端请按 docs/backend-docker-deployment.md 使用 Docker + MySQL 部署
# Nginx: /api/* → 127.0.0.1:3000, /* → dist/
```

---

> **维护者**: AI Assistant | **更新**: 2026-08-11 | **版本**: 前端 v4.4 / 后端 v1.1 / TWA v4.3
