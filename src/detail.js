//院校详情页模块

import { getUniversityDetail } from './data/uni-details.js';
import { renderPhotos } from './photos.js';
import { ADMISSION_SCORES, mapCategoryToScoreKey } from './data/admission-scores.js';
import { getAllYearLines, hasSubMajors } from './data/national-lines.js';
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
  const uniData = ADMISSION_SCORES[uni.name];
  const key = mapCategoryToScoreKey(category, degree, major);
  const isReal = uniData && uniData[key];
  document.getElementById('detailVerdict').innerHTML = `
    <span class="${verdictClass}">${verdict === 'safe' ? '✅ 稳过' : verdict === 'likely' ? '👍 大概率录取' : verdict === 'reach' ? '🎯 可冲刺' : verdict === 'nodata' ? '📋 参考数据' : '⚠️ 差距较大'}</span>
    ${!isReal ? '<span class="estimated-tag">预估值</span>' : ''}
  `;

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

/** 关闭详情页 */
export function closeDetailPage() {
  document.getElementById('detailPage').style.display = 'none';
}
