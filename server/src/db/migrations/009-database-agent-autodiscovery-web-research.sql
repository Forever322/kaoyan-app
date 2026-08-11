-- Database Manager Agent automatic table routing and server-managed web research.
-- Outbound endpoints and credentials remain environment-only; this metadata is
-- descriptive and cannot grant model-side write access.

UPDATE agent_configurations
SET description='后台专用数据摄取与审核助手：可根据字段和语义自动识别可写参考数据表，结合受限网页搜索/抓取做交叉核验；模型只能形成待确认草稿。',
    updated_by_user_id=NULL,
    settings_json=JSON_SET(
      COALESCE(settings_json, JSON_OBJECT()),
      '$.profile', 'database-manager',
      '$.policyVersion', '2026-08-11.4',
      '$.scope', 'admin-database-workbench',
      '$.capabilities', JSON_ARRAY(
        'natural_language_ingest',
        'file_ingest',
        'table_autodetect',
        'content_review',
        'web_search',
        'web_fetch',
        'web_evidence_review',
        'duplicate_detection',
        'field_anomaly_check',
        'referential_consistency_check',
        'repair_plan',
        'operational_alerting'
      ),
      '$.supportedFormats', JSON_ARRAY('csv', 'txt', 'json', 'sql', 'xlsx', 'db'),
      '$.autoTableDetection', TRUE,
      '$.webResearch', JSON_OBJECT(
        'serverManaged', TRUE,
        'requiresEnvironmentConfiguration', TRUE,
        'usesPublicHttpOnly', TRUE,
        'requiresHumanConfirmation', TRUE
      ),
      '$.writeAccess', FALSE,
      '$.requiresHumanConfirmation', TRUE,
      '$.maxPreviewRows', 20,
      '$.stagingTtlHours', 24
    )
WHERE config_key='database-manager';
