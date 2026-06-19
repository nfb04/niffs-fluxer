// SPDX-License-Identifier: AGPL-3.0-or-later

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
import {BrowserWindow, shell, WebContentsView} from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createChildLogger('InstanceTabs');

export const TAB_BAR_HEIGHT = 40;
const TAB_VIEW_BACKGROUND = '#1a1a1a';
const POPOUT_NAMESPACE = 'fluxer_';

let tabViews: Array<WebContentsView> = [];
let tabBarView: WebContentsView | null = null;
let tabBarWindow: BrowserWindow | null = null;

export interface InstanceTabViewOptions {
	isTrustedOrigin(url?: string): boolean;
	getSanitizedPath(rawUrl: string): string | null;
	getTabWebPreferences(appUrl: string): Electron.WebPreferences;
	getVoicePopoutWindowOptions(): Electron.BrowserWindowConstructorOptions;
	isVoicePopoutWindowName(frameName: string | undefined): boolean;
}

function getTabBarDataUrl(): string {
	const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		* { box-sizing: border-box; }
		html, body { margin: 0; height: ${TAB_BAR_HEIGHT}px; overflow: hidden; }
		body { font-family: system-ui, sans-serif; font-size: 13px; background: #2b2d31; color: #b5bac1; -webkit-app-region: drag; user-select: none; display: flex; align-items: center; padding: 0 8px; gap: 8px; }
		.tabs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1; overflow-x: auto; }
		.tab { padding: 6px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; -webkit-app-region: no-drag; }
		.tab:hover { background: rgba(255,255,255,0.06); color: #fff; }
		.tab.active { background: #404249; color: #fff; }
		.tab-close { margin-left: 4px; padding: 0 4px; opacity: 0.6; font-size: 14px; -webkit-app-region: no-drag; }
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
			window.electron.promptAddInstanceTab();
		};
		render();
		window.electron.onInstanceTabsUpdated && window.electron.onInstanceTabsUpdated(render);
	})();
	</script></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isTabViewAlive(view: WebContentsView | null | undefined): boolean {
	if (!view) return false;
	try {
		return !view.webContents.isDestroyed();
	} catch {
		return false;
	}
}

function getTabBarBounds(): {x: number; y: number; width: number; height: number} | null {
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return null;
	const bounds = tabBarWindow.getContentBounds();
	return {
		x: 0,
		y: 0,
		width: Math.max(1, bounds.width),
		height: TAB_BAR_HEIGHT,
	};
}

function attachTabBarViewOnTop(): void {
	if (!tabBarWindow || tabBarWindow.isDestroyed() || !tabBarView) return;
	const contentView = tabBarWindow.contentView;
	try {
		contentView.removeChildView(tabBarView);
	} catch {}
	contentView.addChildView(tabBarView);
	tabBarView.setVisible(true);
}

function setTabBarBounds(): void {
	const bounds = getTabBarBounds();
	if (!bounds || !tabBarView) return;
	tabBarView.setBounds(bounds);
	attachTabBarViewOnTop();
}

function createTabBarWebContentsView(): WebContentsView {
	const preloadPath = path.join(__dirname, '../preload/index.cjs');
	const view = new WebContentsView({
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	view.setBackgroundColor('#2b2d31');
	return view;
}

function getContentAreaBounds(): {x: number; y: number; width: number; height: number} | null {
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return null;
	const bounds = tabBarWindow.getContentBounds();
	const y = TAB_BAR_HEIGHT;
	return {
		x: 0,
		y,
		width: Math.max(1, bounds.width),
		height: Math.max(1, bounds.height - y),
	};
}

function attachTabView(view: WebContentsView, visible: boolean): void {
	if (!tabBarWindow || tabBarWindow.isDestroyed()) return;
	const contentView = tabBarWindow.contentView;
	try {
		contentView.removeChildView(view);
	} catch {}
	contentView.addChildView(view);
	view.setVisible(visible);
}

function destroyTabView(view: WebContentsView): void {
	if (tabBarWindow && !tabBarWindow.isDestroyed()) {
		try {
			tabBarWindow.contentView.removeChildView(view);
		} catch {}
	}
	if (isTabViewAlive(view)) {
		try {
			view.webContents.close();
		} catch {}
	}
}

export function getActiveTabWebContents(): Electron.WebContents | null {
	const idx = getActiveTabIndex();
	const view = tabViews[idx];
	return isTabViewAlive(view) ? view.webContents : null;
}

export function focusActiveTabWebContents(): void {
	const webContents = getActiveTabWebContents();
	if (!webContents || webContents.isDestroyed()) return;
	try {
		webContents.focus();
	} catch (error) {
		logger.warn('Failed to focus active tab webContents', error);
	}
}

export function setTabViewBounds(): void {
	const area = getContentAreaBounds();
	if (!area) return;
	const activeIdx = getActiveTabIndex();
	for (let i = 0; i < tabViews.length; i++) {
		const view = tabViews[i];
		if (!isTabViewAlive(view)) continue;
		view.setBounds(area);
		view.setVisible(i === activeIdx);
		if (i === activeIdx) {
			attachTabView(view, true);
		}
	}
	setTabBarBounds();
}

export function notifyInstanceTabsUpdated(): void {
	tabBarView?.webContents.send('instance-tabs-updated');
}

export function switchActiveTab(index: number): void {
	setActiveTabIndex(index);
	setTabViewBounds();
	focusActiveTabWebContents();
	notifyInstanceTabsUpdated();
}

function loadTabUrl(view: WebContentsView, url: string): void {
	const webContents = view.webContents;
	webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		if (isMainFrame) {
			logger.error('Tab main-frame load failed', {errorCode, errorDescription, validatedURL});
		}
	});
	logger.info('Loading instance tab URL', {url});
	webContents.loadURL(url).catch((error) => {
		logger.error('Failed to load tab URL', {url, error});
	});
}

function createTabWebContentsView(instanceUrl: string, options: InstanceTabViewOptions): WebContentsView {
	const view = new WebContentsView({
		webPreferences: options.getTabWebPreferences(instanceUrl),
	});
	view.setBackgroundColor(TAB_VIEW_BACKGROUND);
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
	const view = createTabWebContentsView(loadUrl, tabBarWindowOptions);
	tabViews.push(view);
	const newIndex = tabViews.length - 1;
	setActiveTabIndex(newIndex);
	attachTabView(view, true);
	setTabViewBounds();
	loadTabUrl(view, loadUrl);
	notifyInstanceTabsUpdated();
}

export function removeTabView(globalTabIndex: number): void {
	if (globalTabIndex <= 0) return;
	const view = tabViews[globalTabIndex];
	if (view) {
		destroyTabView(view);
	}
	tabViews = tabViews.filter((_, i) => i !== globalTabIndex);
	setTabViewBounds();
	notifyInstanceTabsUpdated();
}

export function switchOrAddInstanceTab(instanceOrigin: string, initialPath = '/'): void {
	const tabs = getInstanceTabsList();
	const existingIndex = tabs.findIndex((tab) => tab.url.replace(/\/+$/, '') === instanceOrigin.replace(/\/+$/, ''));
	if (existingIndex >= 0) {
		switchActiveTab(existingIndex);
		const view = tabViews[existingIndex];
		if (isTabViewAlive(view) && initialPath !== '/') {
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
	tabBarView = createTabBarWebContentsView();
	setTabBarBounds();
	void mainWindow.loadURL('about:blank');
	tabBarView.webContents.loadURL(getTabBarDataUrl()).catch((error) => {
		logger.error('Failed to load instance tab bar', error);
	});
	tabBarView.webContents.once('did-finish-load', () => {
		const tabs = getInstanceTabsList();
		const activeIdx = getActiveTabIndex();
		tabViews = tabs.map((tab) => createTabWebContentsView(tab.url, options));
		for (let i = 0; i < tabViews.length; i++) {
			attachTabView(tabViews[i], i === activeIdx);
		}
		setTabViewBounds();
		for (let i = 0; i < tabViews.length && i < tabs.length; i++) {
			loadTabUrl(tabViews[i], tabs[i].url);
		}
		notifyInstanceTabsUpdated();
	});
}

export function destroyInstanceTabs(): void {
	for (const view of tabViews) {
		destroyTabView(view);
	}
	tabViews = [];
	if (tabBarView) {
		destroyTabView(tabBarView);
		tabBarView = null;
	}
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

function getAddInstancePromptHtml(): string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		* { box-sizing: border-box; }
		body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #2b2d31; color: #dbdee1; }
		label { display: block; font-size: 13px; margin-bottom: 8px; }
		input { width: 100%; padding: 8px 10px; border-radius: 4px; border: 1px solid #1e1f22; background: #1e1f22; color: #fff; font-size: 13px; }
		input:focus { outline: 2px solid #5865f2; border-color: #5865f2; }
		.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
		button { border: 0; border-radius: 4px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
		.cancel { background: transparent; color: #b5bac1; }
		.cancel:hover { color: #fff; }
		.submit { background: #5865f2; color: #fff; }
		.submit:hover { background: #4752c4; }
		.error { color: #f23f43; font-size: 12px; margin-top: 8px; min-height: 16px; }
	</style></head><body>
		<label for="url">Instance URL</label>
		<input id="url" type="url" placeholder="https://chat.niffbot.com" autofocus />
		<div class="error" id="error"></div>
		<div class="actions">
			<button type="button" class="cancel" id="cancel">Cancel</button>
			<button type="button" class="submit" id="submit">Add</button>
		</div>
		<script>
		(function() {
			var input = document.getElementById('url');
			var error = document.getElementById('error');
			function submit() {
				var value = (input.value || '').trim();
				if (!value) {
					error.textContent = 'Instance URL is required';
					return;
				}
				window.electron.addInstanceTab(value).then(function() {
					window.electron.closeAddInstancePrompt();
				}).catch(function(err) {
					error.textContent = err && err.message ? err.message : String(err);
				});
			}
			document.getElementById('submit').onclick = submit;
			document.getElementById('cancel').onclick = function() { window.electron.closeAddInstancePrompt(); };
			input.addEventListener('keydown', function(e) {
				if (e.key === 'Enter') submit();
				if (e.key === 'Escape') window.electron.closeAddInstancePrompt();
			});
		})();
		</script></body></html>`;
}

let addInstancePromptWindow: BrowserWindow | null = null;

export async function promptAddInstanceTabDialog(parent: BrowserWindow | null): Promise<void> {
	if (!parent || parent.isDestroyed()) return;
	if (addInstancePromptWindow && !addInstancePromptWindow.isDestroyed()) {
		addInstancePromptWindow.focus();
		return;
	}
	const preloadPath = path.join(__dirname, '../preload/index.cjs');
	addInstancePromptWindow = new BrowserWindow({
		parent,
		modal: true,
		width: 440,
		height: 180,
		resizable: false,
		minimizable: false,
		maximizable: false,
		show: false,
		autoHideMenuBar: true,
		title: 'Add instance',
		backgroundColor: '#2b2d31',
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	addInstancePromptWindow.on('closed', () => {
		addInstancePromptWindow = null;
	});
	await addInstancePromptWindow.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(getAddInstancePromptHtml())}`,
	);
	addInstancePromptWindow.show();
}

export function closeAddInstancePromptDialog(): void {
	if (addInstancePromptWindow && !addInstancePromptWindow.isDestroyed()) {
		addInstancePromptWindow.close();
	}
	addInstancePromptWindow = null;
}
