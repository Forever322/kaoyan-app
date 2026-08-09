-- Administrative control plane.  This migration intentionally adds only
-- server-side authority and configuration metadata; secrets such as LLM API
-- keys remain environment-only and are never stored in these tables.

ALTER TABLE users
  ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user' AFTER avatar_url;

ALTER TABLE users
  ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER role;

ALTER TABLE users
  ADD COLUMN last_login_at DATETIME(3) NULL AFTER status;

CREATE INDEX idx_users_role_status_created ON users(role, status, created_at DESC);
CREATE INDEX idx_users_last_login_at ON users(last_login_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(128) NOT NULL DEFAULT '',
  request_id VARCHAR(128) NOT NULL DEFAULT '',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  before_json JSON NULL,
  after_json JSON NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_audit_logs_created (created_at DESC, id DESC),
  KEY idx_admin_audit_logs_actor_created (actor_user_id, created_at DESC),
  KEY idx_admin_audit_logs_resource_created (resource_type, resource_id, created_at DESC),
  KEY idx_admin_audit_logs_action_created (action, created_at DESC),
  CONSTRAINT fk_admin_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings are deliberately limited to non-secret, display-safe controls
-- (enablement, policy/profile metadata and product behaviour hints).  The
-- runtime provider, base URL and API key stay in process environment.
CREATE TABLE IF NOT EXISTS agent_configurations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  config_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  settings_json JSON NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_configurations_key (config_key),
  KEY idx_agent_configurations_enabled (enabled, config_key),
  CONSTRAINT fk_agent_configurations_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  flag_key VARCHAR(96) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percentage TINYINT UNSIGNED NOT NULL DEFAULT 100,
  audience_json JSON NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_feature_flags_key (flag_key),
  KEY idx_feature_flags_enabled (enabled, flag_key),
  CONSTRAINT fk_feature_flags_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_feature_flags_rollout CHECK (rollout_percentage <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fixed, reviewed records make the management screen useful immediately while
-- preventing an administrator from creating an arbitrary unreviewed agent
-- definition through a public HTTP endpoint.
INSERT INTO agent_configurations(config_key, display_name, description, enabled, settings_json)
VALUES
  ('study-assistant', '学习助手', '通用学习陪伴与计划建议助手。模型凭据与服务商配置仅由服务器环境变量管理。', TRUE, JSON_OBJECT('profile', 'study-assistant', 'proposalTypes', JSON_ARRAY('study', 'admission'))),
  ('kaoyan-coach', '考研学习顾问', '基于版本化考研教练策略，生成学习计划、复盘与冲刺建议。', TRUE, JSON_OBJECT('profile', 'kaoyan-coach-zh', 'policyVersion', '2026-08-09'))
ON DUPLICATE KEY UPDATE config_key=VALUES(config_key);

INSERT INTO feature_flags(flag_key, display_name, description, enabled, rollout_percentage, audience_json)
VALUES
  ('admin-console', '后台管理站', '允许已授权管理员使用 /admin/ 管理控制台。', TRUE, 100, JSON_OBJECT('audience', 'administrators')),
  ('agent-kaoyan-coach', '考研学习顾问', '向用户开放考研学习顾问会话。', TRUE, 100, JSON_OBJECT('agentType', 'kaoyan-coach')),
  ('agent-proposals', '智能体方案确认', '允许智能体生成需用户确认的学习或择校方案。', TRUE, 100, JSON_OBJECT('requiresUserConfirmation', true))
ON DUPLICATE KEY UPDATE flag_key=VALUES(flag_key);
