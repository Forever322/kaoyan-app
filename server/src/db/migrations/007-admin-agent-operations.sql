-- Persisted administration-agent workflow, read-access logs and operational
-- alerts.  The model can only create staged reviews; a super administrator
-- must confirm the checksum before the application writes staged rows.

ALTER TABLE agent_runs
  MODIFY COLUMN run_type VARCHAR(40) NOT NULL,
  ADD COLUMN admin_agent_job_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD KEY idx_agent_runs_admin_created (run_type, created_at, id);

CREATE TABLE IF NOT EXISTS admin_agent_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  target_table VARCHAR(64) NOT NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  source_document_id BIGINT UNSIGNED NULL,
  source_type VARCHAR(16) NOT NULL DEFAULT 'text',
  source_name VARCHAR(255) NOT NULL DEFAULT '',
  instruction_text TEXT NULL,
  input_format VARCHAR(16) NOT NULL DEFAULT '',
  operation_mode VARCHAR(16) NOT NULL DEFAULT 'insert',
  status VARCHAR(32) NOT NULL DEFAULT 'reviewing',
  review_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  checksum CHAR(64) NOT NULL DEFAULT '',
  normalized_rows_json JSON NULL,
  review_json JSON NULL,
  model VARCHAR(80) NOT NULL DEFAULT '',
  error_code VARCHAR(80) NOT NULL DEFAULT '',
  error_message VARCHAR(1000) NOT NULL DEFAULT '',
  affected_rows INT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_by_user_id BIGINT UNSIGNED NULL,
  confirmed_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_agent_jobs_status_created (status, created_at DESC),
  KEY idx_admin_agent_jobs_actor_created (actor_user_id, created_at DESC),
  KEY idx_admin_agent_jobs_table_created (target_table, created_at DESC),
  KEY idx_admin_agent_jobs_expiry (expires_at),
  CONSTRAINT fk_admin_agent_jobs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_admin_agent_jobs_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_admin_agent_jobs_batch FOREIGN KEY (import_batch_id) REFERENCES data_import_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_admin_agent_jobs_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE agent_runs
  ADD CONSTRAINT fk_agent_runs_admin_job FOREIGN KEY (admin_agent_job_id) REFERENCES admin_agent_jobs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS admin_access_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  method VARCHAR(12) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  request_id VARCHAR(128) NOT NULL DEFAULT '',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_access_logs_created (created_at DESC, id DESC),
  KEY idx_admin_access_logs_actor_created (actor_user_id, created_at DESC),
  KEY idx_admin_access_logs_status_created (status_code, created_at DESC),
  CONSTRAINT fk_admin_access_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_key CHAR(64) NOT NULL,
  alert_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  message VARCHAR(1000) NOT NULL DEFAULT '',
  resource_type VARCHAR(64) NOT NULL DEFAULT '',
  resource_id VARCHAR(128) NOT NULL DEFAULT '',
  details_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  acknowledged_by_user_id BIGINT UNSIGNED NULL,
  acknowledged_at DATETIME(3) NULL,
  resolved_by_user_id BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_alerts_key (alert_key),
  KEY idx_admin_alerts_queue (status, severity, last_detected_at DESC),
  KEY idx_admin_alerts_resource (resource_type, resource_id, last_detected_at DESC),
  CONSTRAINT fk_admin_alerts_acknowledger FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_admin_alerts_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE agent_configurations
SET description='后台专用数据摄取与审核助手：把口述或文件转换为结构化待审数据，执行字段、重复、关联和内容检查；只有超级管理员确认校验和后才会写库。',
    updated_by_user_id=NULL,
    settings_json=JSON_SET(
      COALESCE(settings_json,JSON_OBJECT()),
      '$.profile', 'database-manager',
      '$.policyVersion', '2026-08-11.3',
      '$.scope', 'admin-database-workbench',
      '$.capabilities', JSON_ARRAY('natural_language_ingest', 'file_ingest', 'content_review', 'duplicate_detection', 'field_anomaly_check', 'referential_consistency_check', 'repair_plan', 'operational_alerting'),
      '$.supportedFormats', JSON_ARRAY('csv', 'txt', 'json', 'sql', 'xlsx', 'db'),
      '$.writeAccess', false,
      '$.requiresHumanConfirmation', true,
      '$.maxPreviewRows', 20,
      '$.stagingTtlHours', 24
    )
WHERE config_key='database-manager';
