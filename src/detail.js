/**
 * 院校详情页模块：展示院校信息、分数对比、优缺点
 */

import { getUniversityDetail } from './data/uni-details.js';
import { getRequirements } from './data/uni-requirements.js';
import { getCampusHero } from './data/campus-hero-library.js';
import { renderPhotos } from './photos.js';
import { getAllYearLines, hasSubMajors, getSubjectLines } from './data/national-lines.js';
import { buildScoreTableRows } from './render.js';
import { escapeHtml } from './utils.js';
import { addBrowseHistory, isFavorite } from './storage.js';

let detailCloseTimer;

function resolveHeroPhoto(uni) {
  return getCampusHero(uni);
}

function applyHeroPhoto(hero, photo) {
  // 头图只使用项目内置图集，避免第三方图库返回空白或失效图后覆盖本地背景。
  hero.style.setProperty('--hero-image', `url("${photo}")`);
}

/** 打开院校详情页 */
export function openDetailPage(result, { degree, zone, favoriteNames = null }) {
  const { university: uni, admissionScores, verdict, verdictClass } = result;

  // 记录浏览历史
  addBrowseHistory(uni.name);

  const detail = getUniversityDetail(uni.name);
  const userScore = parseInt(document.getElementById('scoreInput').value) || 0;
  const category = document.getElementById('categorySelect').value;
  const allNL = getAllYearLines(degree, category, zone === 'all' ? 'A' : zone);
  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && document.getElementById('majorGroup').style.display !== 'none' ? majorEl.value : null;
  const degreeLabel = degree === 'xueshuo' ? '学硕' : '专硕';
  const majorLabel = major && major !== '不限专业' ? major.replace(/\([^)]*\)/g, '') : category;
  const studyModeLabel = result.studyMode || '全日制 / 非全日制';

  // 顶部照片与遮罩
  const hero = document.getElementById('detailHero');
  const heroPhoto = resolveHeroPhoto(uni);
  applyHeroPhoto(hero, heroPhoto);
  // 部分院校详情没有颜色字段；写入字符串 "undefined" 会让整个多层背景规则失效。
  if (detail.color) {
    hero.style.setProperty('--hero-color', detail.color);
  } else {
    hero.style.removeProperty('--hero-color');
  }

  // 基本信息
  document.getElementById('detailName').textContent = uni.name;

  const badges = document.getElementById('detailBadges');
  badges.innerHTML = `
    <span class="hero-badge">${escapeHtml(uni.level)}</span>
    <span class="hero-badge">${escapeHtml(degreeLabel)} · ${escapeHtml(category)} · ${escapeHtml(uni.zone)}区</span>
    <span class="hero-badge">${escapeHtml(uni.province)}${uni.city && uni.city !== uni.province ? ' · ' + escapeHtml(uni.city) : ''}</span>
  `;

  // 详细地址
  const addr =
    detail.address || `${uni.province}${uni.city && uni.city !== uni.province ? uni.city : ''}`;
  document.getElementById('detailInfo').innerHTML = `
    <div class="detail-info-card">
      <div class="detail-info-item detail-info-address"><div class="info-value">⌖ ${escapeHtml(addr)}</div><span class="info-link">地图 ›</span></div>
      <div class="detail-info-divider"></div>
      <div class="detail-info-meta">
        <div class="detail-info-item detail-info-metric"><div class="info-value">${escapeHtml(studyModeLabel)}</div><div class="info-label">培养方式</div></div>
        <div class="detail-info-item detail-info-metric"><div class="info-value">${escapeHtml(degreeLabel)}</div><div class="info-label">学位类型</div></div>
        <div class="detail-info-item detail-info-metric"><div class="info-value">${escapeHtml(majorLabel)}</div><div class="info-label">匹配专业</div></div>
      </div>
    </div>
  `;

  // 照片
  renderPhotos(uni.name, detail.color);

  // 分数对比表格（使用共用构建函数）
  document.getElementById('detailScoreTable').innerHTML =
    buildScoreTableRows(admissionScores, allNL, userScore, { showDiff: true });

  // 判定结果
  document.getElementById('detailVerdict').innerHTML = `
    <span class="${verdictClass}">${verdict === 'safe' ? '✅ 稳过' : verdict === 'likely' ? '👍 大概率录取' : verdict === 'reach' ? '🎯 可冲刺' : verdict === 'nodata' ? '📋 参考数据' : '⚠️ 差距较大'}</span>
  `;

  const highestScore = admissionScores?.length ? Math.max(...admissionScores.map((item) => item.score)) : null;
  const scoreDiff = highestScore ? userScore - highestScore : null;
  document.getElementById('detailMatchSummary').innerHTML = `
    <div><strong>${userScore || '—'}</strong><span>我的分数</span></div>
    <div class="detail-match-copy"><b>${verdict === 'safe' ? '这所，稳稳拿下' : verdict === 'likely' ? '这所，大概率可行' : verdict === 'reach' ? '这所，值得冲刺' : '这所，谨慎评估'}</b><small>${scoreDiff === null ? '参考历年数据做判断' : scoreDiff >= 0 ? `高于最高录取线 ${scoreDiff} 分` : `距最高录取线还差 ${Math.abs(scoreDiff)} 分`}</small></div>
    <em class="${verdictClass}">${verdict === 'safe' ? '稳过' : verdict === 'likely' ? '大概率' : verdict === 'reach' ? '冲刺' : '参考'}</em>
  `;

  // 复试基础线
  const retestZone = zone === 'all' ? 'A' : zone;
  const subjectLines = getSubjectLines(degree, category, retestZone);
  renderRetestLine(allNL, userScore, admissionScores, subjectLines);

  // 硬性报考要求
  renderRequirements(uni.name);

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
  const page = document.getElementById('detailPage');
  clearTimeout(detailCloseTimer);
  page.classList.remove('hidden', 'is-closing');
  page.style.display = 'block';
  page.scrollTop = 0;

  // 收藏按钮状态
  const favBtn = document.getElementById('detailFavBtn');
  const isFaved = Array.isArray(favoriteNames) ? favoriteNames.includes(uni.name) : isFavorite(uni.name);
  favBtn.textContent = isFaved ? '★' : '☆';
  favBtn.classList.toggle('is-faved', isFaved);
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

/** 渲染硬性报考要求 */
function renderRequirements(uniName) {
  const section = document.getElementById('detailRequirementsSection');
  const grid = document.getElementById('detailRequirementsGrid');
  if (!section || !grid) return;

  const req = getRequirements(uniName);
  const category = document.getElementById('categorySelect').value;
  const majorEl = document.getElementById('majorSelect');
  const subMajor = hasSubMajors(category) && document.getElementById('majorGroup').style.display !== 'none' ? majorEl.value : null;

  // 确定当前查看的专业名称
  let currentMajor = '计算机科学与技术';
  if (category && category.includes('工学')) {
    if (subMajor && subMajor !== '不限专业') {
      currentMajor = subMajor.replace(/\([^)]*\)/g, '');
    } else if (category.includes('计算机') || category.includes('软件') || category.includes('网络空间')) {
      currentMajor = category;
    }
  }

  // 考试科目：优先 otherMajors 匹配，否则用默认 examSubjects
  let examDisplay = req.examSubjects || '408计算机学科专业基础（统考）';
  if (req.otherMajors && req.otherMajors[currentMajor]) {
    examDisplay = req.otherMajors[currentMajor].examSubjects;
  }
  const examPrefix = currentMajor === '计算机科学与技术' ? '' : `<span style="color:#8ea0c0;font-size:.6rem">${escapeHtml(currentMajor)}</span><br>`;
  const examRow = `<div class="req-card"><div class="req-icon">📚</div><div class="req-body"><div class="req-label">初试考试科目</div><div class="req-value">${examPrefix}${escapeHtml(examDisplay)}</div></div></div>`;

  // 单科线
  const sl = req.singleSubjectLine || { politics: 34, english: 34, business1: 51, business2: 51 };
  const subjectLineRow = `<div class="req-card"><div class="req-icon">📝</div><div class="req-body"><div class="req-label">单科最低线（政治/英语/数学/专业课）</div><div class="req-value">🟡 政治≥<strong>${sl.politics}</strong> &nbsp; 🟡 英语≥<strong>${sl.english}</strong> &nbsp; 🔵 数学≥<strong>${sl.business1}</strong> &nbsp; 🔵 专业课≥<strong>${sl.business2}</strong></div><div class="req-note">⚠️ 任一门未达线则无法进入复试</div></div></div>`;

  // 四六级
  const cetIcon = req.cet4Required || req.cet6Required ? '🔴' : '✅';
  const cetRow = `<div class="req-card"><div class="req-icon">${cetIcon}</div><div class="req-body"><div class="req-label">四六级要求</div><div class="req-value">${escapeHtml(req.cetNote || '无硬性要求')}</div></div></div>`;

  // 跨专业
  const crossIcon = req.crossMajorAllowed ? '✅' : '🚫';
  const crossRow = `<div class="req-card"><div class="req-icon">${crossIcon}</div><div class="req-body"><div class="req-label">跨专业报考</div><div class="req-value">${req.crossMajorAllowed ? '允许' : '不允许'}${req.crossMajorNote ? ' — ' + escapeHtml(req.crossMajorNote) : ''}</div></div></div>`;

  // 同等学力
  const eqIcon = req.equivalentDegreeAllowed ? '⚠️' : '🚫';
  const eqRow = `<div class="req-card"><div class="req-icon">${eqIcon}</div><div class="req-body"><div class="req-label">同等学力考生</div><div class="req-value">${req.equivalentDegreeAllowed ? '允许报考' : '不招收'} — ${escapeHtml(req.equivalentDegreeNote || '')}</div></div></div>`;

  // 复试形式
  const hasMT = req.hasMachineTest;
  const hasWE = req.hasWrittenExam;
  let retestIcons = '';
  if (hasMT) retestIcons += '💻 机试 ';
  if (hasWE) retestIcons += '📄 笔试 ';
  if (!hasMT && !hasWE) retestIcons = '🎤 纯面试 ';
  const retestFormRow = `<div class="req-card"><div class="req-icon">${hasMT ? '💻' : '🎤'}</div><div class="req-body"><div class="req-label">复试形式</div><div class="req-value">${escapeHtml(req.retestForm || '笔试 + 面试')}</div><div class="req-note">${retestIcons} · 复试费 ${req.retestFee || 100} 元 · 面试最低 ${req.interviewMinScore || 60} 分及格</div></div></div>`;

  // 初复试占比
  const weight = req.retestWeight ? Math.round(req.retestWeight * 100) : 40;
  const initWeight = 100 - weight;
  const weightRow = `<div class="req-card"><div class="req-icon">⚖️</div><div class="req-body"><div class="req-label">初试复试成绩占比</div><div class="req-value">初试 <strong>${initWeight}%</strong> + 复试 <strong>${weight}%</strong></div><div class="req-note">${escapeHtml(req.retestWeightNote || '')}</div></div></div>`;

  // 推免比例
  const recRatio = req.recommendationRatio ? Math.round(req.recommendationRatio * 100) : 30;
  let recColor = 'var(--color-success)';
  if (recRatio >= 60) recColor = 'var(--color-danger)';
  else if (recRatio >= 40) recColor = 'var(--color-warning)';
  const recRow = `<div class="req-card"><div class="req-icon">🎓</div><div class="req-body"><div class="req-label">推免比例（统考竞争度）</div><div class="req-value">约 <strong style="color:${recColor}">${recRatio}%</strong> 名额留给推免生</div><div class="req-note">${escapeHtml(req.recommendationRatioNote || '')}</div></div></div>`;

  // 额外备注
  let extraHtml = '';
  if (req.extraNotes && req.extraNotes.length > 0) {
    extraHtml = `<div class="req-card" style="grid-column:1/-1"><div class="req-icon">💡</div><div class="req-body"><div class="req-label">特别提醒</div><div class="req-value">${req.extraNotes.map(n => '· ' + escapeHtml(n)).join('<br>')}</div></div></div>`;
  }

  grid.innerHTML = examRow + subjectLineRow + cetRow + crossRow + eqRow + retestFormRow + weightRow + recRow + extraHtml;
  section.style.display = 'block';
}

/** 关闭详情页 */
export function closeDetailPage() {
  const page = document.getElementById('detailPage');
  if (page.classList.contains('hidden') || page.classList.contains('is-closing')) return;
  page.classList.add('is-closing');
  clearTimeout(detailCloseTimer);
  detailCloseTimer = setTimeout(() => {
    page.style.display = 'none';
    page.classList.add('hidden');
    page.classList.remove('is-closing');
  }, 240);
}
