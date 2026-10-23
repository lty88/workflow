CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3));
CREATE TABLE IF NOT EXISTS configuration (
  id VARCHAR(40) PRIMARY KEY, published JSON NOT NULL, draft JSON NOT NULL,
  revision INT NOT NULL DEFAULT 1, draft_revision INT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS configuration_releases (
  version INT PRIMARY KEY, data JSON NOT NULL, actor VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(80) PRIMARY KEY, parent_id VARCHAR(80) NOT NULL, name VARCHAR(80) NOT NULL,
  manager_id VARCHAR(80) NOT NULL, active BOOLEAN NOT NULL, data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(80) PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(80) NOT NULL,
  department_id VARCHAR(80) NOT NULL, active BOOLEAN NOT NULL, roles JSON NOT NULL,
  password_hash VARCHAR(300) NULL, INDEX idx_member_department (department_id, active)
);
CREATE TABLE IF NOT EXISTS roles (id VARCHAR(80) PRIMARY KEY, name VARCHAR(80) NOT NULL, data JSON NOT NULL);
CREATE TABLE IF NOT EXISTS menu_pages (id VARCHAR(80) PRIMARY KEY, name VARCHAR(80) NOT NULL, active BOOLEAN NOT NULL, data JSON NOT NULL, sort_order INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY, member_id VARCHAR(80) NOT NULL, csrf_token CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL, INDEX idx_session_member (member_id), INDEX idx_session_expiry (expires_at)
);
CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(80) PRIMARY KEY, code VARCHAR(80) NOT NULL UNIQUE, applicant_id VARCHAR(80) NOT NULL,
  department_id VARCHAR(80) NOT NULL, status VARCHAR(30) NOT NULL, version INT NOT NULL,
  data JSON NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL, deleted_by VARCHAR(80) NULL, deletion_reason VARCHAR(500) NULL,
  INDEX idx_activity_department (department_id, status), INDEX idx_activity_applicant (applicant_id, updated_at)
);
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, node_key VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL, generation INT NOT NULL, data JSON NOT NULL,
  INDEX idx_node_activity (activity_id, status), FOREIGN KEY (activity_id) REFERENCES activities(id)
);
CREATE TABLE IF NOT EXISTS workflow_edges (
  activity_id VARCHAR(80) NOT NULL, from_node VARCHAR(80) NOT NULL, to_node VARCHAR(80) NOT NULL,
  structure_revision INT NOT NULL, PRIMARY KEY (activity_id, from_node, to_node),
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, node_id VARCHAR(80) NOT NULL,
  assignee_id VARCHAR(80) NOT NULL, generation INT NOT NULL, status VARCHAR(30) NOT NULL,
  version INT NOT NULL, data JSON NOT NULL,
  UNIQUE KEY uq_task_attempt (node_id, generation, assignee_id),
  INDEX idx_task_inbox (assignee_id, status, activity_id), FOREIGN KEY (activity_id) REFERENCES activities(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NULL, actor_id VARCHAR(80) NOT NULL,
  action VARCHAR(120) NOT NULL, data JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_audit_activity (activity_id, created_at)
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  actor_id VARCHAR(80) NOT NULL, request_key VARCHAR(100) NOT NULL, request_hash CHAR(64) NOT NULL,
  response JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor_id, request_key)
);
CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, uploader_id VARCHAR(80) NOT NULL,
  name VARCHAR(255) NOT NULL, storage_key VARCHAR(80) NOT NULL UNIQUE, mime VARCHAR(120) NOT NULL,
  size BIGINT UNSIGNED NOT NULL, stage VARCHAR(20) NOT NULL,
  node_id VARCHAR(80) NULL, field_key VARCHAR(40) NULL, access_rule JSON NULL, download_rule JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_file_field (activity_id, stage, field_key), INDEX idx_file_activity (activity_id, stage), FOREIGN KEY (activity_id) REFERENCES activities(id)
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(80) PRIMARY KEY, event_key VARCHAR(180) NOT NULL UNIQUE, activity_id VARCHAR(80) NOT NULL,
  recipient_id VARCHAR(80) NOT NULL, title VARCHAR(200) NOT NULL, delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_outbox_pending (delivered, created_at)
);
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(80) PRIMARY KEY, event_id VARCHAR(80) NOT NULL UNIQUE, recipient_id VARCHAR(80) NOT NULL,
  activity_id VARCHAR(80) NOT NULL, title VARCHAR(200) NOT NULL, read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_notification_inbox (recipient_id, read_at, created_at)
);
CREATE TABLE IF NOT EXISTS template_catalog_lock (id VARCHAR(40) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS activity_types (
  id VARCHAR(80) PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE, name VARCHAR(80) NOT NULL,
  active BOOLEAN NOT NULL, sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workflow_templates (
  id VARCHAR(80) PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE,
  current_version INT NOT NULL DEFAULT 0, draft_revision INT NOT NULL DEFAULT 1,
  draft JSON NOT NULL, published JSON NULL, created_by VARCHAR(80) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS workflow_template_releases (
  template_id VARCHAR(80) NOT NULL, version INT NOT NULL, definition JSON NOT NULL,
  form_snapshot JSON NOT NULL, published_by VARCHAR(80) NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(template_id,version), FOREIGN KEY(template_id) REFERENCES workflow_templates(id)
);
CREATE TABLE IF NOT EXISTS activity_type_templates (
  activity_type_id VARCHAR(80) NOT NULL, template_id VARCHAR(80) NOT NULL, is_default BOOLEAN NOT NULL,
  PRIMARY KEY(activity_type_id,template_id), FOREIGN KEY(activity_type_id) REFERENCES activity_types(id),
  FOREIGN KEY(template_id) REFERENCES workflow_templates(id)
);

CREATE TABLE IF NOT EXISTS menu_groups (
  id VARCHAR(80) PRIMARY KEY, name VARCHAR(80) NOT NULL, active BOOLEAN NOT NULL, sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS form_definitions (
  id VARCHAR(80) PRIMARY KEY, version INT NOT NULL, definition JSON NOT NULL, updated_by VARCHAR(80) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS form_definition_versions (
  form_id VARCHAR(80) NOT NULL, version INT NOT NULL, definition JSON NOT NULL, actor_id VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(form_id,version),
  FOREIGN KEY(form_id) REFERENCES form_definitions(id)
);
CREATE TABLE IF NOT EXISTS master_data_migration_backups (
  id VARCHAR(40) PRIMARY KEY, data JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
