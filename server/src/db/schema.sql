-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 考研择校助手 数据库 Schema
-- 引擎: SQLite (sql.js WASM)
-- 表前缀说明:
--   [核心]   = 必须，与前端 src/data/*.js 对齐
--   [预留]   = 后期扩展接口，建表但不导入数据
-- ============================================================

-- ======================== [核心] 院校主表 ========================
CREATE TABLE
IF NOT EXISTS universities
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  province      TEXT    NOT NULL,
  city          TEXT    NOT NULL DEFAULT '',
  zone          TEXT    NOT NULL CHECK
(zone IN
('A', 'B')),
  level         TEXT    NOT NULL CHECK
(level IN
('985', '211', '双一流', '双非')),
  type          TEXT    NOT NULL DEFAULT '综合',
  created_at    TEXT    NOT NULL DEFAULT
(datetime
('now')),
  updated_at    TEXT    NOT NULL DEFAULT
(datetime
('now'))
);
CREATE INDEX
IF NOT EXISTS idx_uni_zone     ON universities
(zone);
CREATE INDEX
IF NOT EXISTS idx_uni_province ON universities
(province);
CREATE INDEX
IF NOT EXISTS idx_uni_level    ON universities
(level);
CREATE INDEX
IF NOT EXISTS idx_uni_type     ON universities
(type);

-- ======================== [核心] 院校详情 ========================
CREATE TABLE
IF NOT EXISTS uni_details
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id  INTEGER NOT NULL UNIQUE REFERENCES universities
(id) ON
DELETE CASCADE,
  english_name   TEXT    NOT NULL DEFAULT '',
  description    TEXT    NOT NULL DEFAULT '',
  address        TEXT    NOT NULL DEFAULT '',
  website        TEXT
NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  ranking        TEXT    NOT NULL DEFAULT '',
  advantages     TEXT    NOT NULL DEFAULT '',
  disadvantages  TEXT    NOT NULL DEFAULT ''
);

-- ======================== [核心] 院校照片 ========================
CREATE TABLE
IF NOT EXISTS uni_photos
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id  INTEGER NOT NULL REFERENCES universities
(id) ON
DELETE CASCADE,
  filename       TEXT
NOT NULL,
  label          TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX
IF NOT EXISTS idx_photo_uni ON uni_photos
(university_id);

-- ======================== [核心] 国家线 ========================
CREATE TABLE
IF NOT EXISTS national_lines
(
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  year     INTEGER NOT NULL,
  degree   TEXT    NOT NULL CHECK
(degree IN
('学硕', '专硕')),
  category TEXT    NOT NULL,
  zone     TEXT    NOT NULL CHECK
(zone IN
('A', 'B')),
  score    INTEGER NOT NULL,
  UNIQUE
(year, degree, category, zone)
);
CREATE INDEX
IF NOT EXISTS idx_nl_year  ON national_lines
(year);
CREATE INDEX
IF NOT EXISTS idx_nl_deg   ON national_lines
(degree);
CREATE INDEX
IF NOT EXISTS idx_nl_cat   ON national_lines
(category);

-- ======================== [核心] 院校录取分数线 ========================
CREATE TABLE
IF NOT EXISTS admission_scores
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id  INTEGER NOT NULL REFERENCES universities
(id) ON
DELETE CASCADE,
  year           INTEGER
NOT NULL,
  degree         TEXT    NOT NULL,
  category       TEXT    NOT NULL DEFAULT '',
  score          INTEGER NOT NULL,
  UNIQUE
(university_id, year, degree, category)
);
CREATE INDEX
IF NOT EXISTS idx_as_uni  ON admission_scores
(university_id);
CREATE INDEX
IF NOT EXISTS idx_as_year ON admission_scores
(year);

-- ======================== [核心] 院校报考要求 ========================
CREATE TABLE
IF NOT EXISTS uni_requirements
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id  INTEGER NOT NULL REFERENCES universities
(id) ON
DELETE CASCADE,
  degree         TEXT
NOT NULL DEFAULT '',
  category       TEXT    NOT NULL DEFAULT '',
  requirement    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX
IF NOT EXISTS idx_req_uni ON uni_requirements
(university_id);

-- ================================================================
-- 以下为 [预留] 扩展表 — 后期升级时取消注释并运行 db:migrate 即可
-- ================================================================

-- [预留] 用户表
-- CREATE TABLE IF NOT EXISTS users (
--   id            INTEGER PRIMARY KEY AUTOINCREMENT,
--   username      TEXT    NOT NULL UNIQUE,
--   password_hash TEXT    NOT NULL,
--   email         TEXT    DEFAULT '',
--   avatar_url    TEXT    DEFAULT '',
--   created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
--   updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
-- );

-- [预留] 用户收藏
-- CREATE TABLE IF NOT EXISTS user_favorites (
--   id             INTEGER PRIMARY KEY AUTOINCREMENT,
--   user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   university_id  INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
--   created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
--   UNIQUE(user_id, university_id)
-- );

-- [预留] 用户搜索历史
-- CREATE TABLE IF NOT EXISTS search_history (
--   id             INTEGER PRIMARY KEY AUTOINCREMENT,
--   user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
--   query          TEXT    NOT NULL DEFAULT '',
--   filters_json   TEXT    NOT NULL DEFAULT '{}',
--   result_count   INTEGER DEFAULT 0,
--   created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
-- );

-- [预留] 分数线变动日志（用于推送订阅）
-- CREATE TABLE IF NOT EXISTS score_changes (
--   id             INTEGER PRIMARY KEY AUTOINCREMENT,
--   university_id  INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
--   year           INTEGER NOT NULL,
--   degree         TEXT    NOT NULL,
--   category       TEXT    NOT NULL,
--   old_score      INTEGER,
--   new_score      INTEGER NOT NULL,
--   changed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
-- );

-- [预留] API 访问日志
-- CREATE TABLE IF NOT EXISTS api_logs (
--   id         INTEGER PRIMARY KEY AUTOINCREMENT,
--   method     TEXT    NOT NULL,
--   path       TEXT    NOT NULL,
--   status     INTEGER NOT NULL,
--   duration_ms INTEGER DEFAULT 0,
--   ip         TEXT    DEFAULT '',
--   created_at TEXT    NOT NULL DEFAULT (datetime('now'))
-- );

-- [预留] 系统配置（键值对）
-- CREATE TABLE IF NOT EXISTS system_config (
--   key         TEXT PRIMARY KEY,
--   value       TEXT NOT NULL DEFAULT '',
--   updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
-- );

-- ======================== [扩展] 用户、学习与智能体 ========================
-- 这些表不改变当前择校功能；后续新增账号/智能体 API 时可直接接入。
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 登录令牌：当前使用服务端保存的随机令牌，后续可平滑替换为 JWT / OAuth。
CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_token_user ON auth_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS user_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, university_id)
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_s INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_user_started ON study_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL DEFAULT 'study-assistant',
  title TEXT NOT NULL DEFAULT '',
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_message_conversation ON agent_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'preference',
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_type ON agent_memories(user_id, memory_type);

CREATE TABLE IF NOT EXISTS user_admission_plans (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_study_plans (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL CHECK(proposal_type IN ('admission', 'study')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected', 'expired')),
  summary TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  changes_json TEXT NOT NULL DEFAULT '[]',
  source_context_json TEXT NOT NULL DEFAULT '{}',
  previous_state_json TEXT NOT NULL DEFAULT '{}',
  base_revision INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  model TEXT NOT NULL DEFAULT '',
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_user_status ON agent_proposals(user_id, status, created_at DESC);

-- 模型调用审计与额度统计。仅保存长度、耗时和受控错误码，不保存完整提示词或密钥。
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL CHECK(run_type IN ('proposal', 'conversation')),
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  model TEXT NOT NULL DEFAULT '',
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created ON agent_runs(user_id, created_at DESC);
