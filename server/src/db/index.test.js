import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationChecksumForSource } from './index.js';

test('迁移校验和不受 Windows 与 Linux 换行差异影响', () => {
  const lf = "CREATE TABLE example (\n  id BIGINT NOT NULL\n);\n";
  const crlf = "CREATE TABLE example (\r\n  id BIGINT NOT NULL\r\n);\r\n";
  const changed = "CREATE TABLE example (\n  id BIGINT NOT NULL,\n  name VARCHAR(191) NOT NULL\n);\n";

  assert.equal(migrationChecksumForSource(lf), migrationChecksumForSource(crlf));
  assert.notEqual(migrationChecksumForSource(lf), migrationChecksumForSource(changed));
});
