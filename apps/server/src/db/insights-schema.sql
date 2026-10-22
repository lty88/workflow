CREATE TABLE IF NOT EXISTS activity_surveys (
  activity_id VARCHAR(80) PRIMARY KEY,
  token CHAR(64) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS activity_evaluations (
  id VARCHAR(80) PRIMARY KEY,
  activity_id VARCHAR(80) NOT NULL,
  respondent_hash CHAR(64) NOT NULL,
  overall TINYINT UNSIGNED NOT NULL CHECK (overall BETWEEN 1 AND 5),
  content TINYINT UNSIGNED NOT NULL CHECK (content BETWEEN 1 AND 5),
  organization TINYINT UNSIGNED NOT NULL CHECK (organization BETWEEN 1 AND 5),
  usefulness TINYINT UNSIGNED NOT NULL CHECK (usefulness BETWEEN 1 AND 5),
  comment VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activity_respondent (activity_id,respondent_hash),
  INDEX idx_evaluation_activity_time (activity_id,created_at,id)
);
