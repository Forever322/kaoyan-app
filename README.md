# 🎓 考研择校助手

> 输入考研总分，智能匹配最适合的院校。支持学硕/专硕、A/B区、多学科门类，覆盖全国 700+ 所高校。

## ✨ 功能特性

### 🎯 智能择校匹配
- 根据总分、学位类型（学硕/专硕）、学科门类、专业方向、招生分区自动匹配院校
- 四级判定：**✅ 稳过** / **👍 大概率** / **🎯 冲刺** / **⚠️ 差距较大**
- 结果按匹配度 → 院校层次（985 > 211 > 双一流 > 双非）智能排序

### 📊 多维数据参考
- **国家线**：2022—2025 年完整数据，14 个学硕门类 + 30 个专硕类别，A/B 区全覆盖
- **录取分数线**：50+ 所头部高校各专业历年录取线（清华/北大/北航/北邮等）
- **院校详情**：优缺点分析、学科特色、校园地址、实景照片
- **历年对比表**：一张表对比四年国家线 vs 院校线 vs 你的分数

### 🔍 全局院校搜索
- 顶部搜索栏支持院校名称、省份实时模糊匹配
- 点击即可查看该校详情和历年录取数据

### 📱 原生应用体验
- **PWA 支持**：可安装到桌面，离线使用
- **开屏动画**：CSS Animation 驱动，启动即展示
- **数据持久化**：搜索条件自动保存，下次打开恢复上次状态

### 🔧 数据管理
- 支持添加/编辑/删除自定义院校数据
- 一键导出所有数据为 JSON 文件
- 导入自定义数据扩展院校库

## 📐 技术架构

```
前端 (Vite 8 + ES Modules)
├── index.html              # Vite 入口 HTML
├── src/
│   ├── main.js             # Vite 入口 JS
│   ├── style.css           # Mobile-first 响应式样式
│   ├── app.js              # 主逻辑（UI 初始化 / 事件绑定 / 导航管理）
│   ├── render.js           # 渲染模块（国家线 / 搜索结果 / 分数表格）
│   ├── detail.js           # 详情页模块
│   ├── modal.js            # 弹窗编辑模块（自定义院校管理）
│   ├── photos.js           # 校园实景照片模块
│   ├── matcher.js          # 匹配引擎（分数评估 + 排序）
│   ├── utils.js            # 工具函数（DOM 操作 / XSS 防护）
│   ├── storage.js          # localStorage 存储管理
│   ├── matcher.test.js     # Vitest 单元测试
│   └── data/
│       ├── universities.js       # 院校数据库（700+ 所）
│       ├── national-lines.js     # 国家线（2022-2025）
│       ├── admission-scores.js   # 录取分数线
│       ├── uni-details.js        # 院校详情（优缺点/特色）
│       └── uni-photos.js         # 院校照片 CDN
├── public/
│   ├── sw.js               # Service Worker（离线缓存）
│   ├── manifest.json       # PWA 清单
│   ├── icons/              # PWA 图标
│   └── splash.png          # 开屏图片
├── dist/                   # 构建输出
├── vite.config.js          # Vite 配置
├── vitest.config.js        # Vitest 测试配置
├── eslint.config.js        # ESLint 配置
├── .prettierrc             # Prettier 配置
└── android-twa/            # Android TWA 壳工程
```

**技术栈**：Vite 8 + ES Modules + ESLint + Prettier + Vitest，模块化架构，支持 Tree-shaking。

## 🚀 快速开始

### 环境要求

- Node.js 24+
- pnpm 11+

### 方式一：开发模式（推荐）

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 访问 http://localhost:5173
```

### 方式二：构建生产版本

```bash
# 构建优化后的生产版本
pnpm build

# 预览构建结果
pnpm preview

# 构建产物在 dist/ 目录
```

### 方式三：PWA 安装

1. 使用浏览器（Chrome/Edge/Safari）访问已部署的页面
2. 浏览器会提示「安装应用」，点击安装
3. 或在菜单中选择「添加到主屏幕」
4. 安装后可离线使用

### 方式四：Android APK

```bash
# 前置条件：Android SDK + JDK 17+
cd android-twa
./gradlew assembleDebug

# APK 输出路径
# android-twa/app/build/outputs/apk/debug/
```

### 代码检查与测试

```bash
# ESLint 检查
pnpm lint

# ESLint 自动修复
pnpm lint:fix

# Prettier 格式化
pnpm format

# 运行单元测试
pnpm test

# 监听模式测试
pnpm test:watch
```

## 📋 匹配算法

```
用户分数 ≥ 最高录取分 + 10  →  ✅ 稳过
用户分数 ≥ 最高录取分       →  👍 大概率
用户分数 ≥ 最低录取分       →  🎯 冲刺
用户分数 < 最低录取分       →  ⚠️ 差距较大
无录取数据                  →  📋 无数据（仅参考国家线）
```

匹配基于近 4 年（2022—2025）录取数据的最高分/最低分/平均分，提供客观参考。

## 📂 项目结构

| 文件/目录 | 说明 |
|---|---|
| `index.html` | Vite 入口 HTML |
| `src/main.js` | Vite 入口 JS |
| `src/style.css` | Mobile-first 响应式样式 |
| `src/app.js` | 主逻辑（UI 初始化 / 事件绑定 / 导航管理） |
| `src/render.js` | 渲染模块（国家线 / 搜索结果 / 分数表格） |
| `src/detail.js` | 详情页模块 |
| `src/modal.js` | 弹窗编辑模块（自定义院校管理） |
| `src/photos.js` | 校园实景照片模块 |
| `src/matcher.js` | 匹配引擎（分数评估 + 排序） |
| `src/utils.js` | 工具函数（DOM 操作 / XSS 防护） |
| `src/storage.js` | 本地存储管理 |
| `src/matcher.test.js` | Vitest 单元测试（18 个用例） |
| `src/data/universities.js` | 全国院校数据库（700+ 所） |
| `src/data/national-lines.js` | 国家线数据（14 门类 × 4 年） |
| `src/data/admission-scores.js` | 录取分数线（50+ 所高校） |
| `src/data/uni-details.js` | 院校详情（优缺点/特色） |
| `src/data/uni-photos.js` | 院校照片（百度百科 CDN） |
| `public/sw.js` | Service Worker 离线缓存 |
| `public/manifest.json` | PWA 清单配置 |
| `vite.config.js` | Vite 构建配置 |
| `vitest.config.js` | Vitest 测试配置 |
| `eslint.config.js` | ESLint 代码检查规则 |
| `.prettierrc` | Prettier 代码格式化配置 |
| `android-twa/` | Android TWA 壳工程 |

## 🌐 分区说明

### A 区（21 省/市）
北京、天津、河北、山西、辽宁、吉林、黑龙江、上海、江苏、浙江、安徽、福建、江西、山东、河南、湖北、湖南、广东、重庆、四川、陕西

### B 区（10 省/区）
内蒙古、广西、海南、贵州、云南、西藏、甘肃、青海、宁夏、新疆

> 💡 B 区国家线通常比 A 区低 10 分左右，分数不理想的考生可重点关注。

## 🔧 数据来源

- **院校信息**：[中国研究生招生信息网](https://yz.chsi.com.cn)
- **国家线**：教育部历年公布的全国硕士研究生招生考试考生进入复试的初试成绩基本要求
- **录取分数线**：各校研究生院官网历年公示数据
- **院校照片**：百度百科 CDN

## �️ 开发指南

### 常用命令

```bash
pnpm dev             # 启动开发服务器（热更新）
pnpm build           # 构建生产版本
pnpm preview         # 预览生产构建
pnpm lint            # 代码检查
pnpm format          # 代码格式化
pnpm test            # 运行单元测试
```

### 模块依赖关系

```
main.js
  └── style.css
  └── app.js
        ├── render.js
        │     └── data/admission-scores.js
        │     └── data/national-lines.js
        │     └── utils.js
        ├── modal.js
        │     └── storage.js
        │     └── utils.js
        ├── detail.js
        │     └── render.js
        │     └── photos.js
        │     └── data/uni-details.js
        │     └── data/admission-scores.js
        │     └── utils.js
        ├── matcher.js
        │     └── data/national-lines.js
        │     └── data/universities.js
        │     └── data/admission-scores.js
        ├── storage.js
        ├── photos.js
        │     └── utils.js
        ├── utils.js
        └── data/
              ├── national-lines.js
              ├── universities.js
              ├── admission-scores.js
              ├── uni-details.js
              └── uni-photos.js
```

### 添加新院校

1. 在 `src/data/universities.js` 的 `UNIVERSITIES` 数组中添加院校对象
2. 在 `src/data/admission-scores.js` 的 `ADMISSION_SCORES` 中添加录取分数线（可选）
3. 在 `src/data/uni-details.js` 的 `UNI_DETAILS` 中添加院校详情（可选）
4. 在 `src/data/uni-photos.js` 的 `UNI_PHOTOS` 中添加照片链接（可选）

### 添加新年份国家线

在 `src/data/national-lines.js` 的 `NATIONAL_LINES` 对象中，为每个门类添加新年份的分数。

### 构建产物

```
dist/
├── index.html                    # 入口 HTML
├── assets/
│   ├── index-[hash].css         # CSS（自动注入）
│   ├── index-[hash].js          # 主 JS（24KB gzip 8KB）
│   └── data-[hash].js           # 数据模块（149KB gzip 33KB）
├── icons/                        # PWA 图标
├── manifest.json                 # PWA 清单
└── sw.js                         # Service Worker
```

> 💡 数据模块自动分包，支持长期缓存。更新数据后哈希值会自动变化。

## �📄 License

MIT
