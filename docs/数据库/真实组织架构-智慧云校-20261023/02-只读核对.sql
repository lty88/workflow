-- 只读核对，不写入数据
SELECT d.id,d.parent_id,d.name,m.username AS manager_account,COUNT(s.id) AS test_accounts FROM departments d LEFT JOIN members m ON m.id=d.manager_id LEFT JOIN members s ON s.department_id=d.id AND s.active=TRUE AND s.id LIKE 'u-org-%' GROUP BY d.id,d.parent_id,d.name,m.username ORDER BY d.parent_id,d.id;
SELECT id,username,name,department_id,roles FROM members WHERE active=TRUE AND id LIKE 'u-org-%' ORDER BY department_id,username;
SELECT id,code,current_version,active FROM workflow_templates WHERE id='wf-real-company-org-test';
SELECT batch_key,captured_at FROM orgsql_rebuild_backups;
