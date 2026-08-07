import { homeView } from './home-view.js';
import { resultsView } from './results-view.js';
import { failView } from './fail-view.js';
import { filterView } from './filter-view.js';
import { footerView } from './footer-view.js';
import { detailView } from './detail-view.js';
import { modalView } from './modal-view.js';
import { prepView } from './prep-view.js';
import { myView } from './my-view.js';

export function mountAppShell(root = document.getElementById('app')) {
  if (!root) throw new Error('应用挂载节点 #app 不存在');
  root.innerHTML = [
    homeView(),
    resultsView(),
    failView(),
    prepView(),
    myView(),
    filterView(),
    footerView(),
    detailView(),
    modalView(),
  ].join('');
}
