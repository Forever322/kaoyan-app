export function modalView() {
  return `
    <div class="modal-overlay hidden" id="editModal">
      <div class="modal-content">
        <div class="modal-header"><h3>管理院校数据</h3><div class="modal-header-actions"><button class="modal-export" id="exportDataBtn" type="button">导出备份</button><button class="modal-close" id="closeModalBtn" type="button" aria-label="关闭">✕</button></div></div>
        <div class="modal-body">
          <div class="modal-tabs"><button class="modal-tab active" type="button" data-tab="universities">院校列表</button><button class="modal-tab" type="button" data-tab="add">添加院校</button><button class="modal-tab" type="button" data-tab="import">导入数据</button></div>
          <div class="modal-tab-content" id="tabUniversities"><input type="text" id="uniSearchInput" class="form-input" placeholder="搜索院校名称..."><div id="uniList" class="uni-edit-list"></div></div>
          <div class="modal-tab-content hidden" id="tabAdd"><form id="addUniForm" class="add-uni-form"><input type="text" id="addName" class="form-input" placeholder="院校名称 *" required><input type="text" id="addProvince" class="form-input" placeholder="所在省份 *" required><input type="text" id="addCity" class="form-input" placeholder="所在城市"><select id="addZone" class="form-select" aria-label="招生分区"><option value="A">A区</option><option value="B">B区</option></select><select id="addLevel" class="form-select" aria-label="院校层次"><option value="双非">双非院校</option><option value="211">211</option><option value="985">985</option><option value="双一流">双一流</option></select><textarea id="addScores" class="form-textarea" placeholder="录取分数(JSON格式)&#10;例如: {&quot;工学-学硕&quot;: {&quot;2024&quot;: 320, &quot;2023&quot;: 315, &quot;2022&quot;: 310}}"></textarea><button type="submit" class="btn-primary">添加/更新院校</button></form></div>
          <div class="modal-tab-content hidden" id="tabImport"><p class="import-hint">粘贴JSON数据批量导入院校和分数线</p><textarea id="importDataText" class="form-textarea large" placeholder="粘贴JSON数据..."></textarea><button id="importBtn" class="btn-primary" type="button">批量导入</button><p id="importResult" class="import-result"></p></div>
        </div>
      </div>
    </div>
  `;
}
