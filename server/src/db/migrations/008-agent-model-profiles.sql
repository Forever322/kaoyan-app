-- Encrypted model credentials managed by the super-administrator console.
-- API keys are encrypted by the application with AES-256-GCM before they are
-- sent to MySQL.  The encryption master key remains environment-only.

CREATE TABLE IF NOT EXISTS agent_model_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  profile_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  base_url VARCHAR(500) NOT NULL,
  model VARCHAR(128) NOT NULL,
  temperature DECIMAL(3,2) NOT NULL DEFAULT 0.20,
  max_tokens SMALLINT UNSIGNED NOT NULL DEFAULT 1200,
  encrypted_api_key VARBINARY(4096) NULL,
  key_iv BINARY(12) NULL,
  key_auth_tag BINARY(16) NULL,
  key_last_four VARCHAR(4) NOT NULL DEFAULT '',
  credential_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  encryption_key_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  credential_mode VARCHAR(16) NOT NULL DEFAULT 'disabled',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_model_profiles_key (profile_key),
  KEY idx_agent_model_profiles_default (is_default, enabled, id),
  KEY idx_agent_model_profiles_provider (provider, enabled, id),
  CONSTRAINT fk_agent_model_profiles_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_agent_model_profiles_temperature CHECK (temperature >= 0 AND temperature <= 1),
  CONSTRAINT chk_agent_model_profiles_max_tokens CHECK (max_tokens >= 128 AND max_tokens <= 4000),
  CONSTRAINT chk_agent_model_profiles_credential_mode CHECK (credential_mode IN ('database','environment','disabled')),
  CONSTRAINT chk_agent_model_profiles_revision CHECK (revision >= 1),
  CONSTRAINT chk_agent_model_profiles_credential_source CHECK (
    (credential_mode = 'database' AND encrypted_api_key IS NOT NULL)
    OR
    (credential_mode IN ('environment','disabled') AND encrypted_api_key IS NULL)
  ),
  CONSTRAINT chk_agent_model_profiles_key_parts CHECK (
    (encrypted_api_key IS NULL AND key_iv IS NULL AND key_auth_tag IS NULL AND key_last_four = '')
    OR
    (encrypted_api_key IS NOT NULL AND key_iv IS NOT NULL AND key_auth_tag IS NOT NULL AND CHAR_LENGTH(key_last_four) = 4)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This row deliberately has no credential. Existing deployments continue to
-- use the legacy environment fallback until a super administrator saves an API
-- key through the console.
INSERT INTO agent_model_profiles(
  profile_key,display_name,provider,base_url,model,temperature,max_tokens,credential_mode,enabled,is_default
) VALUES(
  'default','默认模型','deepseek','https://api.deepseek.com/v1','deepseek-chat',0.20,1200,'environment',TRUE,TRUE
)
ON DUPLICATE KEY UPDATE profile_key=VALUES(profile_key);
