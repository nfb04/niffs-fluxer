// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	addInstanceUrl,
	getActiveTabIndex,
	getInstanceTabsList,
	removeInstanceAtIndex,
	setActiveTabIndex,
} from '@electron/common/DesktopConfig';
import {createChildLogger} from '@electron/common/Logger';
import type {InstanceTabInfo} from '@electron/common/Types';
import {registerDisplayMediaRequestHandler} from '@electron/main/DisplayMedia';
import {registerSpellcheck} from '@electron/main/Spellcheck';
import {BrowserView, type BrowserWindow, shell} from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createChildLogger('InstanceTabs');

export const TAB_BAR_HEIGHT = 40;
const POPOUT_NAMESPACE = 'fluxer_';

let tabViews: Array<BrowserView> = [];
let tabBarWindow: BrowserWindow | null = null;

export interface InstanceTabViewOptions {
	isTrustedOrigin(url?: string): boolean;
	getSanitizedPath(rawUrl: string): string | null;
	getSharedWebPreferences(appUrl: string): Electron.WebPreferences;
	getVoicePopoutWindowOptions(): Electron.BrowserWindowConstructorOptions;
	isVoicePopoutWindowName(frameName: string | undefined): boolean;
}

function getTabBarDataUrl(): string {
	const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		* { box-sizing: border-box; }
		html, body { margin: 0; height: ${TAB_BAR_HEIGHT}px; overflow: hidden; }
		body { font-family: system-ui, sans-serif; font-size: 13px; background: #2b2d31; color: #b5bac1; -webkit-app-region: drag; user-select: none; display: flex; align-items: center; padding: 0 8px; gap: 8px; }
		.tabs { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; min-width: 0; flex: 1; overflow-x: auto; }
		.tab { padding: 6px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
		.tab:hover { background: rgba(255,255,255,0.06); color: #fff; }
		.tab.active { background: #404249; color: #fff; }
		.tab-close { margin-left: 4px; padding: 0 4px; opacity: 0.6; font-size: 14px; }
		.tab-close:hover { opacity: 1; }
		.tab.official .tab-close { display: none; }
		.add-btn { -webkit-app-region: no-drag; border: 0; background: transparent; color: #b5bac1; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 18px; line-height: 1; }
		.add-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
	</style></head><body>
		<div class="tabs" id="tabs"></div>
		<button type="button" class="add-btn" id="add" title="Add instance">+</button>
	</body><script>
	(function() {
		function render() {
			window.electron.getInstanceTabs().then(function(data) {
				var list = data.tabs || [];
				var activeIndex = data.activeIndex ?? 0;
				var root = document.getElementById('tabs');
				root.innerHTML = '';
				list.forEach(function(t, i) {
					var tab = document.createElement('span');
					tab.className = 'tab' + (t.isOfficial ? ' official' : '') + (i === activeIndex ? ' active' : '');
					var label = document.createElement('span');
					label.textContent = t.label;
					tab.appendChild(label);
					if (!t.isOfficial) {
						var close = document.createElement('span');
						close.className = 'tab-close';
						close.textContent = '×';
						close.onclick = function(e) { e.stopPropagation(); window.electron.removeInstanceTab(i); };
						tab.appendChild(close);
					}
					tab.onclick = function(e) { if (e.target.classList.contains('tab-close')) return; window.electron.switchTab(i); };
					root.appendChild(tab);
				});
			});
		}
		document.getElementById('add').onclick = function() {
			var raw = prompt('Enter instance URL (e.g. https://chat.niffbot.com)');
			if (!raw) return;
			window.electron.addInstanceTab(raw.trim());
		};
		render();
		window.electron.onInstanceTabsUpdated && window.electron.onInstanceTabsUpdated(render);
	})();
	</script></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isTabViewDestroyed(view: BrowserView | null | undefined): boolean {
	if (!view) return true;
	try {
		return typeof (view as BrowserView & {isDestroyed?: () => boolean}).isDestroyed === 'function' &&
			(view as BrowserView & {isDestroyed: () => boolean}).isDestroyed();
	} catch {
		return false;
	}
}

export function getActiveTabWebContents(): Electron.WebContents | null {
	const idx = getActiveTabIndex();
	const view = tabViews[idx];
	return view?.webContents ?? null;
}

export function setTabViewBounds(): void {
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return;
	const bounds = tabBarWindow.getBounds();
	const y = TAB_BAR_HEIGHT;
	const contentHeight = Math.max(1, bounds.height - y);
	const activeIdx = getActiveTabIndex();
	const activeView = tabViews[activeIdx];
	if (activeView && !isTabViewDestroyed(activeView)) {
		tabBarWindow.setBrowserView(activeView);
		activeView.setBounds({x: 0, y, width: bounds.width, height: contentHeight});
	} else {
		tabBarWindow.setBrowserView(null);
	}
	for (let i = 0; i < tabViews.length; i++) {
		if (i === activeIdx) continue;
		const view = tabViews[i];
		if (!isTabViewDestroyed(view)) {
			view.setBounds({x: 0, y, width: bounds.width, height: contentHeight});
		}
	}
}

export function notifyInstanceTabsUpdated(): void {
	tabBarWindow?.webContents.send('instance-tabs-updated');
}

export function switchActiveTab(index: number): void {
	setActiveTabIndex(index);
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return;
	const view = tabViews[index];
	if (view && !isTabViewDestroyed(view)) {
		tabBarWindow.setBrowserView(view);
	}
	setTabViewBounds();
	notifyInstanceTabsUpdated();
}

function loadTabUrl(view: BrowserView, url: string): void {
	view.webContents.loadURL(url).catch((error) => {
		logger.error('Failed to load tab URL', {url, error});
	});
}

function createTabBrowserView(instanceUrl: string, options: InstanceTabViewOptions): BrowserView | null {
	const preloadPath = path.join(__dirname, '../preload/index.cjs');
	const view = new BrowserView({
		webPreferences: options.getSharedWebPreferences(instanceUrl),
	});
	registerSpellcheck(view.webContents);
	registerDisplayMediaRequestHandler(view.webContents.session, view.webContents);
	view.webContents.on('will-navigate', (event, url) => {
		if (!options.isTrustedOrigin(url)) {
			event.preventDefault();
			shell.openExternal(url).catch((err) => logger.warn('Failed to open external URL', err));
		}
	});
	view.webContents.setWindowOpenHandler(({url, frameName}) => {
		const pathname = options.getSanitizedPath(url);
		if (frameName?.startsWith(POPOUT_NAMESPACE) && pathname === '/popout' && options.isTrustedOrigin(url)) {
			return {
				action: 'allow',
				overrideBrowserWindowOptions: options.getVoicePopoutWindowOptions(),
			};
		}
		if (options.isTrustedOrigin(url)) {
			return {action: 'deny'};
		}
		shell.openExternal(url).catch((err) => logger.warn('Failed to open external URL', err));
		return {action: 'deny'};
	});
	return view;
}

export function addTabAndSwitch(instanceOrigin: string, initialPath = '/'): void {
	const base = instanceOrigin.replace(/\/+$/, '');
	const loadUrl = `${base}${initialPath.startsWith('/') ? initialPath : `/${initialPath}`}`;
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return;
	const view = createTabBrowserView(loadUrl, tabBarWindowOptions);
	if (!view) return;
	tabViews.push(view);
	setActiveTabIndex(tabViews.length - 1);
	tabBarWindow.setBrowserView(view);
	setTabViewBounds();
	loadTabUrl(view, loadUrl);
	notifyInstanceTabsUpdated();
}

export function removeTabView(globalTabIndex: number): void {
	if (globalTabIndex <= 0) return;
	const view = tabViews[globalTabIndex];
	if (view && !isTabViewDestroyed(view)) {
		(view as BrowserView & {destroy?: () => void}).destroy?.();
	}
	tabViews = tabViews.filter((_, i) => i !== globalTabIndex);
	if (tabBarWindow && !tabBarWindow.isDestroyed()) {
		const newActive = getActiveTabIndex();
		const nextView = tabViews[newActive];
		if (nextView && !isTabViewDestroyed(nextView)) {
			tabBarWindow.setBrowserView(nextView);
		}
		setTabViewBounds();
		notifyInstanceTabsUpdated();
	}
}

export function switchOrAddInstanceTab(instanceOrigin: string, initialPath = '/'): void {
	const tabs = getInstanceTabsList();
	const existingIndex = tabs.findIndex((tab) => tab.url.replace(/\/+$/, '') === instanceOrigin.replace(/\/+$/, ''));
	if (existingIndex >= 0) {
		switchActiveTab(existingIndex);
		const view = tabViews[existingIndex];
		if (view && !isTabViewDestroyed(view) && initialPath !== '/') {
			const base = instanceOrigin.replace(/\/+$/, '');
			loadTabUrl(view, `${base}${initialPath.startsWith('/') ? initialPath : `/${initialPath}`}`);
		}
		return;
	}
	addInstanceUrl(instanceOrigin);
	addTabAndSwitch(instanceOrigin, initialPath);
}

let tabBarWindowOptions: InstanceTabViewOptions;

export function initializeInstanceTabShell(mainWindow: BrowserWindow, options: InstanceTabViewOptions): void {
	tabBarWindow = mainWindow;
	tabBarWindowOptions = options;
	const webContents = mainWindow.webContents;
	webContents.on('will-navigate', (event, url) => {
		if (!url.startsWith('data:')) {
			event.preventDefault();
		}
	});
	mainWindow.loadURL(getTabBarDataUrl()).catch((error) => {
		logger.error('Failed to load instance tab bar', error);
	});
	webContents.once('did-finish-load', () => {
		const tabs = getInstanceTabsList();
		tabViews = tabs
			.map((tab) => createTabBrowserView(tab.url, options))
			.filter((view): view is BrowserView => view != null);
		setTabViewBounds();
		for (let i = 0; i < tabViews.length && i < tabs.length; i++) {
			loadTabUrl(tabViews[i], tabs[i].url);
		}
		notifyInstanceTabsUpdated();
	});
}

export function destroyInstanceTabs(): void {
	for (const view of tabViews) {
		if (!isTabViewDestroyed(view)) {
			(view as BrowserView & {destroy?: () => void}).destroy?.();
		}
	}
	tabViews = [];
	tabBarWindow = null;
}

export function getInstanceTabsState(): {tabs: Array<InstanceTabInfo>; activeIndex: number} {
	return {
		tabs: getInstanceTabsList(),
		activeIndex: getActiveTabIndex(),
	};
}

export function removeInstanceTabAt(globalTabIndex: number): void {
	removeInstanceAtIndex(globalTabIndex);
	removeTabView(globalTabIndex);
}
