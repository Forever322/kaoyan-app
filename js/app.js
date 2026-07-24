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
  const majors = getEngineeringMajors();
  select.innerHTML = '';
  for (const m of majors) {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m;
    select.appendChild(option);
  }
}

function checkMajorVisibility() {
  const category = document.getElementById('categorySelect').value;
  const majorGroup = document.getElementById('majorGroup');
  const isEng = isEngineering(category);
  majorGroup.style.display = isEng ? 'block' : 'none';
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

  // 查询按钮
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('scoreInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // 排序
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    renderResults(sortResults(currentResults, e.target.value));
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
  const major = isEngineering(category) ? majorSelect.value : null;

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
  const majorEl = document.getElementById('majorSelect');
  const major = isEngineering(category) && majorEl.style.display !== 'none' ? majorEl.value : null;

  // Build national lines data for comparison
  const allNL = getAllYearLines(currentDegree, category, currentZone === 'all' ? 'A' : currentZone);

  list.innerHTML = results.map(r => renderResultCard(r, userScore, allNL)).join('');
}

function renderResultCard(result, userScore, nationalLines) {
  const { university: uni, verdict, verdictLabel, verdictClass, admissionScores } = result;

  const levelBadgeClass = `level-${uni.level === '985' ? '985' : uni.level === '211' ? '211' : uni.level === '双一流' ? 'l1' : 'normal'}`;
  const cardClass = `result-card ${verdict}`;

  // Build comparison table: Year | National Line | University Line | Your Score | Result
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
          <td class="${ok ? 'td-ok' : 'td-fail'}">${ok ? '✅过' : '❌差' + (ul ? (ul-userScore) : '')}</td>
        </tr>`;
      }
    }
  } else {
    // No admission scores, just show national lines
    const nlMap = {};
    if (nationalLines) {
      nationalLines.forEach(n => { nlMap[n.year] = n.score; });
    }
    for (const y of years) {
      const nl = nlMap[y];
      if (nl) {
        const ok = userScore >= nl;
        tableRows += `<tr>
          <td>${y}年</td>
          <td class="td-nl">${nl}</td>
          <td class="td-ul" style="color:#999;">-</td>
          <td class="td-you">${userScore}</td>
          <td class="${ok ? 'td-ok' : 'td-fail'}">${ok ? '✅过线' : '❌'}</td>
        </tr>`;
      }
    }
  }

  const majorInfo = document.getElementById('majorSelect');
  const majorVal = majorInfo && majorInfo.style.display !== 'none' ? majorInfo.value : '';
  const majorText = majorVal && majorVal !== '不限专业' ? ` · ${majorVal.replace(/\([^)]*\)/g, '')}` : '';

  return `
    <div class="${cardClass}">
      <div class="uni-name">
        <span class="name-text">🏫 ${uni.name}</span>
        <span class="level-badge ${levelBadgeClass}">${uni.level}</span>
      </div>
      <div class="uni-meta">
        <span>📍 ${uni.province}${uni.city !== uni.province ? ' · ' + uni.city : ''}</span>
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
    <div class="uni-edit-item">
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

window.deleteUniversity = deleteUniversity;
