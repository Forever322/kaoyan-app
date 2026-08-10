-- Dedicated database operations agent.  This migration registers the reviewed
-- admin-only control-plane metadata; it does not grant model-side write access.

INSERT INTO agent_configurations(config_key, display_name, description, enabled, settings_json)
VALUES (
  'database-manager',
  '数据库管理 Agent',
  '后台专用数据审核与核对助手，用于导入预审、重复记录检测、字段异常识别、表间一致性核对和修复计划生成。模型不直接写入数据库。',
  TRUE,
  JSON_OBJECT(
    'profile', 'database-manager',
    'policyVersion', '2026-08-11',
    'scope', 'admin-database-workbench',
    'capabilities', JSON_ARRAY('import_review', 'duplicate_detection', 'field_anomaly_check', 'referential_consistency_check', 'repair_plan'),
    'supportedFormats', JSON_ARRAY('csv', 'txt', 'sql', 'xlsx', 'db'),
    'writeAccess', false,
    'requiresHumanConfirmation', true,
    'maxPreviewRows', 10
  )
)
ON DUPLICATE KEY UPDATE config_key=VALUES(config_key);

INSERT INTO feature_flags(flag_key, display_name, description, enabled, rollout_percentage, audience_json)
VALUES (
  'agent-database-manager',
  '数据库管理 Agent',
  '允许超级管理员在数据库工作台中使用数据审核与核对 Agent。关闭后导入预览仍可用，但不会进入模型审核流程。',
  TRUE,
  100,
  JSON_OBJECT('agentType', 'database-manager', 'audience', 'super_admin')
)
ON DUPLICATE KEY UPDATE flag_key=VALUES(flag_key);
