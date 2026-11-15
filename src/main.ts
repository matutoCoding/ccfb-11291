// 应用入口:hash 路由
import { renderListPage } from './ui/listPage';
import { renderEditorPage } from './ui/editorPage';
import { renderFinishPage } from './ui/finishPage';
import { renderDisplayPage, cleanupDisplay } from './ui/displayPage';
import { renderSettingsPage } from './ui/settingsPage';
import { updateHeaderLabel } from './appState';

const main = document.getElementById('main')!;
const tabs = document.querySelectorAll<HTMLAnchorElement>('#tabs a');

type Route = 'list' | 'editor' | 'finish' | 'display' | 'settings';

function currentRoute(): Route {
  const h = location.hash.replace(/^#\//, '');
  return (['list', 'editor', 'finish', 'display', 'settings'].includes(h) ? h : 'list') as Route;
}

async function route(): Promise<void> {
  const r = currentRoute();
  // 离开展示页时停帧
  cleanupDisplay();
  main.innerHTML = '';
  tabs.forEach(a => a.classList.toggle('active', a.dataset.route === r));
  updateHeaderLabel();
  switch (r) {
    case 'list': renderListPage(main); break;
    case 'editor': renderEditorPage(main); break;
    case 'finish': renderFinishPage(main); break;
    case 'display': await renderDisplayPage(main); break;
    case 'settings': renderSettingsPage(main); break;
  }
}

window.addEventListener('hashchange', () => { void route(); });
void route();
