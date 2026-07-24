/**
 * 考研择校助手 - 主应用逻辑
 */

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  initUI();
  bindEvents();
  restoreLastSearch();
});

// ==================== UI 状态 ====================
let currentDegree = 'xueshuo';
let currentZone = 'A';
let currentResults = [];
let currentModalTab = 'universities';

// ==================== UI 初始化 ====================
function initUI() {
  updateCategorySelect();
}

/** 根据学位类型更新门类下拉 */
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
}

// ==================== 事件绑定 ====================
function bindEvents() {
  // 学位类型切换
  document.getElementById('degreeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    const value = btn.dataset.value;
    if (value === currentDegree) return;

    // 更新UI
    const buttons = document.querySelectorAll('#degreeToggle .toggle-btn');
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentDegree = value;
    updateCategorySelect();
    // 清空结果（因为门类变了）
    clearResults();
  });

  // 分区切换
  document.getElementById('zoneToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    const value = btn.dataset.value;
    if (value === currentZone) return;

    const buttons = document.querySelectorAll('#zoneToggle .toggle-btn');
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentZone = value;
    clearResults();
  });

  // 查询按钮
  document.getElementById('searchBtn').addEventListener('click', doSearch);

  // 分数输入框回车
  document.getElementById('scoreInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // 排序切换
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    const sorted = sortResults(currentResults, e.target.value);
    renderResults(sorted);
  });

  // B区尝试按钮
  document.getElementById('tryBZoneBtn').addEventListener('click', () => {
    // 切换到B区
    currentZone = 'B';
    const buttons = document.querySelectorAll('#zoneToggle .toggle-btn');
    buttons.forEach(b => {
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

  // 弹窗tab切换
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchModalTab(tab.dataset.tab));
  });

  // 院校搜索
  document.getElementById('uniSearchInput').addEventListener('input', (e) => {
    renderUniEditList(e.target.value);
  });

  // 添加院校表单
  document.getElementById('addUniForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleAddUniversity();
  });

  // 导入按钮
  document.getElementById('importBtn').addEventListener('click', handleImport);
}

// ==================== 搜索逻辑 ====================
function doSearch() {
  const scoreInput = document.getElementById('scoreInput');
  const score = parseInt(scoreInput.value, 10);

  // 验证
  if (isNaN(score) || score < 0 || score > 500) {
    shakeElement(scoreInput);
    scoreInput.focus();
    return;
  }

  const category = document.getElementById('categorySelect').value;
  if (!category) return;

  // 保存搜索条件
  saveLastSearch({ score, degree: currentDegree, category, zone: currentZone });

  // 执行匹配
  const result = matchUniversities(score, currentDegree, category, currentZone);
  currentResults = result.results;

  // 渲染结果
  renderNationalLine(result);
  renderResults(result.results);

  // 显示/隐藏各区域
  const emptyState = document.getElementById('emptyState');
  const failState = document.getElementById('failState');
  const resultsSection = document.getElementById('resultsSection');

  if (result.passed === false) {
    // 未过线
    emptyState.style.display = 'none';
    resultsSection.style.display = 'none';
    failState.style.display = 'block';
    document.getElementById('failMsg').textContent =
      `你的${score}分未达到${currentZone}区「${category}」类别的国家线（${result.nationalLine.score}分，${result.nationalLine.year}年数据）。\n\n建议尝试B区院校，B区国家线通常低10分左右。`;
  } else if (result.results.length === 0) {
    emptyState.style.display = 'block';
    resultsSection.style.display = 'none';
    failState.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    failState.style.display = 'none';
    resultsSection.style.display = 'block';
  }

  // 滚动到结果区
  if (result.results.length > 0 || result.passed === false) {
    document.getElementById('nationalLineCard').scrollIntoView({ behavior: 'smooth' });
  }
}

// ==================== 渲染函数 ====================

/** 渲染国家线参考 */
function renderNationalLine(result) {
  const card = document.getElementById('nationalLineCard');
  const info = document.getElementById('nationalLineInfo');

  if (result.nationalLine) {
    card.style.display = 'block';
    const allLines = result.nationalLinesAll;
    const userScore = parseInt(document.getElementById('scoreInput').value, 10);

    info.innerHTML = `
      <p style="margin-bottom:10px;font-size:0.9rem;">
        ${currentDegree === 'xueshuo' ? '学硕' : '专硕'} · ${document.getElementById('categorySelect').value} · ${currentZone}区
      </p>
      <div class="nl-grid">
        ${allLines.map(l => `
          <div class="nl-item">
            <div class="nl-year">${l.year}年国家线</div>
            <div class="nl-score ${userScore >= l.score ? 'above' : 'below'}">${l.score}</div>
            <div style="font-size:0.7rem;color:var(--color-text-secondary);">
              ${userScore >= l.score ? '✅ 过线' : '❌ 未过'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    card.style.display = 'none';
  }
}

/** 渲染结果列表 */
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

  list.innerHTML = results.map(r => renderResultCard(r)).join('');
}

/** 渲染单个结果卡片 */
function renderResultCard(result) {
  const { university: uni, verdict, verdictLabel, verdictClass, admissionScores, avgScore } = result;

  const levelBadgeClass = `level-${uni.level === '985' ? '985' : uni.level === '211' ? '211' : uni.level === '双一流' ? 'l1' : 'normal'}`;
  const cardClass = `result-card ${verdict}`;

  const scoreChips = admissionScores && admissionScores.length > 0
    ? admissionScores.map(s => `<span class="score-chip">${s.year}年: ${s.score}分</span>`).join('')
    : '<span class="score-chip" style="background:#f1f3f4;color:#999;">暂无历年录取数据</span>';

  const avgInfo = avgScore ? ` · 近3年均分 ${avgScore}` : '';

  return `
    <div class="${cardClass}">
      <div class="uni-name">
        <span class="name-text">🏫 ${uni.name}</span>
        <span class="level-badge ${levelBadgeClass}">${uni.level}</span>
      </div>
      <div class="uni-meta">
        <span>📍 ${uni.province}${uni.city !== uni.province ? ' · ' + uni.city : ''}</span>
        <span>🏷️ ${uni.zone}区</span>
      </div>
      <div class="uni-scores">${scoreChips}</div>
      <div class="uni-verdict">
        <span class="${verdictClass}">${verdict === 'safe' ? '✅' : verdict === 'likely' ? '👍' : verdict === 'reach' ? '🎯' : '⚠️'} ${verdictLabel}${avgInfo}</span>
      </div>
    </div>
  `;
}

/** 渲染国家线参考卡片 */
function getVerdictLabel(verdict) {
  const map = {
    'safe': '你的分数高于近年录取线，录取概率较大',
    'likely': '你的分数达到近年录取线，有较大概率录取',
    'reach': '你的分数在录取线附近，可以作为冲刺目标',
    'unmatched': '你的分数与近年录取线差距较大',
    'nodata': '该院校暂无此类别的录取数据'
  };
  return map[verdict] || '';
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

  if (last.score) {
    document.getElementById('scoreInput').value = last.score;
  }
  if (last.degree) {
    currentDegree = last.degree;
    const buttons = document.querySelectorAll('#degreeToggle .toggle-btn');
    buttons.forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === last.degree) b.classList.add('active');
    });
    updateCategorySelect();
  }
  if (last.category) {
    document.getElementById('categorySelect').value = last.category;
  }
  if (last.zone) {
    currentZone = last.zone;
    const buttons = document.querySelectorAll('#zoneToggle .toggle-btn');
    buttons.forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === last.zone) b.classList.add('active');
    });
  }
}

// ==================== 数据管理弹窗 ====================
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
    ? all.filter(u =>
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.province.toLowerCase().includes(query.toLowerCase())
      )
    : all;

  if (filtered.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);padding:20px;">未找到匹配院校</p>';
    return;
  }

  container.innerHTML = filtered.map(u => `
    <div class="uni-edit-item">
      <div class="uni-edit-info">
        <div class="uni-edit-name">${u.name} ${u.isCustom ? '✏️' : ''}</div>
        <div class="uni-edit-meta">
          ${u.province} · ${u.zone}区 · ${u.level}
          ${u.scores ? ' · 有录取数据' : ' · 无录取数据'}
        </div>
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
    try {
      scores = JSON.parse(scoresRaw);
    } catch (e) {
      alert('录取分数JSON格式不正确，请检查');
      return;
    }
  }

  addCustomUniversity({ name, province, city, zone, level, scores });
  alert(`✅ 「${name}」已添加/更新`);

  // 清空表单
  document.getElementById('addName').value = '';
  document.getElementById('addProvince').value = '';
  document.getElementById('addCity').value = '';
  document.getElementById('addScores').value = '';

  // 返回列表
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
    // 刷新列表
    if (currentModalTab === 'universities') {
      renderUniEditList(document.getElementById('uniSearchInput').value);
    }
  } else {
    resultEl.textContent = `❌ 导入失败: ${result.error}`;
    resultEl.className = 'import-result error';
  }
}

// ==================== 工具函数 ====================
function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// 添加 shake 动画
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

// 暴露 deleteUniversity 到全局作用域（onclick回调需要）
window.deleteUniversity = deleteUniversity;
