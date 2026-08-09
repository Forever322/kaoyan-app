-- One logical data-quality issue must have one lifecycle record.  Version 003
-- included status in its unique key, which allowed a resolved row and a new
-- open row for the same issue to coexist and then collide on a later resolve.
-- Keep the newest record during upgrade; the next seed run reopens it if the
-- source condition still exists.

DELETE older
FROM catalog_data_issues older
INNER JOIN catalog_data_issues newer
  ON newer.entity_type=older.entity_type
  AND newer.entity_key=older.entity_key
  AND newer.issue_code=older.issue_code
  AND newer.id>older.id;

ALTER TABLE catalog_data_issues
  DROP INDEX uq_catalog_data_issues_identity;

ALTER TABLE catalog_data_issues
  ADD UNIQUE KEY uq_catalog_data_issues_identity (entity_type, entity_key, issue_code);
