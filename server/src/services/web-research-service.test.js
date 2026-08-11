import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWebResearchQueries,
  collectAdminAgentWebEvidence,
  extractPublicUrls,
  isWebResearchConfigured,
} from './web-research-service.js';

test('联网核验配置默认关闭且可从环境开启', () => {
  assert.equal(isWebResearchConfigured({}), false);
  assert.equal(isWebResearchConfigured({
    ADMIN_AGENT_WEB_RESEARCH_ENABLED: 'true',
    ADMIN_AGENT_WEB_SEARCH_ENDPOINT: 'https://search.example.test/api',
  }), true);
});

test('联网核验会执行搜索、抓取公网网页并提取摘要', async () => {
  const calls = [];
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://search.example.test')) {
      return new Response(JSON.stringify({
        results: [{
          title: '测试大学研究生招生网',
          url: 'https://yz.example.test/news',
          snippet: '2026 年招生简章',
        }],
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('<html><title>招生简章</title><body>测试大学 2026 年硕士研究生招生简章。</body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const evidence = await collectAdminAgentWebEvidence({
    instruction: '核验测试大学 2026 年招生简章',
    table: 'programs',
    environment: {
      ADMIN_AGENT_WEB_RESEARCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_SEARCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_FETCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_SEARCH_ENDPOINT: 'https://search.example.test/api',
      ADMIN_AGENT_WEB_MAX_QUERIES: '1',
      ADMIN_AGENT_WEB_MAX_RESULTS: '1',
      ADMIN_AGENT_WEB_FETCH_MAX_PAGES: '1',
    },
    fetcher,
    lookup,
  });

  assert.equal(evidence.enabled, true);
  assert.equal(evidence.results.length, 1);
  assert.equal(evidence.pages.length, 1);
  assert.match(evidence.pages[0].excerpt, /测试大学/u);
  assert.equal(calls.length, 2);
});

test('webfetch 拒绝内网地址并只把错误作为审核证据', async () => {
  const evidence = await collectAdminAgentWebEvidence({
    instruction: '来源 http://127.0.0.1/admin',
    table: 'universities',
    environment: {
      ADMIN_AGENT_WEB_RESEARCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_SEARCH_ENABLED: 'false',
      ADMIN_AGENT_WEB_FETCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_FETCH_MAX_PAGES: '1',
    },
    fetcher: async () => {
      throw new Error('fetch should not be called');
    },
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });

  assert.equal(evidence.pages.length, 0);
  assert.equal(evidence.errors.length, 1);
  assert.match(evidence.errors[0].message, /私有|保留/u);
});

test('webfetch 拒绝 IPv4-mapped IPv6 内网解析结果', async () => {
  const evidence = await collectAdminAgentWebEvidence({
    instruction: '来源 https://mapped.example.test/admin',
    table: 'universities',
    environment: {
      ADMIN_AGENT_WEB_RESEARCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_SEARCH_ENABLED: 'false',
      ADMIN_AGENT_WEB_FETCH_ENABLED: 'true',
      ADMIN_AGENT_WEB_FETCH_MAX_PAGES: '1',
    },
    fetcher: async () => {
      throw new Error('fetch should not be called');
    },
    lookup: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
  });

  assert.equal(evidence.pages.length, 0);
  assert.equal(evidence.errors.length, 1);
  assert.match(evidence.errors[0].message, /私有|保留/u);
});

test('联网查询会优先使用显式 URL 和业务字段构造有限查询', () => {
  assert.deepEqual(extractPublicUrls('官网 https://yz.example.edu.cn/zs 以及 http://example.edu/path。').length, 2);
  const queries = buildWebResearchQueries({
    instruction: '北京示例大学 计算机学院 招生目录',
    table: 'programs',
    rows: [{ name: '计算机科学与技术', code: '081200', university_id: 1 }],
  }, { maxQueries: 3 });
  assert.equal(queries.length, 3);
  assert.ok(queries.some((query) => query.includes('考研')));
});
