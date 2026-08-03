/**
 * 弹窗管理模块：院校编辑、添加、导入
 */

import {
  addCustomUniversity,
  removeCustomUniversity,
  getAllUniversitiesForEdit,
  importData,
} from './storage.js';
import { escapeHtml } from './utils.js';

/** 显示编辑弹窗 */
export function openEditModal() {
  const modal = document.getElementById('editModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  switchModalTab('universities');
  renderUniEditList('');
}

/** 关闭编辑弹窗 */
export function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
}

/** 切换弹窗标签页 */
export function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('tabUniversities').style.display =
    tab === 'universities' ? 'block' : 'none';
  document.getElementById('tabAdd').style.display = tab === 'add' ? 'block' : 'none';
  document.getElementById('tabImport').style.display = tab === 'import' ? 'block' : 'none';
  if (tab === 'universities') {
    renderUniEditList(document.getElementById('uniSearchInput').value);
  }
}

/** 渲染院校编辑列表 */
export function renderUniEditList(query) {
  const container = document.getElementById('uniList');
  const all = getAllUniversitiesForEdit();
  const filtered = query
    ? all.filter(
        (u) =>
          u.name.toLowerCase().includes(query.toLowerCase()) ||
          u.province.toLowerCase().includes(query.toLowerCase()),
      )
    : all;

  if (filtered.length === 0) {
    container.innerHTML =
      '<p style="text-align:center;color:var(--color-text-secondary);padding:20px;">未找到匹配院校</p>';
    return;
  }

  container.innerHTML = filtered
    .map(
      (u) => `
    <div class="uni-edit-item" data-uni-name="${escapeHtml(u.name)}">
      <div class="uni-edit-info">
        <div class="uni-edit-name">${escapeHtml(u.name)} ${u.isCustom ? '✏️' : ''}</div>
        <div class="uni-edit-meta">${escapeHtml(u.province)} · ${escapeHtml(u.zone)}区 · ${escapeHtml(u.level)} ${u.scores ? '· 有录取数据' : '· 无录取数据'}</div>
      </div>
      <button class="uni-edit-del">删除</button>
    </div>
  `,
    )
    .join('');
}

/** 处理添加院校 */
export function handleAddUniversity() {
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
    } catch {
      alert('录取分数JSON格式不正确');
      return;
    }
  }

  addCustomUniversity({ name, province, city, zone, level, scores });
  alert(`✅ 「${name}」已添加/更新`);
  document.getElementById('addName').value = '';
  document.getElementById('addProvince').value = '';
  document.getElementById('addCity').value = '';
  document.getElementById('addScores').value = '';
  switchModalTab('universities');
}

/** 处理数据导入 */
export function handleImport() {
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
    renderUniEditList(document.getElementById('uniSearchInput').value);
  } else {
    resultEl.textContent = `❌ 导入失败: ${result.error}`;
    resultEl.className = 'import-result error';
  }
}

/** 删除自定义院校（由事件委托调用） */
export function handleDeleteUniversity(name) {
  if (!confirm(`确定要删除「${name}」吗？此操作不可恢复。`)) return;
  removeCustomUniversity(name);
  renderUniEditList(document.getElementById('uniSearchInput').value);
}
