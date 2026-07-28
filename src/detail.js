//院校详情页模块

import { getUniversityDetail } from './data/uni-details.js';
import { renderPhotos } from './photos.js';
import { ADMISSION_SCORES } from './data/admission-scores.js';
import { getAllYearLines, hasSubMajors, getSubjectLines } from './data/national-lines.js';
import { buildScoreTableRows } from './render.js';
import { escapeHtml } from './utils.js';

/** 打开院校详情页 */
export function openDetailPage(result, { degree, zone }) {
  const { university: uni, admissionScores, verdict, verdictClass } = result;
  const detail = getUniversityDetail(uni.name);
  const userScore = parseInt(document.getElementById('scoreInput').value) || 0;
  const category = document.getElementById('categorySelect').value;
  const allNL = getAllYearLines(degree, category, zone === 'all' ? 'A' : zone);
  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;

  // 顶部渐变
  const hero = document.getElementById('detailHero');
  hero.style.background = `linear-gradient(135deg, ${detail.color} 0%, ${detail.color}dd 60%, ${detail.color}99 100%)`;

  // 基本信息
  document.getElementById('detailName').textContent = uni.name;

  const badges = document.getElementById('detailBadges');
  badges.innerHTML = `
    <span class="hero-badge">${escapeHtml(uni.level)}</span>
    <span class="hero-badge">${escapeHtml(uni.zone)}区</span>
    <span class="hero-badge">${escapeHtml(uni.province)}${uni.city && uni.city !== uni.province ? ' · ' + escapeHtml(uni.city) : ''}</span>
    ${major && major !== '不限专业' ? `<span class="hero-badge">${escapeHtml(major.replace(/\([^)]*\)/g, ''))}</span>` : ''}
  `;

  // 详细地址
  const addr =
    detail.address || `${uni.province}${uni.city && uni.city !== uni.province ? uni.city : ''}`;
  document.getElementById('detailInfo').innerHTML = `
    <div class="detail-info-item" style="flex:2;min-width:180px"><div class="info-value" style="font-size:.85rem">${escapeHtml(addr)}</div><div class="info-label">📍 地址</div></div>
    <div class="detail-info-item"><div class="info-value">${escapeHtml(uni.level)}</div><div class="info-label">层次</div></div>
    <div class="detail-info-item"><div class="info-value">${escapeHtml(uni.zone)}区</div><div class="info-label">考研分区</div></div>
    <div class="detail-info-item"><div class="info-value">${escapeHtml(uni.province)}</div><div class="info-label">省份</div></div>
  `;

  // 照片
  renderPhotos(uni.name, detail.color);

  // 筛选条件
  document.getElementById('detailFilter').textContent =
    `${degree === 'xueshuo' ? '学硕' : '专硕'} · ${category}${major && major !== '不限专业' ? ' · ' + major.replace(/\([^)]*\)/g, '') : ''}`;

  // 分数对比表格（使用共用构建函数）
  document.getElementById('detailScoreTable').innerHTML =
    buildScoreTableRows(admissionScores, allNL, userScore, { showDiff: true });

  // 判定结果
  document.getElementById('detailVerdict').innerHTML = `
    <span class="${verdictClass}">${verdict === 'safe' ? '✅ 稳过' : verdict === 'likely' ? '👍 大概率录取' : verdict === 'reach' ? '🎯 可冲刺' : verdict === 'nodata' ? '📋 参考数据' : '⚠️ 差距较大'}</span>
  `;

  // 复试基础线
  const retestZone = zone === 'all' ? 'A' : zone;
  const subjectLines = getSubjectLines(degree, category, retestZone);
  renderRetestLine(allNL, userScore, admissionScores, subjectLines);

  // 优缺点
  document.getElementById('detailPros').innerHTML = (detail.pros || [])
    .map((p) => `<li>${escapeHtml(p)}</li>`)
    .join('');
  document.getElementById('detailCons').innerHTML = (detail.cons || [])
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join('');

  // 院校特色
  document.getElementById('detailFeatures').textContent = detail.features || '';

  // 显示页面
  document.getElementById('detailPage').style.display = 'block';
  document.getElementById('detailPage').scrollTop = 0;
}

/** 渲染复试基础线模块（含单科硬性要求） */
function renderRetestLine(nationalLines, userScore, admissionScores, subjectLines) {
  const section = document.getElementById('detailRetestSection');
  const grid = document.getElementById('detailRetestGrid');
  if (!section || !grid) return;

  // 取最新年份的国家线
  const latestNL = nationalLines && nationalLines.length > 0 ? nationalLines[0] : null;
  if (!latestNL) { section.style.display = 'none'; return; }

  const nlScore = latestNL.score;
  const nlYear = latestNL.year;

  // 院校复试线：取最近一年真实录取分
  let uniRetest = null;
  if (admissionScores && admissionScores.length > 0) {
    const sorted = [...admissionScores].sort((a, b) => parseInt(b.year) - parseInt(a.year));
    uniRetest = sorted[0].score;
  }

  section.style.display = 'block';

  const nlPass = userScore >= nlScore;
  const uniPass = uniRetest ? userScore >= uniRetest : nlPass;

  // 单科线
  let subjectHtml = '';
  if (subjectLines) {
    const p = subjectLines.politics;
    const m = subjectLines.major;
    subjectHtml = `
      <div class="retest-card" style="grid-column:1/-1;text-align:left;padding:14px 16px;">
        <div class="retest-label" style="margin-bottom:8px;">📝 单科硬性要求（${nlYear}年，必须同时满足）</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.85rem;">
          <span>🟡 政治 ≥ <strong>${p}</strong> 分</span>
          <span>🟡 英语 ≥ <strong>${p}</strong> 分</span>
          <span>🔵 数学/专业课（150分科） ≥ <strong>${m}</strong> 分</span>
        </div>
        <div style="margin-top:6px;font-size:0.72rem;color:var(--color-text-secondary);">
          ⚠️ 任一门未达单科线，即使总分过线也无法进入复试
        </div>
      </div>`;
  }

  grid.innerHTML = `
    <div class="retest-card">
      <div class="retest-label">🏫 国家复试基本线（${nlYear}年）</div>
      <div class="retest-score ${nlPass ? 'pass' : 'fail'}">总分 ${nlScore}</div>
      <div class="retest-sub">你的总分：${userScore} ${nlPass ? '✅ 过线' : '❌ 未过线'}</div>
    </div>
    <div class="retest-card">
      <div class="retest-label">🎯 院校预估复试线（${nlYear}年）</div>
      <div class="retest-score ${uniPass ? 'pass' : 'fail'}">${uniRetest || nlScore}</div>
      <div class="retest-sub">${uniRetest ? `参考录取分 ${uniPass ? '✅' : '❌'} 差${userScore - uniRetest}分` : '暂无院校数据，参考国家线'}</div>
    </div>
    ${subjectHtml}
  `;
}

/** 关闭详情页 */
export function closeDetailPage() {
  document.getElementById('detailPage').style.display = 'none';
}
