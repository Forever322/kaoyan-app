-- Extensible, source-aware graduate-admission catalog.
--
-- Existing tables remain the backwards-compatible school overview layer.
-- The new tables model the granular path:
-- university -> academic unit -> program -> annual offering -> exam/retest/
-- admission data.  Every mutable reference-data entity can retain provenance
-- and a verification state instead of presenting scraped or stale material as
-- a current official fact.

CREATE TABLE IF NOT EXISTS data_import_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  source_system VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_version VARCHAR(128) NOT NULL DEFAULT '',
  source_uri VARCHAR(2048) NOT NULL DEFAULT '',
  checksum CHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  record_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary TEXT NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_data_import_batches_key (batch_key),
  KEY idx_data_import_batches_status_created (status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  document_type VARCHAR(64) NOT NULL DEFAULT 'other',
  title VARCHAR(500) NOT NULL,
  issuing_organization VARCHAR(255) NOT NULL DEFAULT '',
  source_url VARCHAR(2048) NOT NULL DEFAULT '',
  archive_url VARCHAR(2048) NOT NULL DEFAULT '',
  content_hash CHAR(64) NOT NULL DEFAULT '',
  published_at DATE NULL,
  effective_year SMALLINT UNSIGNED NULL,
  retrieved_at DATETIME(3) NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  verification_note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_source_documents_university_year (university_id, effective_year DESC, id DESC),
  KEY idx_source_documents_type_year (document_type, effective_year DESC),
  KEY idx_source_documents_verification (verification_status, status),
  KEY idx_source_documents_batch (import_batch_id),
  CONSTRAINT fk_source_documents_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE SET NULL,
  CONSTRAINT fk_source_documents_batch FOREIGN KEY (import_batch_id) REFERENCES data_import_batches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS university_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  alias_name VARCHAR(191) NOT NULL,
  alias_type VARCHAR(32) NOT NULL DEFAULT 'historical_name',
  valid_from DATE NULL,
  valid_to DATE NULL,
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_university_aliases_identity (university_id, alias_name),
  KEY idx_university_aliases_name (alias_name),
  KEY idx_university_aliases_document (source_document_id),
  CONSTRAINT fk_university_aliases_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  CONSTRAINT fk_university_aliases_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campuses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(191) NOT NULL,
  code VARCHAR(64) NOT NULL DEFAULT '',
  city VARCHAR(64) NOT NULL DEFAULT '',
  province VARCHAR(64) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL DEFAULT '',
  postal_code VARCHAR(32) NOT NULL DEFAULT '',
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  website VARCHAR(500) NOT NULL DEFAULT '',
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_campuses_identity (university_id, name),
  KEY idx_campuses_university_status (university_id, status),
  CONSTRAINT fk_campuses_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  CONSTRAINT fk_campuses_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS academic_units (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  campus_id BIGINT UNSIGNED NULL,
  parent_id BIGINT UNSIGNED NULL,
  unit_type VARCHAR(32) NOT NULL DEFAULT 'college',
  code VARCHAR(64) NULL,
  name VARCHAR(191) NOT NULL,
  english_name VARCHAR(191) NOT NULL DEFAULT '',
  website VARCHAR(500) NOT NULL DEFAULT '',
  phone VARCHAR(128) NOT NULL DEFAULT '',
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_units_name (university_id, name),
  UNIQUE KEY uq_academic_units_code (university_id, code),
  KEY idx_academic_units_campus (campus_id),
  KEY idx_academic_units_parent (parent_id),
  KEY idx_academic_units_university_status (university_id, status),
  CONSTRAINT fk_academic_units_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  CONSTRAINT fk_academic_units_campus FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
  CONSTRAINT fk_academic_units_parent FOREIGN KEY (parent_id) REFERENCES academic_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_academic_units_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  academic_unit_id BIGINT UNSIGNED NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(191) NOT NULL,
  degree VARCHAR(32) NOT NULL DEFAULT '',
  category VARCHAR(128) NOT NULL DEFAULT '',
  direction VARCHAR(255) NOT NULL DEFAULT '',
  discipline_code VARCHAR(64) NOT NULL DEFAULT '',
  discipline_name VARCHAR(191) NOT NULL DEFAULT '',
  study_mode VARCHAR(32) NOT NULL DEFAULT '',
  program_type VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_document_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_programs_identity (university_id, code, degree, category, direction),
  KEY idx_programs_university_name (university_id, name),
  KEY idx_programs_unit (academic_unit_id),
  KEY idx_programs_category (degree, category),
  KEY idx_programs_status (status),
  CONSTRAINT fk_programs_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  CONSTRAINT fk_programs_unit FOREIGN KEY (academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_programs_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS program_offerings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_id BIGINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  academic_unit_id BIGINT UNSIGNED NULL,
  campus_id BIGINT UNSIGNED NULL,
  admission_type VARCHAR(32) NOT NULL DEFAULT '统考',
  study_mode VARCHAR(32) NOT NULL DEFAULT '',
  enrollment_plan INT UNSIGNED NULL,
  recommended_exempt_plan INT UNSIGNED NULL,
  target_population VARCHAR(255) NOT NULL DEFAULT '',
  duration_years DECIMAL(4,1) NULL,
  tuition_fee DECIMAL(12,2) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  exam_mode VARCHAR(64) NOT NULL DEFAULT '',
  application_notes TEXT NULL,
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_program_offerings_identity (program_id, year, admission_type, study_mode),
  KEY idx_program_offerings_year_status (year, status),
  KEY idx_program_offerings_unit (academic_unit_id),
  KEY idx_program_offerings_campus (campus_id),
  KEY idx_program_offerings_document (source_document_id),
  CONSTRAINT fk_program_offerings_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  CONSTRAINT fk_program_offerings_unit FOREIGN KEY (academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_program_offerings_campus FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
  CONSTRAINT fk_program_offerings_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_subjects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_offering_id BIGINT UNSIGNED NOT NULL,
  sequence_no TINYINT UNSIGNED NOT NULL,
  subject_code VARCHAR(64) NOT NULL DEFAULT '',
  subject_name VARCHAR(255) NOT NULL,
  subject_type VARCHAR(32) NOT NULL DEFAULT '',
  is_self_proposed BOOLEAN NOT NULL DEFAULT FALSE,
  full_score SMALLINT UNSIGNED NULL,
  reference_books_json JSON NULL,
  notes TEXT NULL,
  source_document_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exam_subjects_sequence (program_offering_id, sequence_no),
  KEY idx_exam_subjects_document (source_document_id),
  CONSTRAINT fk_exam_subjects_offering FOREIGN KEY (program_offering_id) REFERENCES program_offerings(id) ON DELETE CASCADE,
  CONSTRAINT fk_exam_subjects_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admission_statistics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_offering_id BIGINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  statistic_scope VARCHAR(32) NOT NULL DEFAULT 'program',
  applicant_count INT UNSIGNED NULL,
  admitted_count INT UNSIGNED NULL,
  waitlist_count INT UNSIGNED NULL,
  recommended_exempt_count INT UNSIGNED NULL,
  enrolled_count INT UNSIGNED NULL,
  admission_ratio DECIMAL(9,4) NULL,
  lowest_score DECIMAL(7,2) NULL,
  average_score DECIMAL(7,2) NULL,
  highest_score DECIMAL(7,2) NULL,
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admission_statistics_identity (program_offering_id, year, statistic_scope),
  KEY idx_admission_statistics_year (year),
  KEY idx_admission_statistics_document (source_document_id),
  CONSTRAINT fk_admission_statistics_offering FOREIGN KEY (program_offering_id) REFERENCES program_offerings(id) ON DELETE CASCADE,
  CONSTRAINT fk_admission_statistics_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS score_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope VARCHAR(32) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  university_id BIGINT UNSIGNED NULL,
  academic_unit_id BIGINT UNSIGNED NULL,
  program_id BIGINT UNSIGNED NULL,
  degree VARCHAR(32) NOT NULL DEFAULT '',
  category VARCHAR(128) NOT NULL DEFAULT '',
  candidate_type VARCHAR(64) NOT NULL DEFAULT '',
  total_score DECIMAL(7,2) NOT NULL,
  politics_line DECIMAL(7,2) NULL,
  foreign_language_line DECIMAL(7,2) NULL,
  business_1_line DECIMAL(7,2) NULL,
  business_2_line DECIMAL(7,2) NULL,
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_score_lines_lookup (scope, year DESC, university_id, program_id),
  KEY idx_score_lines_category (year DESC, degree, category),
  KEY idx_score_lines_document (source_document_id),
  CONSTRAINT fk_score_lines_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE SET NULL,
  CONSTRAINT fk_score_lines_unit FOREIGN KEY (academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_score_lines_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL,
  CONSTRAINT fk_score_lines_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retest_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_offering_id BIGINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  retest_mode VARCHAR(64) NOT NULL DEFAULT '',
  initial_exam_weight DECIMAL(5,2) NULL,
  retest_weight DECIMAL(5,2) NULL,
  written_test_weight DECIMAL(5,2) NULL,
  interview_weight DECIMAL(5,2) NULL,
  computer_test_weight DECIMAL(5,2) NULL,
  foreign_language_test_required BOOLEAN NOT NULL DEFAULT FALSE,
  cross_major_allowed BOOLEAN NULL,
  equivalent_education_requirements TEXT NULL,
  adjustment_policy TEXT NULL,
  rules_json JSON NULL,
  source_document_id BIGINT UNSIGNED NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_retest_rules_offering_year (program_offering_id, year),
  KEY idx_retest_rules_document (source_document_id),
  CONSTRAINT fk_retest_rules_offering FOREIGN KEY (program_offering_id) REFERENCES program_offerings(id) ON DELETE CASCADE,
  CONSTRAINT fk_retest_rules_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  operation VARCHAR(32) NOT NULL,
  changed_fields_json JSON NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  source_document_id BIGINT UNSIGNED NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_catalog_change_log_entity (entity_type, entity_id, created_at DESC),
  KEY idx_catalog_change_log_batch (import_batch_id),
  CONSTRAINT fk_catalog_change_log_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_change_log_batch FOREIGN KEY (import_batch_id) REFERENCES data_import_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_change_log_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_data_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(64) NOT NULL,
  entity_key VARCHAR(255) NOT NULL,
  issue_code VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  details_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  source_document_id BIGINT UNSIGNED NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  resolved_by_user_id BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_data_issues_identity (entity_type, entity_key, issue_code, status),
  KEY idx_catalog_data_issues_queue (status, severity, created_at DESC),
  KEY idx_catalog_data_issues_entity (entity_type, entity_key),
  KEY idx_catalog_data_issues_batch (import_batch_id),
  CONSTRAINT fk_catalog_data_issues_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_data_issues_batch FOREIGN KEY (import_batch_id) REFERENCES data_import_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_data_issues_user FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add provenance to legacy overview tables without altering their old unique
-- keys. Granular annual/program data belongs in the tables above, while the
-- old routes and seed keep functioning exactly as before.
ALTER TABLE universities
  ADD COLUMN official_name VARCHAR(191) NULL AFTER name,
  ADD COLUMN institution_code VARCHAR(64) NULL AFTER official_name,
  ADD COLUMN founded_year SMALLINT UNSIGNED NULL AFTER institution_code,
  ADD COLUMN administrative_level VARCHAR(64) NOT NULL DEFAULT '' AFTER founded_year,
  ADD COLUMN affiliation VARCHAR(191) NOT NULL DEFAULT '' AFTER administrative_level,
  ADD COLUMN is_double_first_class BOOLEAN NULL AFTER affiliation,
  ADD COLUMN is_985 BOOLEAN NULL AFTER is_double_first_class,
  ADD COLUMN is_211 BOOLEAN NULL AFTER is_985,
  ADD COLUMN tags_json JSON NULL AFTER is_211,
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL AFTER tags_json,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER source_document_id,
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER verification_status;

ALTER TABLE uni_details
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN retrieved_at DATETIME(3) NULL;

ALTER TABLE uni_photos
  ADD COLUMN source_url VARCHAR(2048) NOT NULL DEFAULT '',
  ADD COLUMN license_url VARCHAR(2048) NOT NULL DEFAULT '',
  ADD COLUMN attribution VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN copyright_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN retrieved_at DATETIME(3) NULL;

ALTER TABLE national_lines
  ADD COLUMN politics_line DECIMAL(7,2) NULL,
  ADD COLUMN foreign_language_line DECIMAL(7,2) NULL,
  ADD COLUMN business_1_line DECIMAL(7,2) NULL,
  ADD COLUMN business_2_line DECIMAL(7,2) NULL,
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN retrieved_at DATETIME(3) NULL;

ALTER TABLE admission_scores
  ADD COLUMN academic_unit_id BIGINT UNSIGNED NULL,
  ADD COLUMN program_id BIGINT UNSIGNED NULL,
  ADD COLUMN score_scope VARCHAR(32) NOT NULL DEFAULT 'university',
  ADD COLUMN candidate_type VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN retrieved_at DATETIME(3) NULL;

ALTER TABLE uni_requirements
  ADD COLUMN academic_unit_id BIGINT UNSIGNED NULL,
  ADD COLUMN program_id BIGINT UNSIGNED NULL,
  ADD COLUMN effective_year SMALLINT UNSIGNED NULL,
  ADD COLUMN requirement_scope VARCHAR(32) NOT NULL DEFAULT 'university',
  ADD COLUMN source_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN catalog_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN retrieved_at DATETIME(3) NULL;

CREATE INDEX idx_universities_catalog_status ON universities(catalog_status, verification_status);
CREATE INDEX idx_universities_institution_code ON universities(institution_code);
CREATE INDEX idx_uni_details_catalog_status ON uni_details(catalog_status, verification_status);
CREATE INDEX idx_uni_photos_catalog_status ON uni_photos(catalog_status, verification_status);
CREATE INDEX idx_national_lines_catalog_status ON national_lines(catalog_status, verification_status);
CREATE INDEX idx_admission_scores_program_year ON admission_scores(program_id, year DESC);
CREATE INDEX idx_admission_scores_catalog_status ON admission_scores(catalog_status, verification_status);
CREATE INDEX idx_uni_requirements_program_year ON uni_requirements(program_id, effective_year DESC);
CREATE INDEX idx_uni_requirements_catalog_status ON uni_requirements(catalog_status, verification_status);
