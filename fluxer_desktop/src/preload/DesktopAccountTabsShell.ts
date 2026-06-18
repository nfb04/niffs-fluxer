// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ElectronAPI} from '@electron/common/Types';
import {ipcRenderer} from 'electron';

const SHELL_ROOT_ID = 'fluxer-desktop-account-tabs-shell';
const STARTUP_NATIVE_TITLEBAR_ID = 'fluxer-startup-native-titlebar';
const MANAGED_KEY_EXACT = new Set(['token', 'userId', 'runtimeConfig', 'AccountManager']);
const MANAGED_KEY_PREFIX_PATTERN = /^(?:mobx|mobx-persist|persist|fluxer)/;

interface ShellAccount {
	userId: string;
	token: string | null;
	userData?: {
		username: string;
		discriminator: string;
		globalName?: string | null;
		avatar?: string | null;
	};
	presenceIntent?: unknown;
	localStorageData?: Record<string, string>;
	managedStorageData?: Record<string, string>;
	lastActive: number;
	instance?: {
		webAppEndpoint?: string;
		apiEndpoint?: string;
		mediaEndpoint?: string;
	};
	isValid?: boolean;
}

let installStarted = false;
let desktopAccountsEnabled: boolean | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let switching = false;

function isManagedStorageKey(key: string): boolean {
	if (!key) return false;
	return MANAGED_KEY_EXACT.has(key) || MANAGED_KEY_PREFIX_PATTERN.test(key);
}

function collectManagedStorageSnapshot(): Record<string, string> {
	const snapshot: Record<string, string> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !isManagedStorageKey(key)) continue;
			const value = localStorage.getItem(key);
			if (value != null) snapshot[key] = value;
		}
	} catch {
		return snapshot;
	}
	return snapshot;
}

function readCurrentUserId(): string | null {
	try {
		const value = localStorage.getItem('userId');
		if (!value || value === 'undefined' || value === 'null') return null;
		return value;
	} catch {
		return null;
	}
}

function readCurrentToken(): string | null {
	try {
		const value = localStorage.getItem('token');
		if (!value || value === 'undefined' || value === 'null') return null;
		return value;
	} catch {
		return null;
	}
}

function resolveWebAppOrigin(account: ShellAccount): string | null {
	const endpoint = account.instance?.webAppEndpoint;
	if (!endpoint) return null;
	try {
		return new URL(endpoint).origin;
	} catch {
		return null;
	}
}

function getInstanceHostLabel(account: ShellAccount): string | null {
	const endpoint = account.instance?.apiEndpoint ?? account.instance?.webAppEndpoint;
	if (!endpoint) return null;
	try {
		return new URL(endpoint).hostname;
	} catch {
		return null;
	}
}

function getAccountDisplayName(account: ShellAccount): string {
	const userData = account.userData;
	if (!userData) return account.userId.slice(0, 8);
	if (userData.globalName?.trim()) return userData.globalName.trim();
	return userData.username;
}

function getAccountInitial(account: ShellAccount): string {
	const name = getAccountDisplayName(account);
	return name.charAt(0).toUpperCase() || '?';
}

function normalizeInstanceOrigin(raw: string): string {
	const trimmed = raw.trim();
	const candidate = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
	const url = new URL(candidate);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Instance URL must use http or https');
	}
	return url.origin;
}

async function probeDesktopAccountsEnabled(): Promise<boolean> {
	if (desktopAccountsEnabled !== null) return desktopAccountsEnabled;
	try {
		await ipcRenderer.invoke('desktop-accounts-list');
		desktopAccountsEnabled = true;
	} catch {
		desktopAccountsEnabled = false;
	}
	return desktopAccountsEnabled;
}

async function listShellAccounts(): Promise<Array<ShellAccount>> {
	const accounts = (await ipcRenderer.invoke('desktop-accounts-list')) as Array<ShellAccount>;
	return Array.isArray(accounts) ? accounts : [];
}

async function stashCurrentAccount(existingAccounts: Array<ShellAccount>): Promise<void> {
	const userId = readCurrentUserId();
	const token = readCurrentToken();
	if (!userId || !token) return;
	const existing = existingAccounts.find((account) => account.userId === userId);
	const managedStorageData = collectManagedStorageSnapshot();
	let instance: ShellAccount['instance'];
	try {
		const runtimeConfig = localStorage.getItem('runtimeConfig');
		if (runtimeConfig) {
			const parsed = JSON.parse(runtimeConfig) as ShellAccount['instance'];
			instance = parsed ?? existing?.instance;
		}
	} catch {
		instance = existing?.instance;
	}
	await ipcRenderer.invoke('desktop-accounts-put', {
		userId,
		token,
		userData: existing?.userData,
		presenceIntent: existing?.presenceIntent,
		localStorageData: managedStorageData,
		managedStorageData,
		lastActive: Date.now(),
		instance: instance ?? existing?.instance,
		isValid: true,
	} satisfies ShellAccount);
}

function applyManagedStorageSnapshot(snapshot: Record<string, string>): void {
	for (const [key, value] of Object.entries(snapshot)) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// ignore quota errors
		}
	}
}

async function restoreSameOriginAccount(account: ShellAccount): Promise<void> {
	const managed = account.managedStorageData ?? account.localStorageData ?? {};
	applyManagedStorageSnapshot(managed);
	if (account.token) {
		localStorage.setItem('token', account.token);
	}
	localStorage.setItem('userId', account.userId);
	await ipcRenderer.invoke('desktop-accounts-put', {
		...account,
		lastActive: Date.now(),
		isValid: true,
	});
}

async function switchToAccount(account: ShellAccount): Promise<void> {
	if (switching) return;
	const currentUserId = readCurrentUserId();
	if (currentUserId === account.userId) return;
	switching = true;
	try {
		const accounts = await listShellAccounts();
		if (currentUserId) {
			await stashCurrentAccount(accounts);
		}
		const targetOrigin = resolveWebAppOrigin(account);
		if (targetOrigin && targetOrigin !== window.location.origin) {
			await ipcRenderer.invoke('switch-instance-url', {
				instanceUrl: targetOrigin,
				accountSwitchUserId: account.userId,
			} satisfies Parameters<NonNullable<ElectronAPI['switchInstanceUrl']>>[0]);
			return;
		}
		const stored = (await ipcRenderer.invoke('desktop-accounts-get', account.userId)) as ShellAccount | null;
		if (!stored) {
			throw new Error(`No stored data found for account ${account.userId}`);
		}
		await restoreSameOriginAccount(stored);
		window.location.reload();
	} finally {
		switching = false;
	}
}

async function openAddAccountFlow(): Promise<void> {
	const entered = window.prompt('Instance URL (leave empty for the current instance):', window.location.origin);
	if (entered === null) return;
	let targetOrigin = window.location.origin;
	if (entered.trim()) {
		try {
			targetOrigin = normalizeInstanceOrigin(entered);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			window.alert(detail);
			return;
		}
	}
	if (targetOrigin !== window.location.origin) {
		const accounts = await listShellAccounts();
		await stashCurrentAccount(accounts);
		await ipcRenderer.invoke('switch-instance-url', {
			instanceUrl: targetOrigin,
		});
		return;
	}
	window.location.assign('/login?handoff=1');
}

function injectShellStyles(): void {
	if (document.getElementById(`${SHELL_ROOT_ID}-styles`)) return;
	const style = document.createElement('style');
	style.id = `${SHELL_ROOT_ID}-styles`;
	style.textContent = `
#${SHELL_ROOT_ID} {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	max-width: min(52vw, 720px);
	flex: 1 1 auto;
	-webkit-app-region: no-drag;
}
#${SHELL_ROOT_ID} .fluxer-shell-tabs {
	display: flex;
	align-items: stretch;
	gap: 2px;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;
}
#${SHELL_ROOT_ID} .fluxer-shell-tabs::-webkit-scrollbar {
	display: none;
}
#${SHELL_ROOT_ID} .fluxer-shell-tab {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 180px;
	height: 26px;
	padding: 0 10px;
	border: 1px solid transparent;
	border-radius: 8px 8px 0 0;
	background: var(--background-tertiary, #2b2d31);
	color: var(--text-secondary, #b5bac1);
	font: 12px/1 system-ui, sans-serif;
	white-space: nowrap;
	cursor: pointer;
}
#${SHELL_ROOT_ID} .fluxer-shell-tab:hover {
	background: var(--background-secondary-alt, #35373c);
	color: var(--text-primary, #f2f3f5);
}
#${SHELL_ROOT_ID} .fluxer-shell-tab[data-active='true'] {
	background: var(--background-primary, #313338);
	border-color: var(--background-modifier-accent, #4e5058);
	color: var(--text-primary, #f2f3f5);
}
#${SHELL_ROOT_ID} .fluxer-shell-tab[data-expired='true'] {
	opacity: 0.65;
}
#${SHELL_ROOT_ID} .fluxer-shell-avatar {
	width: 18px;
	height: 18px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 10px;
	font-weight: 700;
	background: var(--background-modifier-accent, #4e5058);
	color: var(--text-primary, #f2f3f5);
	flex: 0 0 auto;
}
#${SHELL_ROOT_ID} .fluxer-shell-label {
	overflow: hidden;
	text-overflow: ellipsis;
}
#${SHELL_ROOT_ID} .fluxer-shell-instance {
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 88px;
	font-size: 10px;
	color: var(--text-tertiary, #949ba4);
}
#${SHELL_ROOT_ID} .fluxer-shell-actions {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	flex: 0 0 auto;
}
#${SHELL_ROOT_ID} .fluxer-shell-icon-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--text-secondary, #b5bac1);
	cursor: pointer;
	font: 16px/1 system-ui, sans-serif;
}
#${SHELL_ROOT_ID} .fluxer-shell-icon-button:hover {
	background: var(--background-secondary-alt, #35373c);
	color: var(--text-primary, #f2f3f5);
}
#${SHELL_ROOT_ID} .fluxer-shell-icon-button:disabled {
	opacity: 0.5;
	pointer-events: none;
}
`;
	document.head.appendChild(style);
}

function resolveTitlebarHost(): Element | null {
	const titlebars = Array.from(document.querySelectorAll('[data-native-titlebar]'));
	const appTitlebar = titlebars.find((element) => element.id !== STARTUP_NATIVE_TITLEBAR_ID);
	return appTitlebar ?? titlebars[0] ?? null;
}

function ensureShellRoot(titlebar: Element): HTMLElement {
	let root = document.getElementById(SHELL_ROOT_ID);
	if (root?.parentElement === titlebar) {
		return root;
	}
	if (root) {
		root.remove();
	}
	root = document.createElement('div');
	root.id = SHELL_ROOT_ID;
	const left = titlebar.firstElementChild;
	if (left?.nextElementSibling) {
		titlebar.insertBefore(root, left.nextElementSibling);
	} else {
		titlebar.appendChild(root);
	}
	return root;
}

async function renderShell(): Promise<void> {
	if (!(await probeDesktopAccountsEnabled())) {
		document.getElementById(SHELL_ROOT_ID)?.remove();
		return;
	}
	const titlebar = resolveTitlebarHost();
	if (!titlebar) return;
	injectShellStyles();
	const root = ensureShellRoot(titlebar);
	const accounts = (await listShellAccounts()).sort((a, b) => b.lastActive - a.lastActive);
	const currentUserId = readCurrentUserId();
	root.replaceChildren();
	if (accounts.length === 0) {
		root.style.display = 'none';
		return;
	}
	root.style.display = 'flex';
	const tabs = document.createElement('div');
	tabs.className = 'fluxer-shell-tabs';
	for (const account of accounts) {
		const isActive = account.userId === currentUserId;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'fluxer-shell-tab';
		button.dataset.active = isActive ? 'true' : 'false';
		if (account.isValid === false) {
			button.dataset.expired = 'true';
		}
		button.title = (() => {
			const host = getInstanceHostLabel(account);
			const name = getAccountDisplayName(account);
			return host ? `${name} · ${host}` : name;
		})();
		button.disabled = switching;
		button.addEventListener('click', () => {
			if (isActive || switching) return;
			void switchToAccount(account);
		});
		const avatar = document.createElement('span');
		avatar.className = 'fluxer-shell-avatar';
		avatar.textContent = getAccountInitial(account);
		const label = document.createElement('span');
		label.className = 'fluxer-shell-label';
		label.textContent = getAccountDisplayName(account);
		button.append(avatar, label);
		const host = getInstanceHostLabel(account);
		if (host) {
			const badge = document.createElement('span');
			badge.className = 'fluxer-shell-instance';
			badge.textContent = host;
			button.append(badge);
		}
		tabs.append(button);
	}
	const actions = document.createElement('div');
	actions.className = 'fluxer-shell-actions';
	const addButton = document.createElement('button');
	addButton.type = 'button';
	addButton.className = 'fluxer-shell-icon-button';
	addButton.title = 'Add account';
	addButton.setAttribute('aria-label', 'Add account');
	addButton.textContent = '+';
	addButton.disabled = switching;
	addButton.addEventListener('click', () => {
		void openAddAccountFlow();
	});
	actions.append(addButton);
	root.append(tabs, actions);
}

function scheduleRefresh(): void {
	void renderShell().catch(() => {
		// ignore render errors
	});
}

function observeTitlebar(): void {
	const observer = new MutationObserver(() => {
		scheduleRefresh();
	});
	const startObserving = (): void => {
		observer.observe(document.documentElement, {childList: true, subtree: true});
		scheduleRefresh();
	};
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', startObserving, {once: true});
	} else {
		startObserving();
	}
	window.addEventListener('focus', scheduleRefresh);
	window.addEventListener('storage', scheduleRefresh);
	if (refreshTimer) clearInterval(refreshTimer);
	refreshTimer = setInterval(scheduleRefresh, 3000);
}

export function installDesktopAccountTabsShell(): void {
	if (installStarted || typeof window === 'undefined') return;
	installStarted = true;
	observeTitlebar();
}
