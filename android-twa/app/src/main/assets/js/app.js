/**
 * 考研择校助手 - 主应用逻辑 v2
 * 新增：2025数据、工学二级专业、历年对比表格
 */

document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  initUI();
  bindEvents();
  restoreLastSearch();
});

let currentDegree = 'xueshuo';
let currentZone = 'A';
let currentResults = [];
let currentModalTab = 'universities';

// ==================== UI 初始化 ====================
function initUI() {
  updateCategorySelect();
  updateMajorSelect();
}

function updateCategorySelect() {
  const select = document.getElementById('categorySelect');
  const categories = getCategories(currentDegree);
  select.innerHTML = '';
  for (const cat of categories) {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  }
  // Show/hide major selector
  checkMajorVisibility();
}

function updateMajorSelect() {
  const select = document.getElementById('majorSelect');
  const category = document.getElementById('categorySelect').value;
  const searchQuery = (document.getElementById('majorSearch').value || '').toLowerCase().trim();
  const allMajors = getMajorsForCategory(category);
  // 根据搜索词过滤
  const filtered = searchQuery
    ? allMajors.filter(m => m === '不限专业' || m.toLowerCase().includes(searchQuery))
    : allMajors;
  select.innerHTML = '';
  for (const m of filtered) {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m;
    select.appendChild(option);
  }
}

function checkMajorVisibility() {
  const category = document.getElementById('categorySelect').value;
  const majorGroup = document.getElementById('majorGroup');
  const majorLabel = document.getElementById('majorLabel');
  const show = hasSubMajors(category);
  majorGroup.style.display = show ? 'block' : 'none';
  // 动态更新标签
  if (show) {
    const isEng = (category === '工学');
    majorLabel.textContent = isEng ? '🔧 工学专业方向' : '💼 专硕专业方向';
    document.getElementById('majorSearch').value = '';
    updateMajorSelect();
  }
}

// ==================== 事件绑定 ====================
function bindEvents() {
  // 学位类型切换
  document.getElementById('degreeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    if (value === currentDegree) return;
    document.querySelectorAll('#degreeToggle .toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDegree = value;
    updateCategorySelect();
    clearResults();
  });

  // 分区切换
  document.getElementById('zoneToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    if (value === currentZone) return;
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentZone = value;
    clearResults();
  });

  // 门类切换 → 检查是否需要显示专业选择
  document.getElementById('categorySelect').addEventListener('change', () => {
    checkMajorVisibility();
    clearResults();
  });

  // 专业搜索 → 实时过滤列表
  document.getElementById('majorSearch').addEventListener('input', () => {
    updateMajorSelect();
  });

  // 全局院校搜索
  const globalSearch = document.getElementById('globalUniSearch');
  const globalDropdown = document.getElementById('globalUniDropdown');
  globalSearch.addEventListener('input', () => {
    const q = globalSearch.value.trim().toLowerCase();
    if (!q) { globalDropdown.style.display = 'none'; return; }
    const matches = UNIVERSITIES.filter(u =>
      u.name.toLowerCase().includes(q) || u.province.toLowerCase().includes(q)
    ).slice(0, 15);
    if (matches.length === 0) {
      globalDropdown.innerHTML = '<div style="padding:14px;color:#999;text-align:center;font-size:0.85rem;">未找到匹配院校</div>';
    } else {
      globalDropdown.innerHTML = matches.map(u => `
        <div class="header-search-item" data-uni-name="${u.name}">
          <span class="s-name">${u.name}</span>
          <span class="s-level">${u.level}</span>
          <span class="s-loc">📍 ${u.province}${u.city && u.city !== u.province ? ' ' + u.city : ''}</span>
        </div>
      `).join('');
    }
    globalDropdown.style.display = 'block';
  });
  globalSearch.addEventListener('blur', () => {
    setTimeout(() => { globalDropdown.style.display = 'none'; }, 200);
  });
  globalSearch.addEventListener('focus', () => {
    if (globalSearch.value.trim()) globalDropdown.style.display = 'block';
  });
  globalDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.header-search-item');
    if (!item) return;
    const uni = findUniversity(item.dataset.uniName);
    if (uni) {
      const userScore = parseInt(document.getElementById('scoreInput').value) || 0;
      const category = document.getElementById('categorySelect').value;
      const majorEl = document.getElementById('majorSelect');
      const major = hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;
      const admissionScores = getAdmissionScores(uni.name, category, currentDegree, major);
      const matchResult = evaluateMatch(userScore, admissionScores);
      openDetailPage({
        university: uni,
        admissionScores,
        verdict: matchResult.verdict,
        verdictLabel: matchResult.label,
        verdictClass: matchResult.cssClass,
        avgScore: matchResult.avgScore
      });
      globalDropdown.style.display = 'none';
      globalSearch.value = '';
    }
  });

  // 查询按钮
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('scoreInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // 排序
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentResults = sortResults(currentResults, e.target.value);
    renderResults(currentResults);
  });

  // 院校卡片点击 → 打开详情页
  document.getElementById('resultsList').addEventListener('click', (e) => {
    const card = e.target.closest('.result-card');
    if (!card) return;
    const idx = parseInt(card.dataset.index);
    if (!isNaN(idx) && currentResults[idx]) {
      openDetailPage(currentResults[idx]);
    }
  });

  // 详情页返回按钮
  document.getElementById('detailBackBtn').addEventListener('click', closeDetailPage);

  // 校园实景按钮 - 打开百度图片搜索
  document.getElementById('detailPhotoBtn').addEventListener('click', () => {
    const name = document.getElementById('detailName').textContent;
    const url = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(name + ' 校园')}`;
    window.open(url, '_blank');
  });

  // 管理院校列表点击也打开详情
  document.getElementById('uniList').addEventListener('click', (e) => {
    const row = e.target.closest('.uni-edit-item');
    if (!row) return;
    const name = row.dataset.uniName;
    if (name) {
      const uni = findUniversity(name);
      if (uni) {
        const category = document.getElementById('categorySelect').value;
        const degree = currentDegree;
        const major = document.getElementById('majorSelect').value;
        const result = matchUniversities(
          parseInt(document.getElementById('scoreInput').value) || 0,
          degree, category, currentZone,
          hasSubMajors(category) ? major : null
        );
        const matched = result.results.find(r => r.university.name === name);
        if (matched) {
          closeEditModal();
          setTimeout(() => openDetailPage(matched), 300);
        }
      }
    }
  });

  // B区尝试
  document.getElementById('tryBZoneBtn').addEventListener('click', () => {
    currentZone = 'B';
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === 'B') b.classList.add('active');
    });
    doSearch();
  });

  // 底部按钮
  document.getElementById('editDataBtn').addEventListener('click', openEditModal);
  document.getElementById('exportDataBtn').addEventListener('click', exportAllData);

  // 弹窗
  document.getElementById('closeModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchModalTab(tab.dataset.tab));
  });
  document.getElementById('uniSearchInput').addEventListener('input', (e) => {
    renderUniEditList(e.target.value);
  });
  document.getElementById('addUniForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleAddUniversity();
  });
  document.getElementById('importBtn').addEventListener('click', handleImport);
}

// ==================== 搜索 ====================
function doSearch() {
  const scoreInput = document.getElementById('scoreInput');
  const score = parseInt(scoreInput.value, 10);

  if (isNaN(score) || score < 0 || score > 500) {
    shakeElement(scoreInput);
    scoreInput.focus();
    return;
  }

  const category = document.getElementById('categorySelect').value;
  if (!category) return;

  const majorSelect = document.getElementById('majorSelect');
  const major = hasSubMajors(category) ? majorSelect.value : null;

  saveLastSearch({ score, degree: currentDegree, category, zone: currentZone, major });

  const result = matchUniversities(score, currentDegree, category, currentZone, major);
  currentResults = result.results;

  renderNationalLine(result);
  renderResults(result.results);

  const emptyState = document.getElementById('emptyState');
  const failState = document.getElementById('failState');
  const resultsSection = document.getElementById('resultsSection');

  if (result.passed === false) {
    emptyState.style.display = 'none';
    resultsSection.style.display = 'none';
    failState.style.display = 'block';
    const latestYear = result.nationalLine ? result.nationalLine.year : '';
    document.getElementById('failMsg').innerHTML =
      `<strong>你的 ${score} 分</strong> 未达到 ${currentZone}区「${category}」${currentDegree==='xueshuo'?'学硕':'专硕'} 的${latestYear}年国家线 <strong>(${result.nationalLine.score}分)</strong><br><br>建议尝试<strong>B区</strong>院校（国家线通常低10分左右）`;
  } else if (result.results.length === 0) {
    emptyState.style.display = 'block';
    resultsSection.style.display = 'none';
    failState.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    failState.style.display = 'none';
    resultsSection.style.display = 'block';
  }

  if (result.results.length > 0 || result.passed === false) {
    setTimeout(() => {
      document.getElementById('nationalLineCard').scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }
}

// ==================== 渲染 ====================
function renderNationalLine(result) {
  const card = document.getElementById('nationalLineCard');
  const info = document.getElementById('nationalLineInfo');

  if (result.nationalLine && result.nationalLinesAll.length > 0) {
    card.style.display = 'block';
    const userScore = parseInt(document.getElementById('scoreInput').value, 10);
    const category = document.getElementById('categorySelect').value;
    const allLines = result.nationalLinesAll;

    info.innerHTML = `
      <p class="nl-title"> ${currentDegree === 'xueshuo' ? '学硕' : '专硕'} · ${category} · ${currentZone}区</p>
      <div class="nl-table-wrap">
        <table class="nl-table">
          <thead><tr>
            <th>年份</th>${allLines.map(l => `<th>${l.year}年</th>`).join('')}
          </tr></thead>
          <tbody><tr>
            <td><strong>国家线</strong></td>
            ${allLines.map(l => `
              <td><span class="nl-val ${userScore >= l.score ? 'nl-above' : 'nl-below'}">${l.score}</span>
              <div class="nl-diff">${userScore >= l.score ? '✅' : '❌'}</div></td>
            `).join('')}
          </tr></tbody>
        </table>
      </div>
      <p class="nl-note">💡 你的分数: <strong>${userScore}</strong> | 差值: ${allLines.map(l => `${l.year}年 ${userScore >= l.score ? '+' : ''}${userScore - l.score}`).join(' / ')}</p>
    `;
  } else {
    card.style.display = 'none';
  }
}

function renderResults(results) {
  const list = document.getElementById('resultsList');
  const count = document.getElementById('resultCount');
  const section = document.getElementById('resultsSection');

  if (!results || results.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  count.textContent = `共${results.length}所`;

  const userScore = parseInt(document.getElementById('scoreInput').value, 10);
  const category = document.getElementById('categorySelect').value;
  const allNL = getAllYearLines(currentDegree, category, currentZone === 'all' ? 'A' : currentZone);

  list.innerHTML = results.map((r, i) => renderResultCard(r, userScore, allNL, i)).join('');
}

function renderResultCard(result, userScore, nationalLines, index) {
  const { university: uni, verdict, verdictLabel, verdictClass, admissionScores } = result;

  const levelBadgeClass = `level-${uni.level === '985' ? '985' : uni.level === '211' ? '211' : uni.level === '双一流' ? 'l1' : 'normal'}`;
  const cardClass = `result-card ${verdict}`;

  // Check if data is real or estimated
  const uniData = ADMISSION_SCORES[uni.name];
  const category = document.getElementById('categorySelect').value;
  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;
  const key = mapCategoryToScoreKey(category, currentDegree, major);
  const isRealData = uniData && uniData[key];

  // Build comparison table
  let tableRows = '';
  const years = ['2025', '2024', '2023', '2022'];

  if (admissionScores && admissionScores.length > 0) {
    const scoreMap = {};
    admissionScores.forEach(s => { scoreMap[s.year] = s.score; });

    const nlMap = {};
    if (nationalLines) {
      nationalLines.forEach(n => { nlMap[n.year] = n.score; });
    }

    for (const y of years) {
      const nl = nlMap[y];
      const ul = scoreMap[y];
      if (nl || ul) {
        const ok = userScore >= (ul || nl);
        tableRows += `<tr>
          <td>${y}年</td>
          <td class="td-nl">${nl || '-'}</td>
          <td class="td-ul">${ul || '-'}</td>
          <td class="td-you">${userScore}</td>
          <td class="${ok ? 'td-ok' : 'td-fail'}">${ok ? '✅' : '❌'}</td>
        </tr>`;
      }
    }
  }

  const majorText = major && major !== '不限专业' ? ` · ${major.replace(/\([^)]*\)/g, '')}` : '';
  const dataTag = isRealData ? '' : '<span class="estimated-tag">预估值</span>';

  return `
    <div class="${cardClass}" data-index="${index}">
      <div class="uni-name">
        <span class="name-text">🏫 ${uni.name}</span>
        <span class="level-badge ${levelBadgeClass}">${uni.level}</span>
        ${dataTag}
      </div>
      <div class="uni-meta">
        <span>📍 ${uni.province}${uni.city && uni.city !== uni.province ? ' · ' + uni.city : ''}</span>
        <span>🏷️ ${uni.zone}区</span>${majorText ? `<span>🔧 ${majorText}</span>` : ''}
      </div>
      <div class="score-table-wrap">
        <table class="score-table">
          <thead><tr>
            <th>年份</th><th>国家线</th><th>院校线</th><th>你的分</th><th>结果</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="uni-verdict">
        <span class="${verdictClass}">${verdict === 'safe' ? '✅' : verdict === 'likely' ? '👍' : verdict === 'reach' ? '🎯' : verdict === 'nodata' ? '📋' : '⚠️'} ${verdictLabel}${result.avgScore ? ` · 近4年均分 ${result.avgScore}` : ''}</span>
      </div>
    </div>
  `;
}

// ==================== 状态管理 ====================
function clearResults() {
  currentResults = [];
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('failState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('nationalLineCard').style.display = 'none';
}

function restoreLastSearch() {
  const last = getLastSearch();
  if (!last) return;

  if (last.score) document.getElementById('scoreInput').value = last.score;
  if (last.degree) {
    currentDegree = last.degree;
    document.querySelectorAll('#degreeToggle .toggle-btn').forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === last.degree) b.classList.add('active');
    });
    updateCategorySelect();
  }
  if (last.category) {
    document.getElementById('categorySelect').value = last.category;
    checkMajorVisibility();
  }
  if (last.major && document.getElementById('majorGroup').style.display !== 'none') {
    document.getElementById('majorSelect').value = last.major;
  }
  if (last.zone) {
    currentZone = last.zone;
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === last.zone) b.classList.add('active');
    });
  }
}

// ==================== 弹窗管理 ====================
function openEditModal() {
  document.getElementById('editModal').style.display = 'flex';
  switchModalTab('universities');
  renderUniEditList('');
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

function switchModalTab(tab) {
  currentModalTab = tab;
  document.querySelectorAll('.modal-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('tabUniversities').style.display = tab === 'universities' ? 'block' : 'none';
  document.getElementById('tabAdd').style.display = tab === 'add' ? 'block' : 'none';
  document.getElementById('tabImport').style.display = tab === 'import' ? 'block' : 'none';
  if (tab === 'universities') {
    renderUniEditList(document.getElementById('uniSearchInput').value);
  }
}

function renderUniEditList(query) {
  const container = document.getElementById('uniList');
  const all = getAllUniversitiesForEdit();
  const filtered = query
    ? all.filter(u => u.name.toLowerCase().includes(query.toLowerCase()) || u.province.toLowerCase().includes(query.toLowerCase()))
    : all;

  if (filtered.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);padding:20px;">未找到匹配院校</p>';
    return;
  }

  container.innerHTML = filtered.map(u => `
    <div class="uni-edit-item" data-uni-name="${u.name}">
      <div class="uni-edit-info">
        <div class="uni-edit-name">${u.name} ${u.isCustom ? '✏️' : ''}</div>
        <div class="uni-edit-meta">${u.province} · ${u.zone}区 · ${u.level} ${u.scores ? '· 有录取数据' : '· 无录取数据'}</div>
      </div>
      <button class="uni-edit-del" onclick="deleteUniversity('${u.name}')">删除</button>
    </div>
  `).join('');
}

function deleteUniversity(name) {
  if (!confirm(`确定要删除「${name}」吗？此操作不可恢复。`)) return;
  removeCustomUniversity(name);
  renderUniEditList(document.getElementById('uniSearchInput').value);
}

function handleAddUniversity() {
  const name = document.getElementById('addName').value.trim();
  const province = document.getElementById('addProvince').value.trim();
  const city = document.getElementById('addCity').value.trim() || province;
  const zone = document.getElementById('addZone').value;
  const level = document.getElementById('addLevel').value;
  const scoresRaw = document.getElementById('addScores').value.trim();

  if (!name || !province) {
    alert('院校名称和所在省份为必填项');
    return;
  }

  let scores = null;
  if (scoresRaw) {
    try { scores = JSON.parse(scoresRaw); }
    catch (e) { alert('录取分数JSON格式不正确'); return; }
  }

  addCustomUniversity({ name, province, city, zone, level, scores });
  alert(`✅ 「${name}」已添加/更新`);
  document.getElementById('addName').value = '';
  document.getElementById('addProvince').value = '';
  document.getElementById('addCity').value = '';
  document.getElementById('addScores').value = '';
  switchModalTab('universities');
}

function handleImport() {
  const text = document.getElementById('importDataText').value.trim();
  const resultEl = document.getElementById('importResult');
  if (!text) {
    resultEl.textContent = '请粘贴要导入的JSON数据';
    resultEl.className = 'import-result error';
    return;
  }
  const result = importData(text);
  if (result.success) {
    resultEl.textContent = `✅ 导入成功！共导入 ${result.count} 所院校的数据`;
    resultEl.className = 'import-result success';
    document.getElementById('importDataText').value = '';
    if (currentModalTab === 'universities') renderUniEditList(document.getElementById('uniSearchInput').value);
  } else {
    resultEl.textContent = `❌ 导入失败: ${result.error}`;
    resultEl.className = 'import-result error';
  }
}

// ==================== 工具函数 ====================
function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// Shake animation
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-6px); }
    80% { transform: translateX(6px); }
  }
`;
document.head.appendChild(shakeStyle);

// ==================== 院校详情页 ====================
function openDetailPage(result) {
  const { university: uni, admissionScores, verdict, verdictLabel, verdictClass } = result;
  const detail = getUniversityDetail(uni.name);
  const userScore = parseInt(document.getElementById('scoreInput').value) || 0;
  const category = document.getElementById('categorySelect').value;
  const allNL = getAllYearLines(currentDegree, category, currentZone === 'all' ? 'A' : currentZone);
  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;

  // Hero area
  const hero = document.getElementById('detailHero');
  hero.style.background = `linear-gradient(135deg, ${detail.color} 0%, ${detail.color}dd 60%, ${detail.color}99 100%)`;

  document.getElementById('detailName').textContent = uni.name;

  // Badges
  const badges = document.getElementById('detailBadges');
  badges.innerHTML = `
    <span class="hero-badge">${uni.level}</span>
    <span class="hero-badge">${uni.zone}区</span>
    <span class="hero-badge">${uni.province}${uni.city && uni.city !== uni.province ? ' · ' + uni.city : ''}</span>
    ${major && major !== '不限专业' ? `<span class="hero-badge">${major.replace(/\([^)]*\)/g,'')}</span>` : ''}
  `;

  // Info row - use full address from detail data
  const addr = detail.address || `${uni.province}${uni.city && uni.city !== uni.province ? uni.city : ''}`;
  document.getElementById('detailInfo').innerHTML = `
    <div class="detail-info-item" style="flex:2;min-width:180px"><div class="info-value" style="font-size:.85rem">${addr}</div><div class="info-label">📍 地址</div></div>
    <div class="detail-info-item"><div class="info-value">${uni.level}</div><div class="info-label">层次</div></div>
    <div class="detail-info-item"><div class="info-value">${uni.zone}区</div><div class="info-label">考研分区</div></div>
    <div class="detail-info-item"><div class="info-value">${uni.province}</div><div class="info-label">省份</div></div>
  `;

  // Photos grid - 显示真实照片
  renderPhotos(uni.name, detail.color);

  // Filter label
  document.getElementById('detailFilter').textContent =
    `${currentDegree === 'xueshuo' ? '学硕' : '专硕'} · ${category}${major && major !== '不限专业' ? ' · ' + major.replace(/\([^)]*\)/g,'') : ''}`;

  // Score comparison table
  let tableRows = '';
  const years = ['2025', '2024', '2023', '2022'];
  const nlMap = {};
  allNL.forEach(n => { nlMap[n.year] = n.score; });
  const scoreMap = {};
  if (admissionScores) admissionScores.forEach(s => { scoreMap[s.year] = s.score; });

  for (const y of years) {
    const nl = nlMap[y];
    const ul = scoreMap[y];
    if (nl || ul) {
      const refScore = ul || nl;
      const diff = userScore > 0 ? userScore - refScore : 0;
      const ok = diff >= 0;
      tableRows += `<tr>
        <td>${y}年</td>
        <td class="td-nl">${nl || '-'}</td>
        <td class="td-ul">${ul || '-'}</td>
        <td class="td-you">${userScore || '-'}</td>
        <td class="${ok ? 'td-ok' : 'td-fail'}">${userScore > 0 ? (ok ? '✅ +' + diff : '❌ ' + diff) : '-'}</td>
      </tr>`;
    }
  }
  document.getElementById('detailScoreTable').innerHTML = tableRows;

  // Verdict
  const uniData = ADMISSION_SCORES[uni.name];
  const key = mapCategoryToScoreKey(category, currentDegree, major);
  const isReal = uniData && uniData[key];
  document.getElementById('detailVerdict').innerHTML = `
    <span class="${verdictClass}">${verdict === 'safe' ? '✅ 稳过' : verdict === 'likely' ? '👍 大概率录取' : verdict === 'reach' ? '🎯 可冲刺' : verdict === 'nodata' ? '📋 参考数据' : '⚠️ 差距较大'}</span>
    ${!isReal ? '<span class="estimated-tag">预估值</span>' : ''}
  `;

  // Pros/Cons
  document.getElementById('detailPros').innerHTML = (detail.pros || []).map(p => `<li>${p}</li>`).join('');
  document.getElementById('detailCons').innerHTML = (detail.cons || []).map(c => `<li>${c}</li>`).join('');

  // Features
  document.getElementById('detailFeatures').textContent = detail.features || '';

  // Show detail page
  document.getElementById('detailPage').style.display = 'block';
  document.getElementById('detailPage').scrollTop = 0;
}

function closeDetailPage() {
  document.getElementById('detailPage').style.display = 'none';
}

window.deleteUniversity = deleteUniversity;

// ==================== 照片渲染 ====================
async function renderPhotos(name, color) {
  const container = document.getElementById('detailPhotos');
  container.innerHTML = [1,2,3,4].map(() =>
    `<div class="photo-item"><div class="photo-loading" style="background:${color}22;display:flex;align-items:center;justify-content:center;height:100%;color:${color};font-size:2rem">📷</div></div>`
  ).join('');

  let urls = [];
  if (typeof UNI_PHOTOS !== 'undefined' && UNI_PHOTOS[name]) {
    urls = UNI_PHOTOS[name];
  } else {
    urls = await fetchBaiduPhotos(name);
  }

  container.innerHTML = urls.map(url =>
    `<div class="photo-item"><img src="${url}" alt="${name}" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML=this.parentElement.innerHTML"></div>`
  ).join('');

  // 不够4张用搜索链接补
  while (container.children.length < 4) {
    const d = document.createElement('div');
    d.className = 'photo-item photo-search-link';
    d.style.cssText = `background:${color}22;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:2rem`;
    d.textContent = '🔍';
    const searchUrl = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(name+' 校园')}`;
    d.onclick = () => { window.open(searchUrl, '_blank'); };
    container.appendChild(d);
  }
}

/** 从百度图片搜索API获取真实校园照片（国内CDN，秒开） */
async function fetchBaiduPhotos(name) {
  try {
    const results = [];
    const queries = [name + '校园', name + '大学校门', name + '图书馆', name + '校园风景'];
    for (const q of queries) {
      const apiUrl = `https://image.baidu.com/search/acjson?tn=resultjson_com&word=${encodeURIComponent(q)}&pn=0&rn=3`;
      const resp = await fetch(apiUrl);
      const text = await resp.text();
      // 百度返回JSON，提取thumbURL
      const thumbMatches = text.matchAll(/"thumbURL":"(https:[^"]+)"/g);
      for (const m of thumbMatches) {
        const thumbUrl = m[1].replace(/\\\//g, '/');
        if (thumbUrl && !results.includes(thumbUrl)) results.push(thumbUrl);
        if (results.length >= 4) return results;
      }
    }
    return results;
  } catch(e) { return []; }
}
