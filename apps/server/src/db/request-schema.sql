CREATE TABLE IF NOT EXISTS requests (
 id VARCHAR(80) PRIMARY KEY, code VARCHAR(80) NOT NULL UNIQUE,
 business_type VARCHAR(30) NOT NULL DEFAULT 'general', case_status VARCHAR(30) NOT NULL,
 approval_result VARCHAR(30) NOT NULL, current_stage VARCHAR(60) NULL,
 status VARCHAR(30) NOT NULL, applicant_id VARCHAR(80) NOT NULL,
 department_id VARCHAR(80) NOT NULL, version INT NOT NULL,
 template_id VARCHAR(80) NULL, template_version INT NULL,
 data JSON NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 deleted_at DATETIME(3) NULL, deleted_by VARCHAR(80) NULL, deletion_reason VARCHAR(500) NULL,
 INDEX idx_request_applicant(applicant_id,updated_at), INDEX idx_request_status(status,department_id)
);
CREATE TABLE IF NOT EXISTS request_nodes (
 id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, node_key VARCHAR(80) NOT NULL,
 status VARCHAR(30) NOT NULL, generation INT NOT NULL, data JSON NOT NULL,
 INDEX idx_request_node(activity_id,status), FOREIGN KEY(activity_id) REFERENCES requests(id)
);
CREATE TABLE IF NOT EXISTS request_tasks (
 id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, node_id VARCHAR(80) NOT NULL,
 assignee_id VARCHAR(80) NOT NULL, generation INT NOT NULL, status VARCHAR(30) NOT NULL,
 version INT NOT NULL, data JSON NOT NULL,
 UNIQUE KEY uq_request_task_attempt(node_id,generation,assignee_id),
 INDEX idx_request_inbox(assignee_id,status,activity_id), FOREIGN KEY(activity_id) REFERENCES requests(id)
);
CREATE TABLE IF NOT EXISTS request_edges (
 activity_id VARCHAR(80) NOT NULL, from_node VARCHAR(80) NOT NULL, to_node VARCHAR(80) NOT NULL,
 structure_revision INT NOT NULL, PRIMARY KEY(activity_id,from_node,to_node),
 FOREIGN KEY(activity_id) REFERENCES requests(id)
);
CREATE TABLE IF NOT EXISTS request_files (
 id VARCHAR(80) PRIMARY KEY, activity_id VARCHAR(80) NOT NULL, uploader_id VARCHAR(80) NOT NULL,
 name VARCHAR(255) NOT NULL, storage_key VARCHAR(512) NOT NULL UNIQUE, mime VARCHAR(120) NOT NULL,
 size BIGINT UNSIGNED NOT NULL, stage VARCHAR(20) NOT NULL,
 context_id VARCHAR(80) NULL, action_key VARCHAR(40) NULL, node_id VARCHAR(80) NULL, field_key VARCHAR(40) NULL,
 access_rule JSON NULL, download_rule JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_request_file(activity_id,stage), FOREIGN KEY(activity_id) REFERENCES requests(id)
);
