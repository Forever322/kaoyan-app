-- Kaoyan application initial MySQL schema.
-- All application timestamps are stored in UTC as DATETIME(3).

CREATE TABLE IF NOT EXISTS universities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(191) NOT NULL,
  province VARCHAR(64) NOT NULL,
  city VARCHAR(64) NOT NULL DEFAULT '',
  zone ENUM('A', 'B') NOT NULL,
  level ENUM('985', '211', '双一流', '双非') NOT NULL,
  type VARCHAR(64) NOT NULL DEFAULT '综合',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_universities_name (name),
  KEY idx_universities_zone (zone),
  KEY idx_universities_province (province),
  KEY idx_universities_level (level),
  KEY idx_universities_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uni_details (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  english_name VARCHAR(191) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  address VARCHAR(500) NOT NULL DEFAULT '',
  website VARCHAR(500) NOT NULL DEFAULT '',
  phone VARCHAR(128) NOT NULL DEFAULT '',
  ranking VARCHAR(128) NOT NULL DEFAULT '',
  advantages TEXT NOT NULL,
  disadvantages TEXT NOT NULL,
  pros_json JSON NOT NULL,
  cons_json JSON NOT NULL,
  features MEDIUMTEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uni_details_university (university_id),
  CONSTRAINT fk_uni_details_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uni_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(1000) NOT NULL,
  label VARCHAR(191) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_uni_photos_source (university_id, filename(255), label),
  KEY idx_uni_photos_university (university_id),
  CONSTRAINT fk_uni_photos_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS national_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  degree ENUM('学硕', '专硕') NOT NULL,
  category VARCHAR(128) NOT NULL,
  zone ENUM('A', 'B') NOT NULL,
  score SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_national_lines_lookup (year, degree, category, zone),
  KEY idx_national_lines_year (year),
  KEY idx_national_lines_degree_category (degree, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admission_scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  degree VARCHAR(16) NOT NULL,
  category VARCHAR(128) NOT NULL DEFAULT '',
  score SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admission_scores_lookup (university_id, year, degree, category),
  KEY idx_admission_scores_university (university_id),
  KEY idx_admission_scores_year (year),
  CONSTRAINT fk_admission_scores_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uni_requirements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  degree VARCHAR(16) NOT NULL DEFAULT '',
  category VARCHAR(128) NOT NULL DEFAULT '',
  requirement JSON NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uni_requirements_lookup (university_id, degree, category),
  KEY idx_uni_requirements_university (university_id),
  CONSTRAINT fk_uni_requirements_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(191) NOT NULL DEFAULT '',
  avatar_url VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY idx_auth_tokens_user_expiry (user_id, expires_at),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_favorites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  university_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_favorites (user_id, university_id),
  CONSTRAINT fk_user_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_favorites_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(40) NOT NULL DEFAULT '',
  content VARCHAR(200) NOT NULL DEFAULT '',
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  duration_s INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_study_sessions_user_started (user_id, started_at DESC),
  CONSTRAINT fk_study_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  agent_type VARCHAR(40) NOT NULL DEFAULT 'study-assistant',
  title VARCHAR(100) NOT NULL DEFAULT '',
  context_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_conversations_user_updated (user_id, updated_at DESC),
  CONSTRAINT fk_agent_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role ENUM('system', 'user', 'assistant', 'tool') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_messages_conversation_created (conversation_id, created_at, id),
  CONSTRAINT fk_agent_messages_conversation FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_memories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  memory_type VARCHAR(40) NOT NULL DEFAULT 'preference',
  content TEXT NOT NULL,
  metadata_json JSON NOT NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_memories_user_type_updated (user_id, memory_type, updated_at DESC),
  KEY idx_agent_memories_user_expiry (user_id, expires_at),
  CONSTRAINT fk_agent_memories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_admission_plans (
  user_id BIGINT UNSIGNED NOT NULL,
  plan_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_admission_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_study_plans (
  user_id BIGINT UNSIGNED NOT NULL,
  plan_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_study_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  proposal_type ENUM('admission', 'study') NOT NULL,
  status ENUM('pending', 'applied', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
  summary VARCHAR(500) NOT NULL DEFAULT '',
  rationale TEXT NOT NULL,
  changes_json JSON NOT NULL,
  source_context_json JSON NOT NULL,
  previous_state_json JSON NOT NULL,
  base_revision INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  model VARCHAR(80) NOT NULL DEFAULT '',
  applied_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_proposals_user_status_created (user_id, status, created_at DESC),
  CONSTRAINT fk_agent_proposals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  run_type ENUM('proposal', 'conversation') NOT NULL,
  status ENUM('success', 'failed') NOT NULL,
  model VARCHAR(80) NOT NULL DEFAULT '',
  input_chars INT UNSIGNED NOT NULL DEFAULT 0,
  output_chars INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_runs_user_created (user_id, created_at DESC),
  CONSTRAINT fk_agent_runs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
