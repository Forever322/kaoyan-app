import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import OpenAI from 'openai';

const BUILTIN_MODEL_HOSTS = new Set(['api.deepseek.com', 'api.openai.com']);
const PROFILE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const PROVIDER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/u;
const MAX_PROFILES = 20;
const CREDENTIAL_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DNS_CACHE_MS = 60_000;
const dnsSafetyCache = new Map();

const SAFE_PROFILE_SELECT = `SELECT
  p.id,p.profile_key,p.display_name,p.provider,p.base_url,p.model,p.temperature,p.max_tokens,
  p.enabled,p.is_default,p.key_last_four,p.credential_version,p.encryption_key_version,p.credential_mode,p.revision,
  (p.encrypted_api_key IS NOT NULL AND p.key_iv IS NOT NULL AND p.key_auth_tag IS NOT NULL) AS key_configured,
  p.updated_by_user_id,u.username AS updated_by_username,p.created_at,p.updated_at
FROM agent_model_profiles p
LEFT JOIN users u ON u.id=p.updated_by_user_id`;

const PRIVATE_PROFILE_SELECT = `SELECT
  p.id,p.profile_key,p.display_name,p.provider,p.base_url,p.model,p.temperature,p.max_tokens,
  p.encrypted_api_key,p.key_iv,p.key_auth_tag,p.key_last_four,p.credential_version,
  p.encryption_key_version,p.credential_mode,p.enabled,p.is_default,p.revision,
  p.updated_by_user_id,u.username AS updated_by_username,p.created_at,p.updated_at
FROM agent_model_profiles p
LEFT JOIN users u ON u.id=p.updated_by_user_id`;

export class AgentModelSettingsError extends Error {
  constructor(message, status = 400, code = 'invalid_agent_model_settings') {
    super(message);
    this.name = 'AgentModelSettingsError';
    this.status = status;
    this.code = code;
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw new AgentModelSettingsError(`${field} 必须是布尔值`);
  return value;
}

function boundedString(value, field, maxLength, { required = true } = {}) {
  if (typeof value !== 'string') throw new AgentModelSettingsError(`${field} 必须是字符串`);
  const text = value.trim();
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
  if ((required && !text) || text.length > maxLength || hasControlCharacter) {
    throw new AgentModelSettingsError(`${field} 格式不合法`);
  }
  return text;
}

function allowedModelHosts(environment = process.env) {
  const hosts = new Set(BUILTIN_MODEL_HOSTS);
  String(environment.AGENT_LLM_ALLOWED_HOSTS || '').split(',').forEach((entry) => {
    const host = entry.trim().toLowerCase().replace(/\.$/u, '');
    if (host && /^[a-z0-9.-]+$/u.test(host) && !host.includes('..')) hosts.add(host);
  });
  return hosts;
}

export function normalizeAgentModelProfileKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!PROFILE_KEY_PATTERN.test(key)) {
    throw new AgentModelSettingsError('profileKey 只能包含小写字母、数字、点、下划线和短横线');
  }
  return key;
}

export function normalizeAgentModelProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDER_PATTERN.test(provider)) throw new AgentModelSettingsError('provider 格式不合法');
  return provider;
}

export function normalizeAgentModelBaseUrl(value, { environment = process.env } = {}) {
  const text = boundedString(value, 'baseUrl', 500);
  let url;
  try { url = new URL(text); } catch {
    throw new AgentModelSettingsError('baseUrl 必须是有效的 HTTPS 地址');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (url.protocol !== 'https:' || !hostname || url.username || url.password || url.search || url.hash) {
    throw new AgentModelSettingsError('baseUrl 仅允许不含账号、查询参数或片段的 HTTPS 地址');
  }
  if (url.port && url.port !== '443') throw new AgentModelSettingsError('baseUrl 仅允许使用 HTTPS 443 端口');
  if (isIP(hostname)) throw new AgentModelSettingsError('baseUrl 不允许使用 IP 地址');
  if (!allowedModelHosts(environment).has(hostname)) {
    throw new AgentModelSettingsError('baseUrl 主机未列入 AGENT_LLM_ALLOWED_HOSTS 白名单', 400, 'model_host_not_allowed');
  }
  url.hostname = hostname;
  url.port = '';
  url.pathname = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
  return url.toString().replace(/\/$/u, '');
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function isPrivateAddress(address, family) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (family === 4 || isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (family !== 6 && isIP(normalized) !== 6) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/u.test(normalized) || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:');
}

export async function assertAgentModelEndpointPublic(baseUrl, {
  lookup = dnsLookup,
  now = Date.now(),
  cache = dnsSafetyCache,
} = {}) {
  const { hostname } = new URL(baseUrl);
  const cached = cache?.get(hostname);
  if (cached && cached.expiresAt > now) return cached.addresses;
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch {
    throw new AgentModelSettingsError('模型服务域名无法解析', 400, 'model_host_unresolvable');
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(({ address, family }) => isPrivateAddress(address, family))) {
    throw new AgentModelSettingsError('模型服务域名解析到了非公网地址', 400, 'model_host_not_public');
  }
  const normalized = addresses.map(({ address, family }) => ({ address, family: Number(family) }));
  cache?.set(hostname, { addresses: normalized, expiresAt: now + DNS_CACHE_MS });
  return normalized;
}

function assertOutboundModelUrl(requestUrl, baseUrl) {
  const candidate = new URL(requestUrl);
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/u, '');
  if (candidate.protocol !== 'https:' || candidate.origin !== base.origin
    || candidate.username || candidate.password || candidate.hash || candidate.search
    || (candidate.pathname !== basePath && !candidate.pathname.startsWith(`${basePath}/`))) {
    throw new AgentModelSettingsError('模型客户端拒绝了非预期的请求地址', 502, 'model_transport_blocked');
  }
  return candidate;
}

/**
 * OpenAI-compatible transport that does not follow redirects and pins each
 * HTTPS request to an address verified as public immediately before connect.
 * TLS still validates the configured hostname through SNI.
 */
export function createPinnedAgentModelFetch(baseUrl, {
  lookup = dnsLookup,
  maxResponseBytes = 2 * 1024 * 1024,
} = {}) {
  return async (input, init = {}) => {
    const inputIsRequest = typeof Request !== 'undefined' && input instanceof Request;
    const candidate = assertOutboundModelUrl(inputIsRequest ? input.url : input, baseUrl);
    const addresses = await assertAgentModelEndpointPublic(baseUrl, { lookup, cache: null });
    const selected = addresses[0];
    const method = init.method || (inputIsRequest ? input.method : 'GET');
    const requestHeaders = new Headers(inputIsRequest ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => requestHeaders.set(key, value));
    const body = init.body;
    const signal = init.signal;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', abort);
        callback(value);
      };
      const request = httpsRequest({
        protocol: 'https:',
        hostname: candidate.hostname,
        port: 443,
        servername: candidate.hostname,
        method,
        path: `${candidate.pathname}${candidate.search}`,
        headers: Object.fromEntries(requestHeaders.entries()),
        lookup(_hostname, options, callback) {
          if (options?.all) callback(null, addresses);
          else callback(null, selected.address, selected.family);
        },
      }, (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxResponseBytes) {
            response.destroy(new Error('model_response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () => finish(reject, new Error('model_transport_failed')));
        response.once('end', () => {
          const headers = new Headers();
          Object.entries(response.headers).forEach(([key, value]) => {
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
            else if (value !== undefined) headers.set(key, String(value));
          });
          finish(resolve, new Response(Buffer.concat(chunks), {
            status: Number(response.statusCode || 502),
            statusText: response.statusMessage || '',
            headers,
          }));
        });
      });
      const abort = () => request.destroy(new Error('model_request_aborted'));
      request.once('error', () => finish(reject, new Error('model_transport_failed')));
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
      if (body !== undefined && body !== null) request.write(body);
      request.end();
    });
  };
}

function encryptionKeyVersion(environment = process.env) {
  const version = String(environment.AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION || 'v1').trim();
  if (!/^[a-z0-9._-]{1,32}$/iu.test(version)) {
    throw new AgentModelSettingsError(
      'AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION 格式不合法',
      503,
      'credential_encryption_unavailable',
    );
  }
  return version;
}

function parseMasterKey(environment = process.env) {
  const configured = String(environment.AGENT_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  let key = null;
  if (/^(?:hex:)?[0-9a-f]{64}$/iu.test(configured)) {
    key = Buffer.from(configured.replace(/^hex:/iu, ''), 'hex');
  } else {
    const encoded = configured.replace(/^base64:/iu, '');
    if (/^[a-z0-9+/_-]+={0,2}$/iu.test(encoded)) {
      try { key = Buffer.from(encoded.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64'); } catch { key = null; }
    }
  }
  if (!key || key.length !== 32) {
    key?.fill(0);
    throw new AgentModelSettingsError(
      '服务器尚未配置有效的 AGENT_CREDENTIAL_ENCRYPTION_KEY',
      503,
      'credential_encryption_unavailable',
    );
  }
  return key;
}

export function isAgentCredentialEncryptionConfigured(environment = process.env) {
  try {
    const key = parseMasterKey(environment);
    key.fill(0);
    return true;
  } catch { return false; }
}

function normalizeApiKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 2048
    || value.trim() !== value || !/^[\x21-\x7e]+$/u.test(value)) {
    throw new AgentModelSettingsError('API Key 格式不合法');
  }
  return value;
}

function credentialAad({ profileKey, provider, baseUrl, version = CREDENTIAL_VERSION, keyVersion }) {
  return Buffer.from(`kaoyan:agent-model-profile:${version}:${keyVersion}:${profileKey}:${provider}:${baseUrl}`, 'utf8');
}

export function encryptAgentModelApiKey(apiKey, profile, { environment = process.env } = {}) {
  const plaintext = normalizeApiKey(apiKey);
  const key = parseMasterKey(environment);
  const keyVersion = encryptionKeyVersion(environment);
  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(credentialAad({ ...profile, keyVersion }));
    const encryptedApiKey = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      encryptedApiKey,
      keyIv: iv,
      keyAuthTag: cipher.getAuthTag(),
      keyLastFour: plaintext.slice(-4),
      credentialVersion: CREDENTIAL_VERSION,
      encryptionKeyVersion: keyVersion,
    };
  } finally {
    key.fill(0);
  }
}

function credentialPartsPresent(row) {
  return Boolean(row?.encrypted_api_key && row?.key_iv && row?.key_auth_tag);
}

export function decryptAgentModelApiKey(row, { environment = process.env } = {}) {
  if (!credentialPartsPresent(row)) {
    throw new AgentModelSettingsError('模型配置尚未保存 API Key', 503, 'missing_llm_key');
  }
  const version = Number(row.credential_version || 0);
  if (version !== CREDENTIAL_VERSION) {
    throw new AgentModelSettingsError('模型凭据版本不受支持', 503, 'credential_version_unsupported');
  }
  const configuredKeyVersion = encryptionKeyVersion(environment);
  if (String(row.encryption_key_version || '') !== configuredKeyVersion) {
    throw new AgentModelSettingsError(
      '模型凭据使用了当前服务器未加载的主密钥版本',
      503,
      'credential_key_version_unavailable',
    );
  }
  const key = parseMasterKey(environment);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.key_iv), { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(credentialAad({
      profileKey: row.profile_key,
      provider: row.provider,
      baseUrl: row.base_url,
      version,
      keyVersion: configuredKeyVersion,
    }));
    decipher.setAuthTag(Buffer.from(row.key_auth_tag));
    return Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_api_key)),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof AgentModelSettingsError) throw error;
    throw new AgentModelSettingsError('模型凭据无法解密，请重新保存 API Key', 503, 'credential_decryption_failed');
  } finally {
    key.fill(0);
  }
}

function numberValue(value, field, { min, max, integer = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new AgentModelSettingsError(`${field} 必须在 ${min}–${max} 范围内${integer ? '且为整数' : ''}`);
  }
  return integer ? value : Math.round(value * 100) / 100;
}

function publicProfile(row) {
  const keyConfigured = hasOwn(row, 'key_configured')
    ? Boolean(Number(row.key_configured))
    : credentialPartsPresent(row);
  const credentialMode = row.credential_mode || 'disabled';
  return {
    id: Number(row.id),
    profileKey: row.profile_key,
    displayName: row.display_name,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    enabled: Boolean(Number(row.enabled)),
    isDefault: Boolean(Number(row.is_default)),
    credentialMode,
    credentialSource: credentialMode,
    keyConfigured,
    keyLastFour: keyConfigured ? String(row.key_last_four || '').slice(-4) : '',
    credentialVersion: keyConfigured ? Number(row.credential_version || CREDENTIAL_VERSION) : null,
    encryptionKeyVersion: keyConfigured ? String(row.encryption_key_version || '') : null,
    canClearKey: credentialMode === 'database' && keyConfigured,
    revision: Number(row.revision || 1),
    updatedBy: row.updated_by_user_id ? {
      id: Number(row.updated_by_user_id),
      username: row.updated_by_username || '',
    } : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function publicAgentModelSettings(db, { environment = process.env } = {}) {
  const rows = await db.all(`${SAFE_PROFILE_SELECT} ORDER BY p.is_default DESC,p.display_name ASC,p.id ASC`);
  const environmentKey = String(environment.LLM_API_KEY || '').trim();
  const environmentView = {
    provider: normalizeAgentModelProvider(environment.LLM_PROVIDER || 'deepseek'),
    baseUrl: normalizeAgentModelBaseUrl(environment.LLM_BASE_URL || 'https://api.deepseek.com/v1', { environment }),
    model: boundedString(environment.AGENT_MODEL || 'deepseek-chat', 'AGENT_MODEL', 128),
    temperature: numberValue(Number(environment.AGENT_TEMPERATURE || 0.35), 'AGENT_TEMPERATURE', { min: 0, max: 1 }),
    maxTokens: numberValue(Number(environment.AGENT_MAX_TOKENS || 1200), 'AGENT_MAX_TOKENS', { min: 128, max: 4_000, integer: true }),
  };
  const data = (rows || []).map((row) => {
    const profile = publicProfile(row);
    if (profile.credentialMode !== 'environment') return profile;
    return {
      ...profile,
      ...environmentView,
      keyConfigured: Boolean(environmentKey),
      keyLastFour: environmentKey ? environmentKey.slice(-4) : '',
      credentialVersion: null,
      encryptionKeyVersion: null,
      canClearKey: false,
    };
  });
  return {
    data,
    defaultProfileKey: data.find((profile) => profile.isDefault && profile.enabled)?.profileKey || '',
    credentialEncryptionConfigured: isAgentCredentialEncryptionConfigured(environment),
    environmentFallbackConfigured: Boolean(String(environment.LLM_API_KEY || '').trim()),
  };
}

function assertKnownFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentModelSettingsError('请求正文必须是对象');
  const allowed = new Set([
    'displayName', 'provider', 'baseUrl', 'model', 'temperature', 'maxTokens',
    'enabled', 'isDefault', 'credentialMode', 'apiKey', 'clearApiKey', 'expectedRevision',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new AgentModelSettingsError(`不支持的配置字段：${unknown.join(', ')}`);
  if (!Object.keys(body).some((key) => key !== 'expectedRevision')) {
    throw new AgentModelSettingsError('没有需要更新的字段');
  }
}

function nextProfileValues(profileKey, current, body, { create, environment }) {
  assertKnownFields(body);
  const next = {
    profileKey,
    displayName: hasOwn(body, 'displayName')
      ? boundedString(body.displayName, 'displayName', 128)
      : (current?.display_name || profileKey),
    provider: hasOwn(body, 'provider')
      ? normalizeAgentModelProvider(body.provider)
      : (current?.provider || ''),
    baseUrl: hasOwn(body, 'baseUrl')
      ? normalizeAgentModelBaseUrl(body.baseUrl, { environment })
      : (current?.base_url || ''),
    model: hasOwn(body, 'model')
      ? boundedString(body.model, 'model', 128)
      : (current?.model || ''),
    temperature: hasOwn(body, 'temperature')
      ? numberValue(body.temperature, 'temperature', { min: 0, max: 1 })
      : Number(current?.temperature ?? 0.2),
    maxTokens: hasOwn(body, 'maxTokens')
      ? numberValue(body.maxTokens, 'maxTokens', { min: 128, max: 4_000, integer: true })
      : Number(current?.max_tokens ?? 1200),
    enabled: hasOwn(body, 'enabled') ? booleanValue(body.enabled, 'enabled') : (current ? Boolean(Number(current.enabled)) : true),
    isDefault: hasOwn(body, 'isDefault') ? booleanValue(body.isDefault, 'isDefault') : (current ? Boolean(Number(current.is_default)) : false),
    credentialMode: hasOwn(body, 'credentialMode')
      ? String(body.credentialMode || '').trim().toLowerCase()
      : (hasOwn(body, 'apiKey') ? 'database' : (current?.credential_mode || 'disabled')),
  };
  if (create && (!next.provider || !next.baseUrl || !next.model)) {
    throw new AgentModelSettingsError('新模型配置必须填写 provider、baseUrl 和 model');
  }
  if (next.isDefault && !next.enabled) throw new AgentModelSettingsError('默认模型配置必须保持启用');
  if (!['database', 'environment', 'disabled'].includes(next.credentialMode)) {
    throw new AgentModelSettingsError('credentialMode 只能是 database、environment 或 disabled');
  }
  if (current && Boolean(Number(current.is_default)) && !next.isDefault) {
    throw new AgentModelSettingsError('请先把另一个模型配置设为默认，再取消当前默认配置');
  }
  return next;
}

async function withTransaction(db, callback) {
  return typeof db.transaction === 'function' ? db.transaction(callback) : callback(db);
}

export async function saveAgentModelProfile(db, {
  profileKey,
  body,
  actorUserId,
  create = false,
  environment = process.env,
  endpointGuard = assertAgentModelEndpointPublic,
  credentialValidator = testAgentModelConnection,
  onSaved = null,
} = {}) {
  const normalizedKey = normalizeAgentModelProfileKey(profileKey);
  const preflightCurrent = await db.one(`${PRIVATE_PROFILE_SELECT} WHERE p.profile_key=?`, [normalizedKey]);
  if (!preflightCurrent && !create) {
    throw new AgentModelSettingsError('模型配置不存在', 404, 'agent_model_profile_not_found');
  }
  const preflightNext = nextProfileValues(normalizedKey, preflightCurrent, body, {
    create: !preflightCurrent,
    environment,
  });
  if (preflightCurrent) {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
      throw new AgentModelSettingsError('更新模型配置必须提供有效的 expectedRevision');
    }
    if (body.expectedRevision !== Number(preflightCurrent.revision)) {
      throw new AgentModelSettingsError('模型配置已被其他管理员修改，请刷新后重试', 409, 'agent_model_profile_conflict');
    }
  } else if (hasOwn(body, 'expectedRevision') && body.expectedRevision !== 0) {
    throw new AgentModelSettingsError('新模型配置的 expectedRevision 必须为 0');
  }
  if (hasOwn(body, 'apiKey') && hasOwn(body, 'clearApiKey')) {
    throw new AgentModelSettingsError('apiKey 与 clearApiKey 不能同时设置');
  }
  if (hasOwn(body, 'clearApiKey') && body.clearApiKey !== true) {
    throw new AgentModelSettingsError('clearApiKey 只能设置为 true');
  }
  if (body.clearApiKey === true && hasOwn(body, 'credentialMode') && preflightNext.credentialMode !== 'disabled') {
    throw new AgentModelSettingsError('清除 API Key 时 credentialMode 必须是 disabled');
  }
  if (hasOwn(body, 'apiKey') && hasOwn(body, 'credentialMode') && preflightNext.credentialMode !== 'database') {
    throw new AgentModelSettingsError('提交 API Key 时 credentialMode 必须是 database');
  }
  const intendedCredentialMode = body.clearApiKey === true
    ? 'disabled'
    : (hasOwn(body, 'apiKey') ? 'database' : preflightNext.credentialMode);
  if (preflightCurrent?.credential_mode === 'database'
    && intendedCredentialMode !== 'database' && body.clearApiKey !== true) {
    throw new AgentModelSettingsError('停用或切换数据库凭据前必须显式设置 clearApiKey=true');
  }
  const providerOrEndpointChanged = preflightCurrent && (
    preflightCurrent.provider !== preflightNext.provider || preflightCurrent.base_url !== preflightNext.baseUrl
  );
  const connectionChanged = providerOrEndpointChanged
    || (preflightCurrent && preflightCurrent.model !== preflightNext.model);
  if (preflightCurrent?.credential_mode === 'environment' && connectionChanged && !hasOwn(body, 'apiKey')) {
    throw new AgentModelSettingsError('环境凭据模式使用服务器环境中的整套模型配置；修改连接参数时必须重新输入 API Key');
  }
  if (providerOrEndpointChanged && credentialPartsPresent(preflightCurrent) && !hasOwn(body, 'apiKey')) {
    throw new AgentModelSettingsError('修改 provider 或 baseUrl 时必须重新输入 API Key');
  }
  let connectionValidated = false;
  if (hasOwn(body, 'apiKey')) {
    await endpointGuard(preflightNext.baseUrl);
    await credentialValidator({
      profileKey: normalizedKey,
      profileRevision: Number(preflightCurrent?.revision || 0),
      credentialVersion: CREDENTIAL_VERSION,
      provider: preflightNext.provider,
      baseUrl: preflightNext.baseUrl,
      model: preflightNext.model,
      apiKey: normalizeApiKey(body.apiKey),
      source: 'submitted',
      temperature: preflightNext.temperature,
      maxTokens: preflightNext.maxTokens,
    });
    connectionValidated = true;
  } else if (connectionChanged && intendedCredentialMode === 'database' && credentialPartsPresent(preflightCurrent)) {
    await endpointGuard(preflightNext.baseUrl);
    await credentialValidator({
      profileKey: normalizedKey,
      profileRevision: Number(preflightCurrent.revision || 1),
      credentialVersion: Number(preflightCurrent.credential_version || CREDENTIAL_VERSION),
      provider: preflightNext.provider,
      baseUrl: preflightNext.baseUrl,
      model: preflightNext.model,
      apiKey: decryptAgentModelApiKey(preflightCurrent, { environment }),
      source: 'database',
      temperature: preflightNext.temperature,
      maxTokens: preflightNext.maxTokens,
    });
    connectionValidated = true;
  }

  return withTransaction(db, async (tx) => {
    const lockedProfiles = await tx.all('SELECT id FROM agent_model_profiles ORDER BY id FOR UPDATE');
    const current = await tx.one(`${PRIVATE_PROFILE_SELECT} WHERE p.profile_key=?`, [normalizedKey]);
    if (!current && !create) throw new AgentModelSettingsError('模型配置不存在', 404, 'agent_model_profile_not_found');
    if (!current && lockedProfiles.length >= MAX_PROFILES) throw new AgentModelSettingsError(`模型配置最多允许 ${MAX_PROFILES} 个`);
    const next = nextProfileValues(normalizedKey, current, body, { create: !current, environment });
    if (hasOwn(body, 'apiKey')) next.credentialMode = 'database';
    if (body.clearApiKey === true) next.credentialMode = 'disabled';

    if (current) {
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
        throw new AgentModelSettingsError('更新模型配置必须提供有效的 expectedRevision');
      }
      if (body.expectedRevision !== Number(current.revision)) {
        throw new AgentModelSettingsError('模型配置已被其他管理员修改，请刷新后重试', 409, 'agent_model_profile_conflict');
      }
    } else if (hasOwn(body, 'expectedRevision') && body.expectedRevision !== 0) {
      throw new AgentModelSettingsError('新模型配置的 expectedRevision 必须为 0');
    }

    const endpointChanged = current && (current.provider !== next.provider || current.base_url !== next.baseUrl);
    if (endpointChanged && credentialPartsPresent(current) && !hasOwn(body, 'apiKey')) {
      throw new AgentModelSettingsError('修改 provider 或 baseUrl 时必须重新输入 API Key');
    }

    let credentials = current ? {
      encryptedApiKey: current.encrypted_api_key,
      keyIv: current.key_iv,
      keyAuthTag: current.key_auth_tag,
      keyLastFour: current.key_last_four || '',
      credentialVersion: Number(current.credential_version || CREDENTIAL_VERSION),
      encryptionKeyVersion: current.encryption_key_version || encryptionKeyVersion(environment),
    } : {
      encryptedApiKey: null, keyIv: null, keyAuthTag: null, keyLastFour: '',
      credentialVersion: CREDENTIAL_VERSION, encryptionKeyVersion: encryptionKeyVersion(environment),
    };
    if (hasOwn(body, 'apiKey')) {
      credentials = encryptAgentModelApiKey(body.apiKey, {
        profileKey: normalizedKey, provider: next.provider, baseUrl: next.baseUrl,
      }, { environment });
    } else if (next.credentialMode !== 'database') {
      credentials = {
        encryptedApiKey: null, keyIv: null, keyAuthTag: null, keyLastFour: '',
        credentialVersion: CREDENTIAL_VERSION, encryptionKeyVersion: encryptionKeyVersion(environment),
      };
    }
    if (next.credentialMode === 'database' && !credentials.encryptedApiKey) {
      throw new AgentModelSettingsError('credentialMode=database 时必须保存 API Key');
    }

    if (next.isDefault) {
      await tx.execute(`UPDATE agent_model_profiles SET is_default=FALSE,revision=revision+1
        WHERE is_default=TRUE AND profile_key<>?`, [normalizedKey]);
    }
    if (current) {
      const updated = await tx.execute(`UPDATE agent_model_profiles SET
        display_name=?,provider=?,base_url=?,model=?,temperature=?,max_tokens=?,
        encrypted_api_key=?,key_iv=?,key_auth_tag=?,key_last_four=?,credential_version=?,encryption_key_version=?,credential_mode=?,
        enabled=?,is_default=?,updated_by_user_id=?,revision=revision+1 WHERE profile_key=? AND revision=?`, [
        next.displayName, next.provider, next.baseUrl, next.model, next.temperature, next.maxTokens,
        credentials.encryptedApiKey, credentials.keyIv, credentials.keyAuthTag, credentials.keyLastFour,
        credentials.credentialVersion, credentials.encryptionKeyVersion, next.credentialMode,
        next.enabled, next.isDefault, actorUserId, normalizedKey, Number(current.revision),
      ]);
      if (Number(updated.affectedRows || 0) !== 1) {
        throw new AgentModelSettingsError('模型配置已被其他管理员修改，请刷新后重试', 409, 'agent_model_profile_conflict');
      }
    } else {
      await tx.execute(`INSERT INTO agent_model_profiles(
        profile_key,display_name,provider,base_url,model,temperature,max_tokens,
        encrypted_api_key,key_iv,key_auth_tag,key_last_four,credential_version,encryption_key_version,credential_mode,
        enabled,is_default,updated_by_user_id,revision
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        normalizedKey, next.displayName, next.provider, next.baseUrl, next.model, next.temperature, next.maxTokens,
        credentials.encryptedApiKey, credentials.keyIv, credentials.keyAuthTag, credentials.keyLastFour,
        credentials.credentialVersion, credentials.encryptionKeyVersion, next.credentialMode,
        next.enabled, next.isDefault, actorUserId, 1,
      ]);
    }
    const fresh = await tx.one(`${PRIVATE_PROFILE_SELECT} WHERE p.profile_key=?`, [normalizedKey]);
    const saved = publicProfile(fresh);
    if (onSaved) await onSaved(tx, {
      before: current ? publicProfile(current) : null,
      after: saved,
      connectionValidated,
    });
    return saved;
  });
}

function environmentRuntime(environment) {
  const configuredApiKey = String(environment.LLM_API_KEY || '').trim();
  const apiKey = configuredApiKey ? normalizeApiKey(configuredApiKey) : '';
  if (!apiKey) throw new AgentModelSettingsError('尚未配置可用的模型 API Key', 503, 'missing_llm_key');
  return {
    profileKey: '',
    profileRevision: 0,
    credentialVersion: null,
    provider: normalizeAgentModelProvider(environment.LLM_PROVIDER || 'deepseek'),
    baseUrl: normalizeAgentModelBaseUrl(environment.LLM_BASE_URL || 'https://api.deepseek.com/v1', { environment }),
    model: boundedString(environment.AGENT_MODEL || 'deepseek-chat', 'AGENT_MODEL', 128),
    apiKey,
    source: 'environment',
    temperature: numberValue(Number(environment.AGENT_TEMPERATURE || 0.35), 'AGENT_TEMPERATURE', { min: 0, max: 1 }),
    maxTokens: numberValue(Number(environment.AGENT_MAX_TOKENS || 1200), 'AGENT_MAX_TOKENS', { min: 128, max: 4_000, integer: true }),
  };
}

export async function resolveAgentModelRuntime(db, {
  profileKey = '',
  environment = process.env,
  endpointGuard = assertAgentModelEndpointPublic,
} = {}) {
  const requestedKey = profileKey ? normalizeAgentModelProfileKey(profileKey) : '';
  const row = requestedKey
    ? await db.one(`${PRIVATE_PROFILE_SELECT} WHERE p.profile_key=? AND p.enabled=TRUE`, [requestedKey])
    : await db.one(`${PRIVATE_PROFILE_SELECT} WHERE p.enabled=TRUE ORDER BY p.is_default DESC,p.id ASC LIMIT 1`);
  if (requestedKey && !row) throw new AgentModelSettingsError('模型配置不存在或未启用', 503, 'agent_model_profile_unavailable');
  if (!row) {
    const fallback = environmentRuntime(environment);
    await endpointGuard(fallback.baseUrl);
    return { ...fallback, fetch: createPinnedAgentModelFetch(fallback.baseUrl) };
  }
  const credentialMode = row.credential_mode || 'disabled';
  if (credentialMode === 'environment') {
    const fallback = environmentRuntime(environment);
    await endpointGuard(fallback.baseUrl);
    return {
      ...fallback,
      profileKey: row.profile_key,
      profileRevision: Number(row.revision || 1),
      fetch: createPinnedAgentModelFetch(fallback.baseUrl),
    };
  }
  if (credentialMode !== 'database' || !credentialPartsPresent(row)) {
    throw new AgentModelSettingsError('模型配置当前未启用凭据', 503, 'missing_llm_key');
  }
  const baseUrl = normalizeAgentModelBaseUrl(row.base_url, { environment });
  await endpointGuard(baseUrl);
  return {
    profileKey: row.profile_key,
    profileRevision: Number(row.revision || 1),
    credentialVersion: Number(row.credential_version || CREDENTIAL_VERSION),
    provider: normalizeAgentModelProvider(row.provider),
    baseUrl,
    model: boundedString(row.model, 'model', 128),
    apiKey: decryptAgentModelApiKey(row, { environment }),
    source: 'database',
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    fetch: createPinnedAgentModelFetch(baseUrl),
  };
}

export async function resolveAgentModelConnectionTest(db, body = {}, options = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentModelSettingsError('请求正文必须是对象');
  const allowed = new Set(['profileKey', 'provider', 'baseUrl', 'model', 'apiKey']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new AgentModelSettingsError(`不支持的测试字段：${unknown.join(', ')}`);
  const environment = options.environment || process.env;
  const profileKey = body.profileKey ? normalizeAgentModelProfileKey(body.profileKey) : '';
  const row = profileKey
    ? await db.one(`${PRIVATE_PROFILE_SELECT} WHERE p.profile_key=?`, [profileKey])
    : await db.one(`${PRIVATE_PROFILE_SELECT} WHERE p.is_default=TRUE ORDER BY p.id ASC LIMIT 1`);
  const hasOverrides = ['provider', 'baseUrl', 'model'].some((field) => hasOwn(body, field));
  if (hasOwn(body, 'apiKey')) {
    const provider = hasOwn(body, 'provider') ? normalizeAgentModelProvider(body.provider) : row?.provider;
    const baseUrl = hasOwn(body, 'baseUrl')
      ? normalizeAgentModelBaseUrl(body.baseUrl, { environment })
      : row?.base_url;
    const model = hasOwn(body, 'model') ? boundedString(body.model, 'model', 128) : row?.model;
    if (!provider || !baseUrl || !model) throw new AgentModelSettingsError('测试连接缺少 provider、baseUrl 或 model');
    await (options.endpointGuard || assertAgentModelEndpointPublic)(baseUrl);
    return {
      profileKey: row?.profile_key || profileKey,
      provider,
      baseUrl,
      model,
      apiKey: normalizeApiKey(body.apiKey),
      source: 'submitted',
    };
  }
  if (hasOverrides) throw new AgentModelSettingsError('测试未保存的地址或模型时必须重新输入 API Key');
  if (!row || row.credential_mode === 'environment') {
    const fallback = environmentRuntime(environment);
    await (options.endpointGuard || assertAgentModelEndpointPublic)(fallback.baseUrl);
    return { ...fallback, profileKey: row?.profile_key || profileKey };
  }
  if (row.credential_mode !== 'database' || !credentialPartsPresent(row)) {
    throw new AgentModelSettingsError('测试连接需要 API Key', 400, 'missing_llm_key');
  }
  const baseUrl = normalizeAgentModelBaseUrl(row.base_url, { environment });
  await (options.endpointGuard || assertAgentModelEndpointPublic)(baseUrl);
  return {
    profileKey: row.profile_key,
    provider: normalizeAgentModelProvider(row.provider),
    baseUrl,
    model: boundedString(row.model, 'model', 128),
    apiKey: decryptAgentModelApiKey(row, { environment }),
    source: 'database',
  };
}

export async function testAgentModelConnection(runtime, {
  OpenAIClient = OpenAI,
  timeoutMs = Number(process.env.AGENT_MODEL_TEST_TIMEOUT_MS || 10_000),
  fetchFactory = createPinnedAgentModelFetch,
} = {}) {
  const timeout = Math.min(15_000, Math.max(3_000, Number(timeoutMs) || 10_000));
  const startedAt = Date.now();
  try {
    const client = new OpenAIClient({
      apiKey: runtime.apiKey,
      baseURL: runtime.baseUrl,
      timeout,
      maxRetries: 0,
      fetch: fetchFactory(runtime.baseUrl),
    });
    await client.chat.completions.create({
      model: runtime.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      max_tokens: 1,
    });
    return {
      ok: true,
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    throw new AgentModelSettingsError('模型连接测试失败，请检查地址、模型和 API Key', 502, 'model_connection_failed');
  }
}
