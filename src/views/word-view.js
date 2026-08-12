function renderWordResult(word) {
  return `
    <div id="wordResultCard" class="word-result-card">
      <div class="word-result-head">
        <h2 id="wordResultTitle">${word.word || ''}</h2>
        <span id="wordResultPhonetic">${word.phonetic || ''}</span>
        <button id="wordResultSpeaker" class="word-speaker-btn" type="button" aria-label="播放发音" style="display:none">🔊</button>
      </div>
      <p id="wordResultDefs" class="word-result-defs">${word.definitions || ''}</p>
      <div class="word-result-section" id="wordFormsSection" style="display:none">
        <h3>形态变换</h3>
        <dl id="wordResultForms" class="word-forms-list"></dl>
      </div>
      <div class="word-result-section" id="wordExamSection" style="display:none">
        <h3>考研重要性</h3>
        <p id="wordResultExam"></p>
      </div>
      <div class="word-result-section" id="wordGrammarSection" style="display:none">
        <h3>语法用法</h3>
        <p id="wordResultGrammar"></p>
      </div>
      <div class="word-result-section" id="wordExampleSection" style="display:none">
        <h3>例句</h3>
        <ul id="wordResultExamples" class="word-examples-list"></ul>
      </div>
    </div>
  `;
}

function renderSentenceResult() {
  return `
    <div id="sentenceResultCard" class="word-result-card">
      <div class="word-result-head">
        <h2 id="sentenceResultTitle"></h2>
      </div>
      <p id="sentenceTranslation" class="word-result-translation"></p>
      <div class="word-result-section" id="sentenceStructureSection" style="display:none">
        <h3>句子结构</h3>
        <p id="sentenceStructure"></p>
      </div>
      <div class="word-result-section" id="posTaggingSection" style="display:none">
        <h3>词性标注</h3>
        <dl id="posTaggingList" class="word-pos-list"></dl>
      </div>
      <div class="word-result-section" id="grammarPointsSection" style="display:none">
        <h3>语法知识点</h3>
        <div id="grammarPoints"></div>
      </div>
      <div class="word-result-section" id="goodExamplesSection" style="display:none">
        <h3>同类好句推荐</h3>
        <ul id="goodExamplesList" class="word-examples-list"></ul>
      </div>
    </div>
  `;
}

export function wordView() {
  return `
    <section id="wordScreen" class="app-screen word-screen" aria-label="单词系统">
      <header class="study-topbar">
        <button id="wordBackBtn" class="study-icon-btn" type="button" aria-label="返回题库">←</button>
        <div><h1>单词系统</h1><p>单词查询 · 句子分析 · 考研英语</p></div>
      </header>
      <main class="study-main">
        <div class="word-tab-bar">
          <button id="wordLookupTab" class="word-tab is-active" type="button">📖 单词查询</button>
          <button id="sentenceAnalyzeTab" class="word-tab" type="button">📝 句子分析</button>
        </div>

        <div id="wordLookupPanel" class="word-panel">
          <form id="wordSearchForm" class="word-search-form">
            <input id="wordSearchInput" type="text" maxlength="60" placeholder="输入英语单词，如 significant" aria-label="输入英语单词">
            <button type="submit" aria-label="查询单词">🔍</button>
          </form>
          <p class="word-hint">支持查询单词的中文释义、形态变换、考研频次、语法用法和例句</p>
          <div id="wordResult" class="word-result">
            ${renderWordResult({})}
          </div>
        </div>

        <div id="sentenceAnalyzePanel" class="word-panel hidden">
          <form id="sentenceAnalyzeForm" class="word-search-form">
            <textarea id="sentenceInput" maxlength="500" rows="3" placeholder="输入完整英语句子，如 Only by working hard can we achieve success." aria-label="输入英语句子"></textarea>
            <button type="submit" aria-label="分析句子">📝</button>
          </form>
          <p class="word-hint">分析句子结构、语法成分，并提供同类语法好句推荐</p>
          <div id="sentenceResult" class="word-result">
            ${renderSentenceResult()}
          </div>
        </div>
      </main>
    </section>
  `;
}
