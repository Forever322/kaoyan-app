# 院校库数据治理与扩展模型

本项目的院校库不再把“学校、一条分数、一个要求”视为同一层级的数据。MySQL 中保留既有 `universities`、`uni_details`、`admission_scores` 等表以兼容当前 App，并在 `003-university-catalog-governance` 迁移后增加可按**院校 → 学院 → 专业 → 招生年度**维护的规范化资料层。

## 资料层级

| 层级 | 表 | 用途 |
| --- | --- | --- |
| 院校身份 | `universities`、`university_aliases` | 规范名称、历史名/简称、地区、层次、办学类型。别名不能自动覆盖同名或有歧义的院校。 |
| 校区与学院 | `campuses`、`academic_units` | 校区地址、学院/研究院、联系方式和所属关系。 |
| 专业目录 | `programs` | 专业代码、名称、学位类别、学科门类、研究方向、学习方式和状态。 |
| 年度招生 | `program_offerings` | 某专业某年的招生方式、计划人数、推免、学制、学费、说明。 |
| 初复试规则 | `exam_subjects`、`retest_rules` | 初试科目、参考书、复试形式、权重、同等学力和调剂规则。 |
| 成绩与统计 | `score_lines`、`admission_statistics` | 国家/院校/专业分数线、单科线、报考/录取/推免人数、分数区间。 |
| 可追溯性 | `source_documents`、`data_import_batches`、`catalog_change_log`、`catalog_data_issues` | 原文 URL、发布日期、抓取/导入批次、校验状态、变更记录和待处理问题。 |

## 必须遵守的数据规则

- 招生、分数、复试规则必须至少标记**适用年份、资料来源、抓取/导入时间和核验状态**；没有这些信息的记录不能作为“当年官方结论”展示。
- 一个专业可有多个方向、多个校区和多个年度招生计划；不得把学校级概览写成某专业的招生规则。
- `university_aliases` 仅用于人工审核后的名称映射。`中国地质大学`、`中国石油大学`这类可能指向多个实体的名称必须进入 `catalog_data_issues`，不能猜测绑定。
- 图片要登记来源、版权/授权状态、CDN 地址及失效检查结果；无授权或失效来源不应继续对外展示。
- 任何爬取、人工录入和批量导入都要创建 `data_import_batches`，并关联 `source_documents`。变更由 `catalog_change_log` 记录，方便回溯和回滚。
- 未经核验的资料可保存为草稿/待核验，但前端与 AI 必须明确标识“待核验”；AI 不得把它们包装成实时招生政策。

## 当前数据质量基线

运行以下命令可从版本化静态资料生成报告：

```bash
pnpm --dir server db:audit:catalog
```

当前基线为 700 所院校；录取分数、详情、图片和报考要求覆盖率并不相同。严格模式会因无法关联主表的记录失败，适合作为资料入库前的 CI 门禁：

```bash
pnpm --dir server db:audit:catalog -- --strict
```

严格模式当前会指出待治理的别名及主表缺失院校。先通过人工核验补齐主表或建立明确别名，再允许导入；不要为了让命令通过而随意映射学校。

## 新资料的导入流程

1. 保存招生简章、专业目录或复试细则的原始 URL/PDF 元数据到 `source_documents`。
2. 创建一次 `data_import_batches`，记录来源、操作者、抓取时间和版本。
3. 先写入院校/学院/专业，再写入年度招生、科目、分数线和统计数据。
4. 对唯一键、年份、专业代码、人数、分数范围和来源状态做校验；不能解析或存在歧义的内容写入 `catalog_data_issues`。
5. 由人工将资料标记为已核验后才允许其成为 App 和 AI 的事实参考。
6. 运行资料审计、接口测试后发布。生产库升级只运行迁移，不要在没有备份的情况下清空数据。

## 查询接口

新增的只读专业接口为：

```text
GET /api/programs?universityId=&year=&degree=&category=&keyword=&page=&pageSize=
GET /api/programs/:id
GET /api/programs/:id/offerings?year=&status=&page=&pageSize=
```

它们与现有 `/api/universities` 并存，避免破坏已发布客户端。涉及用户计划的 AI 服务只能由后端按当前用户、已核验来源和有限条数读取资料；模型没有 MySQL 凭据、SQL 工具或直接写库权限。

## 发布迁移

生产环境构建并切换新 API 镜像后，在重建 API 前执行一次：

```bash
cd /opt/kaoyan-app
docker compose -f docker-compose.backend.yml --profile tools run --rm api-migrate
```

该迁移只新增字段和表，不会删除现有院校、用户、收藏、学习记录或 Agent 数据。新规范化表初始为空是正常状态；只有导入经过来源和核验流程的官方资料后，它们才会产生可对外使用的数据。
