-- MySQL 8；在活动所属数据库的 SQL 编辑器中【执行整个脚本】。
-- 仅处理指定活动：申请 V2、主单版本 15、当前会签第 1 轮。
-- 结果：30 人会签全部通过，进入“会签完成后院领导确认”。
-- 保留后续院领导的正常审批；不改旧申请轮次、模板和其他活动。
-- 执行前可导出该活动的 activities / workflow_nodes / workflow_tasks 记录。
-- 本脚本未连接数据库执行。预检失败或执行异常会回滚本次事务。

DELIMITER $$

DROP PROCEDURE IF EXISTS maintenance_pass_d208f6cf_countersign$$
CREATE PROCEDURE maintenance_pass_d208f6cf_countersign()
BEGIN
    DECLARE v_activity_id VARCHAR(80) DEFAULT 'd208f6cf-0b2f-4d4c-b894-3b7527a5c2fe';
    DECLARE v_node_id VARCHAR(80) DEFAULT '0dbf08b4-7096-4cbd-8d09-9473bc9ec042';
    DECLARE v_leader_node_id VARCHAR(80) DEFAULT '849fe5a1-38e2-487d-87fa-33bbd5c2c023';
    DECLARE v_leader_id VARCHAR(80) DEFAULT 'u-org-yuanlingdao';
    DECLARE v_status VARCHAR(30) DEFAULT NULL;
    DECLARE v_version INT DEFAULT NULL;
    DECLARE v_activity_data JSON;
    DECLARE v_node_status VARCHAR(30) DEFAULT NULL;
    DECLARE v_node_generation INT DEFAULT NULL;
    DECLARE v_node_data JSON;
    DECLARE v_leader_status VARCHAR(30) DEFAULT NULL;
    DECLARE v_leader_generation INT DEFAULT NULL;
    DECLARE v_leader_data JSON;
    DECLARE v_total INT DEFAULT 0;
    DECLARE v_valid INT DEFAULT 0;
    DECLARE v_changed INT DEFAULT 0;
    DECLARE v_new_task_id VARCHAR(80);
    DECLARE v_event_id VARCHAR(80);
    DECLARE v_now DATETIME(3);
    DECLARE v_json_time VARCHAR(30);
    DECLARE v_note VARCHAR(500) DEFAULT '数据库维护：按本次维护请求批量通过当前30人会签，非各受理人逐项操作；院领导确认另行办理。';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- 与服务端相同，先锁定活动，阻止正常审批接口并发修改。
    SELECT status, version, data
      INTO v_status, v_version, v_activity_data
      FROM activities
     WHERE id = v_activity_id AND deleted_at IS NULL
     FOR UPDATE;

    IF COALESCE(
        v_status = 'approving' AND v_version = 15
        AND JSON_UNQUOTE(JSON_EXTRACT(v_activity_data, '$.status')) = 'approving'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_activity_data, '$.version')) AS UNSIGNED) = 15
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_activity_data, '$.revision')) AS UNSIGNED) = 2,
        0
    ) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '活动状态或版本已变化，请重新查询；本次未修改数据';
    END IF;

    SELECT status, generation, data
      INTO v_node_status, v_node_generation, v_node_data
      FROM workflow_nodes
     WHERE id = v_node_id AND activity_id = v_activity_id
     FOR UPDATE;

    SELECT status, generation, data
      INTO v_leader_status, v_leader_generation, v_leader_data
      FROM workflow_nodes
     WHERE id = v_leader_node_id AND activity_id = v_activity_id
     FOR UPDATE;

    IF COALESCE(
        v_node_status = 'active' AND v_node_generation = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(v_node_data, '$.status')) = 'active'
        AND JSON_UNQUOTE(JSON_EXTRACT(v_node_data, '$.kind')) = 'approval'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_node_data, '$.generation')) AS UNSIGNED) = 1
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_node_data, '$.applicationRevision')) AS UNSIGNED) = 2
        AND JSON_LENGTH(JSON_EXTRACT(v_node_data, '$.deps')) = 0
        AND JSON_LENGTH(JSON_EXTRACT(v_node_data, '$.assignees')) = 30,
        0
    ) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '当前会签节点已变化，本次未修改数据';
    END IF;

    IF COALESCE(
        v_leader_status = 'waiting' AND v_leader_generation = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(v_leader_data, '$.status')) = 'waiting'
        AND JSON_UNQUOTE(JSON_EXTRACT(v_leader_data, '$.kind')) = 'approval'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_leader_data, '$.generation')) AS UNSIGNED) = 1
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(v_leader_data, '$.applicationRevision')) AS UNSIGNED) = 2
        AND JSON_LENGTH(JSON_EXTRACT(v_leader_data, '$.deps')) = 1
        AND JSON_CONTAINS(JSON_EXTRACT(v_leader_data, '$.deps'), JSON_QUOTE(v_node_id)) = 1
        AND JSON_LENGTH(JSON_EXTRACT(v_leader_data, '$.assignees')) = 1
        AND JSON_CONTAINS(JSON_EXTRACT(v_leader_data, '$.assignees'), JSON_QUOTE(v_leader_id)) = 1,
        0
    ) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '后续院领导节点已变化，本次未修改数据';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM workflow_nodes
     WHERE activity_id = v_activity_id
       AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.applicationRevision')) AS UNSIGNED), 1) = 2;
    IF v_total <> 2 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '当前申请流程结构已变化，本次未修改数据';
    END IF;

    -- 只接受截图中的30个本轮待办，不覆盖已通过、退回或取消的任务。
    SELECT COUNT(*), COALESCE(SUM(
        status = 'pending' AND version = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.status')) = 'pending'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.version')) AS UNSIGNED) = 1
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.generation')) AS UNSIGNED) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.nodeId')) = v_node_id
        AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.activityId')) = v_activity_id
        AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee')) = assignee_id
        AND JSON_CONTAINS(JSON_EXTRACT(v_node_data, '$.assignees'), JSON_QUOTE(assignee_id)) = 1
    ), 0)
      INTO v_total, v_valid
      FROM workflow_tasks
     WHERE activity_id = v_activity_id AND node_id = v_node_id AND generation = 1;
    IF v_total <> 30 OR v_valid <> 30 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '会签任务数量或状态已变化，本次未修改数据';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM workflow_tasks
     WHERE activity_id = v_activity_id AND node_id = v_leader_node_id;
    IF v_total <> 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '院领导待办已经存在，请重新查询，本次未修改数据';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM members
     WHERE id = v_leader_id AND active = 1
       AND JSON_CONTAINS(roles, JSON_QUOTE('director')) = 1;
    IF v_total <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '院领导账号已停用或角色已调整，请先修正人员配置';
    END IF;

    SET v_now = UTC_TIMESTAMP(3);
    SET v_json_time = CONCAT(
        DATE_FORMAT(v_now, '%Y-%m-%dT%H:%i:%s.'),
        LPAD(MICROSECOND(v_now) DIV 1000, 3, '0'), 'Z'
    );
    SET v_new_task_id = UUID();
    SET v_event_id = UUID();

    UPDATE workflow_tasks
       SET status = 'approved',
           version = 2,
           data = JSON_SET(data,
               '$.status', 'approved', '$.version', 2,
               '$.comment', '', '$.publicComment', v_note,
               '$.actedAt', v_json_time)
     WHERE activity_id = v_activity_id AND node_id = v_node_id
       AND generation = 1 AND status = 'pending' AND version = 1;
    SET v_changed = ROW_COUNT();
    IF v_changed <> 30 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '会签任务出现并发变化，本次事务已回滚';
    END IF;

    UPDATE workflow_nodes
       SET status = 'completed', data = JSON_SET(data, '$.status', 'completed')
     WHERE activity_id = v_activity_id AND id = v_node_id
       AND status = 'active' AND generation = 1;
    IF ROW_COUNT() <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '完成会签节点失败，本次事务已回滚';
    END IF;

    UPDATE workflow_nodes
       SET status = 'active', data = JSON_SET(data, '$.status', 'active')
     WHERE activity_id = v_activity_id AND id = v_leader_node_id
       AND status = 'waiting' AND generation = 1;
    IF ROW_COUNT() <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '激活院领导节点失败，本次事务已回滚';
    END IF;

    INSERT INTO workflow_tasks
        (id, activity_id, node_id, assignee_id, generation, status, version, data)
    VALUES (
        v_new_task_id, v_activity_id, v_leader_node_id, v_leader_id, 1, 'pending', 1,
        JSON_OBJECT(
            'id', v_new_task_id, 'activityId', v_activity_id,
            'nodeId', v_leader_node_id, 'assignee', v_leader_id,
            'generation', 1, 'status', 'pending', 'version', 1,
            'comment', '', 'createdAt', v_json_time
        )
    );

    -- 后续领导尚未通过，活动继续审批中，暂不指定执行指派/归档审核负责人。
    UPDATE activities
       SET status = 'approving', version = 16, updated_at = v_now,
           data = JSON_SET(
               JSON_REMOVE(data, '$.lastApprovalTaskId', '$.workflowOwnerId', '$.workflowOwnerNodeId'),
               '$.status', 'approving', '$.version', 16, '$.updatedAt', v_json_time
           )
     WHERE id = v_activity_id AND deleted_at IS NULL
       AND status = 'approving' AND version = 15;
    IF ROW_COUNT() <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '更新活动版本失败，本次事务已回滚';
    END IF;

    INSERT INTO audit_events (id, activity_id, actor_id, action, data, created_at)
    VALUES (
        v_event_id, v_activity_id, 'manual-sql', '数据库维护：批量通过30人会签',
        JSON_OBJECT(
            'id', v_event_id, 'actor', 'manual-sql',
            'actorName', CONCAT('数据库维护 / ', CURRENT_USER()),
            'nodeId', v_node_id,
            'action', '数据库维护：批量通过30人会签',
            'note', '', 'publicNote', v_note, 'createdAt', v_json_time
        ), v_now
    );

    -- 复用系统通知出站表，仅通知新待办的院领导。
    INSERT INTO outbox_events
        (id, event_key, activity_id, recipient_id, title, delivered, created_at)
    SELECT UUID(), CONCAT('manual-countersign:', v_new_task_id), id,
           v_leader_id, CONCAT('新的待办：', LEFT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')), code), 180)),
           FALSE, v_now
      FROM activities WHERE id = v_activity_id;

    COMMIT;

    SELECT '成功：30人会签已通过，请使用 yuanlingdao 账号办理院领导确认' AS result,
           v_activity_id AS activity_id,
           16 AS activity_version,
           v_changed AS approved_task_count,
           v_new_task_id AS leader_task_id;
END$$

CALL maintenance_pass_d208f6cf_countersign()$$
DROP PROCEDURE maintenance_pass_d208f6cf_countersign$$
DELIMITER ;

-- 执行后应看到：会签 completed / 30 approved，院领导 active / 1 pending。
SELECT n.id, JSON_UNQUOTE(JSON_EXTRACT(n.data, '$.label')) AS node_name,
       n.status AS node_status, t.status AS task_status, COUNT(t.id) AS task_count
  FROM workflow_nodes n
  LEFT JOIN workflow_tasks t
    ON t.activity_id = n.activity_id AND t.node_id = n.id AND t.generation = n.generation
 WHERE n.activity_id = 'd208f6cf-0b2f-4d4c-b894-3b7527a5c2fe'
   AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(n.data, '$.applicationRevision')) AS UNSIGNED), 1) = 2
 GROUP BY n.id, n.status, JSON_UNQUOTE(JSON_EXTRACT(n.data, '$.label')), t.status;
