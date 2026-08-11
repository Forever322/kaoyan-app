import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_QUERIES = 4;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_QUERY_LENGTH = 240;

function booleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function boundedText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export function webResearchConfig(environment = process.env) {
  const enabled = booleanEnv(environment.ADMIN_AGENT_WEB_RESEARCH_ENABLED);
  const searchEnabled = enabled && booleanEnv(environment.ADMIN_AGENT_WEB_SEARCH_ENABLED, true);
  const fetchEnabled = enabled && booleanEnv(environment.ADMIN_AGENT_WEB_FETCH_ENABLED, true);
  const provider = boundedText(environment.ADMIN_AGENT_WEB_SEARCH_PROVIDER || 'generic', 32).toLowerCase();
  const endpoint = boundedText(environment.ADMIN_AGENT_WEB_SEARCH_ENDPOINT, 500);
  const apiKey = String(environment.ADMIN_AGENT_WEB_SEARCH_API_KEY || '').trim();
  const allowedHosts = String(environment.ADMIN_AGENT_WEB_FETCH_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return {
    enabled,
    searchEnabled,
    fetchEnabled,
    provider,
    endpoint,
    apiKey,
    keyHeader: boundedText(environment.ADMIN_AGENT_WEB_SEARCH_KEY_HEADER || 'Authorization', 80),
    allowedHosts,
    timeoutMs: boundedInteger(environment.ADMIN_AGENT_WEB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 30_000),
    maxQueries: boundedInteger(environment.ADMIN_AGENT_WEB_MAX_QUERIES, DEFAULT_MAX_QUERIES, 1, 8),
    maxResults: boundedInteger(environment.ADMIN_AGENT_WEB_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, 20),
    maxPages: boundedInteger(environment.ADMIN_AGENT_WEB_FETCH_MAX_PAGES, DEFAULT_MAX_PAGES, 0, 8),
    maxBytes: boundedInteger(environment.ADMIN_AGENT_WEB_FETCH_MAX_BYTES, DEFAULT_MAX_BYTES, 16 * 1024, 2 * 1024 * 1024),
  };
}

export function isWebResearchConfigured(environment = process.env) {
  const config = webResearchConfig(environment);
  return config.enabled && (config.fetchEnabled || (config.searchEnabled && Boolean(config.endpoint)));
}

function uniqueStrings(values, limit, maxLength = MAX_QUERY_LENGTH) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = boundedText(value, maxLength);
    if (!text) continue;
    const key = text.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

export function extractPublicUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'）)]+/giu) || [];
  return uniqueStrings(matches.map((url) => url.replace(/[，。；、]+$/u, '')), 8, 500);
}

export function buildWebResearchQueries({ instruction = '', table = '', rows = [], queries = [] } = {}, config = webResearchConfig()) {
  const values = Array.isArray(rows)
    ? rows.slice(0, 8).flatMap((row) => Object.entries(row || {})
      .filter(([field]) => /(?:name|title|code|category|degree|year|province|university|program|subject|score)/iu.test(field))
      .map(([, value]) => value))
    : [];
  const tableHint = {
    universities: '考研 院校 官方',
    programs: '考研 招生专业目录 官方',
    program_offerings: '考研 招生计划 官方',
    admission_scores: '考研 录取分数 官方',
    national_lines: '考研 国家线 官方',
    uni_requirements: '考研 报考要求 官方',
    score_lines: '考研 复试分数线 官方',
    retest_rules: '考研 复试办法 官方',
  }[table] || '考研 官方资料';
  return uniqueStrings([
    ...(Array.isArray(queries) ? queries : []),
    ...values.slice(0, 3).map((value) => `${value} ${tableHint}`),
    instruction,
  ], config.maxQueries);
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 168].includes(b))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0);
}

function privateIpv6(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, '');
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (mappedIpv4) return privateIpv4(mappedIpv4[1]);
  if (normalized.startsWith('::ffff:')) return true;
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('2001:db8')
    || normalized.startsWith('2001:0db8');
}

function privateAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? privateIpv4(address) : family === 6 ? privateIpv6(address) : true;
}

function hostAllowed(hostname, allowedHosts) {
  if (!allowedHosts.length) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function assertPublicUrl(rawUrl, config, lookup = dns.lookup) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('网页地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('网页地址只允许 HTTP(S)');
  if (url.username || url.password) throw new Error('网页地址不能包含账号或密码');
  if (!hostAllowed(url.hostname, config.allowedHosts)) throw new Error('网页地址不在允许的主机范围内');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('拒绝访问本地主机或内部域名');
  }
  if (net.isIP(hostname) && privateAddress(hostname)) throw new Error('拒绝访问私有或保留 IP');
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses?.length || addresses.some((item) => privateAddress(item.address))) {
    throw new Error('网页域名解析到了私有或保留地址');
  }
  return url;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function searchUrl(config, query) {
  const endpoint = config.endpoint;
  if (!endpoint) return null;
  if (config.provider === 'generic') {
    if (endpoint.includes('{query}')) return endpoint.replaceAll('{query}', encodeURIComponent(query));
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    return url.toString();
  }
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  if (config.provider === 'bing' || config.provider === 'brave') {
    url.searchParams.set('count', String(config.maxResults));
  }
  return url.toString();
}

function searchHeaders(config) {
  const headers = { accept: 'application/json', 'user-agent': 'kaoyan-admin-agent/1.0' };
  if (!config.apiKey) return headers;
  if (config.provider === 'bing') headers['Ocp-Apim-Subscription-Key'] = config.apiKey;
  else if (config.provider === 'brave') headers['X-Subscription-Token'] = config.apiKey;
  else if (config.keyHeader.toLowerCase() === 'authorization') headers.authorization = `Bearer ${config.apiKey}`;
  else headers[config.keyHeader] = config.apiKey;
  if (config.provider === 'serper') headers['X-API-KEY'] = config.apiKey;
  return headers;
}

function normalizeSearchResults(payload, provider, maxResults) {
  const candidates = provider === 'bing'
    ? payload?.webPages?.value
    : provider === 'serper'
      ? payload?.organic
      : provider === 'brave'
        ? payload?.web?.results
        : payload?.results || payload?.items || payload?.data?.results || payload?.webPages?.value;
  if (!Array.isArray(candidates)) return [];
  return candidates.map((item) => ({
    title: boundedText(item.title || item.name, 300),
    url: boundedText(item.url || item.link || item.href, 500),
    snippet: boundedText(item.snippet || item.description || item.content, 600),
    provider,
  })).filter((item) => /^https?:\/\//iu.test(item.url)).slice(0, maxResults);
}

async function searchWeb(query, config, fetcher, lookup) {
  const searchEndpointConfig = { ...config, allowedHosts: [] };
  if (config.provider === 'serper') {
    if (!config.endpoint) return [];
    await assertPublicUrl(config.endpoint, searchEndpointConfig, lookup);
    const signal = timeoutSignal(config.timeoutMs);
    try {
      const response = await fetcher(config.endpoint, {
        method: 'POST',
        headers: { ...searchHeaders(config), 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, num: config.maxResults }),
        redirect: 'manual',
        signal: signal.signal,
      });
      if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`);
      return normalizeSearchResults(await response.json(), config.provider, config.maxResults);
    } finally {
      signal.clear();
    }
  }
  const url = searchUrl(config, query);
  if (!url) return [];
  await assertPublicUrl(url, searchEndpointConfig, lookup);
  const signal = timeoutSignal(config.timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: searchHeaders(config),
      redirect: 'manual',
      signal: signal.signal,
    });
    if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`);
    return normalizeSearchResults(await response.json(), config.provider, config.maxResults);
  } finally {
    signal.clear();
  }
}

function htmlToText(content) {
  return String(content || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

async function fetchPublicPage(rawUrl, config, fetcher, lookup) {
  let currentUrl = rawUrl;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const url = await assertPublicUrl(currentUrl, config, lookup);
    const signal = timeoutSignal(config.timeoutMs);
    try {
      const response = await fetcher(url.toString(), {
        headers: { accept: 'text/html,application/json,text/plain;q=0.9', 'user-agent': 'kaoyan-admin-agent/1.0' },
        redirect: 'manual',
        signal: signal.signal,
      });
      if (response.status >= 300 && response.status < 400 && response.headers?.get('location')) {
        currentUrl = new URL(response.headers.get('location'), url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`网页返回 HTTP ${response.status}`);
      const contentLength = Number(response.headers?.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > config.maxBytes) {
        throw new Error('网页内容超过抓取大小限制');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > config.maxBytes) throw new Error('网页内容超过抓取大小限制');
      const contentType = response.headers?.get('content-type') || '';
      const raw = new TextDecoder().decode(bytes);
      const title = contentType.includes('html')
        ? htmlToText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || '')
        : '';
      const text = contentType.includes('html') ? htmlToText(raw) : contentType.includes('json') ? raw : raw;
      return {
        url: url.toString(),
        status: response.status,
        contentType: boundedText(contentType, 120),
        title: boundedText(title, 300),
        excerpt: boundedText(text, 4_000),
      };
    } finally {
      signal.clear();
    }
  }
  throw new Error('网页重定向次数超过限制');
}

function mergeEvidence(primary, secondary) {
  const result = primary || { enabled: false, queries: [], results: [], pages: [], errors: [] };
  const next = secondary || {};
  const uniqueByUrl = (items) => [...new Map(items.filter((item) => item?.url).map((item) => [item.url, item])).values()];
  return {
    enabled: result.enabled || next.enabled || false,
    searchEnabled: result.searchEnabled || next.searchEnabled || false,
    fetchEnabled: result.fetchEnabled || next.fetchEnabled || false,
    queries: uniqueStrings([...(result.queries || []), ...(next.queries || [])], 8),
    results: uniqueByUrl([...(result.results || []), ...(next.results || [])]).slice(0, 20),
    pages: uniqueByUrl([...(result.pages || []), ...(next.pages || [])]).slice(0, 8),
    errors: [...(result.errors || []), ...(next.errors || [])].slice(0, 20),
  };
}

export async function collectAdminAgentWebEvidence({
  instruction = '',
  table = '',
  rows = [],
  queries = [],
  environment = process.env,
  fetcher = globalThis.fetch,
  lookup = dns.lookup,
} = {}) {
  const config = webResearchConfig(environment);
  const requestedQueries = buildWebResearchQueries({ instruction, table, rows, queries }, config);
  const evidence = {
    enabled: config.enabled,
    searchEnabled: config.searchEnabled,
    fetchEnabled: config.fetchEnabled,
    queries: requestedQueries,
    results: [],
    pages: [],
    errors: [],
  };
  if (!config.enabled || typeof fetcher !== 'function') return evidence;

  if (config.searchEnabled && config.endpoint) {
    for (const query of requestedQueries) {
      try {
        const results = await searchWeb(query, config, fetcher, lookup);
        evidence.results.push(...results);
      } catch (error) {
        evidence.errors.push({ stage: 'search', query, message: boundedText(error.message, 300) });
      }
    }
  }

  if (config.fetchEnabled && config.maxPages > 0) {
    const urls = uniqueStrings([
      ...extractPublicUrls(instruction),
      ...evidence.results.map((item) => item.url),
    ], config.maxPages, 500);
    for (const url of urls) {
      try {
        evidence.pages.push(await fetchPublicPage(url, config, fetcher, lookup));
      } catch (error) {
        evidence.errors.push({ stage: 'fetch', url, message: boundedText(error.message, 300) });
      }
    }
  }

  return mergeEvidence(null, evidence);
}

export { mergeEvidence };
