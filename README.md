# 考研择校助手 — 项目说明文档

> 版本 4.3 | 2026-08-08 | 全栈 SPA + TWA + REST API

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
| 数据库 | SQLite（sql.js WASM） |
| Android 壳 | Jetpack Compose + TWA |
| 设计工具 | Pencil (.pen) |
| 测试框架 | Vitest（42 用例） |
| 代码规范 | ESLint + Prettier |

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
│   ├── data/kaoyan.db          # SQLite 数据库
│   ├── src/
│   │   ├── index.js            # Express 入口 (端口 3000)
│   │   ├── db/
│   │   │   ├── schema.sql      # DDL（6 张表）
│   │   │   ├── index.js        # getDB() / migrate() / reset()
│   │   │   ├── migrate.js      # CLI 迁移
│   │   │   └── seed.js         # 从 src/data/*.js 导入
│   │   └── routes/
│   │       ├── universities.js # /api/universities
│   │       ├── national-lines.js # /api/national-lines
│   │       └── match.js        # /api/match
│   └── check-db.cjs           # 数据库校验
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
├── dist/                       # Vite 构建输出
├── apply.cjs / collect.cjs / convert.cjs  # 数据维护脚本
└── province-schools.json / real-scores.json
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
pnpm db:migrate          # 建表
pnpm db:seed             # 从 src/data/*.js 导入数据
pnpm dev                 # 开发模式 → http://localhost:3000
pnpm start               # 生产模式
```

### 4.2 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `express` | ^5.0 | HTTP 框架 |
| `cors` | ^2.8 | 跨域 |
| `sql.js` | ^1.14 | SQLite WASM（纯 JS，无原生编译） |

### 4.3 数据库接口

```js
import { getDB } from './db/index.js';
const db = await getDB();
const stmt = db.prepare('SELECT * FROM universities WHERE zone = ?');
stmt.bind(['A']);
while (stmt.step()) { const row = stmt.getAsObject(); }
stmt.free();
```

---

## 5. 数据库设计

### 5.1 表结构（6 张表）

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
pnpm db:migrate     # 增量迁移（保留数据）
pnpm db:reset       # 完全重建（⚠️ 清除所有数据）
```

新增表/字段: 编辑 `schema.sql` → `pnpm db:migrate`

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
| 全文搜索 | SQLite FTS5 | 中 |
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
cd server && pnpm start       # 后端 (端口 3000)
# Nginx: /api/* → 3000, /* → dist/
```

---

> **维护者**: AI Assistant | **更新**: 2026-08-08 | **版本**: 前端 v4.3 / 后端 v1.0 / TWA v4.3
