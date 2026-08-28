import { homeView } from './home-view.js';
import { resultsView } from './results-view.js';
import { failView } from './fail-view.js';
import { filterView } from './filter-view.js';
import { footerView } from './footer-view.js';
import { detailView } from './detail-view.js';
import { modalView } from './modal-view.js';
import { prepView } from './prep-view.js';
import { myView } from './my-view.js';
import { practiceView } from './practice-view.js';
import { agentView } from './agent-view.js';
import { wordView } from './word-view.js';
import { examView } from './exam-view.js';
import { drillView } from './drill-view.js';

export function mountAppShell(root = document.getElementById('app')) {
  if (!root) throw new Error('应用挂载节点 #app 不存在');
  root.innerHTML = [
    homeView(),
    resultsView(),
    failView(),
    prepView(),
    practiceView(),
    myView(),
    agentView(),
    wordView(),
    examView(),
    drillView(),
    filterView(),
    footerView(),
    detailView(),
    modalView(),
  ].join('');
}
