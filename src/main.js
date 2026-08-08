// Vite 入口：组合独立界面模块，再加载状态与交互逻辑。
import './style.css';
import './styles/liquid-glass/base.css';
import './styles/liquid-glass/home.css';
import './styles/liquid-glass/results.css';
import './styles/liquid-glass/detail.css';
import './styles/liquid-glass/filter.css';
import './styles/liquid-glass/modal.css';
import './styles/liquid-glass/prep.css';
import './styles/liquid-glass/my.css';
import './styles/liquid-glass/practice.css';
import './styles/liquid-glass/day-theme.css';
import './styles/liquid-glass/agent.css';
import { mountAppShell } from './views/app-shell.js';

// Vite 生产构建会把模块脚本提升到 head：必须先放入所有页面节点，
// 再加载 app.js，避免 WebView 中交互初始化早于 DOM 壳层而失效。
mountAppShell();
void import('./app.js');
