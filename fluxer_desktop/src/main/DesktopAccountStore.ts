// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';

export interface DesktopStoredAccount {
	userId: string;
	token: string | null;
	userData?: {
		username: string;
		discriminator: string;
		globalName?: string | null;
		email?: string | null;
		avatar?: string | null;
	};
	presenceIntent?: unknown;
	localStorageData: Record<string, string>;
	managedStorageData?: Record<string, string>;
	lastActive: number;
	instance?: Record<string, unknown>;
	isValid?: boolean;
}

interface DesktopAccountStoreFile {
	version: 1;
	accounts: Array<DesktopStoredAccount>;
}

let storePath: string | null = null;
let cache: DesktopAccountStoreFile | null = null;

function getDefaultStore(): DesktopAccountStoreFile {
	return {version: 1, accounts: []};
}

function readStore(): DesktopAccountStoreFile {
	if (cache) {
		return cache;
	}
	if (!storePath || !fs.existsSync(storePath)) {
		cache = getDefaultStore();
		return cache;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as unknown;
		if (
			parsed &&
			typeof parsed === 'object' &&
			(parsed as DesktopAccountStoreFile).version === 1 &&
			Array.isArray((parsed as DesktopAccountStoreFile).accounts)
		) {
			cache = parsed as DesktopAccountStoreFile;
			return cache;
		}
	} catch (error) {
		log.error('Failed to read desktop account store:', error);
	}
	cache = getDefaultStore();
	return cache;
}

function writeStore(store: DesktopAccountStoreFile): void {
	if (!storePath) {
		throw new Error('Desktop account store path not initialised');
	}
	cache = store;
	const tempPath = `${storePath}.${process.pid}.tmp`;
	fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf-8');
	fs.renameSync(tempPath, storePath);
}

export function initDesktopAccountStore(userDataPath: string): void {
	storePath = path.join(userDataPath, 'desktop-accounts.json');
	log.info('Desktop account store path:', storePath);
}

export function listDesktopAccounts(): Array<DesktopStoredAccount> {
	return [...readStore().accounts];
}

export function getDesktopAccount(userId: string): DesktopStoredAccount | null {
	if (!userId) {
		return null;
	}
	return readStore().accounts.find((account) => account.userId === userId) ?? null;
}

export function putDesktopAccount(account: DesktopStoredAccount): void {
	if (!account.userId) {
		throw new Error('Desktop account userId is required');
	}
	const store = readStore();
	const index = store.accounts.findIndex((entry) => entry.userId === account.userId);
	if (index >= 0) {
		store.accounts[index] = account;
	} else {
		store.accounts.push(account);
	}
	writeStore(store);
}

export function deleteDesktopAccount(userId: string): void {
	if (!userId) {
		return;
	}
	const store = readStore();
	const nextAccounts = store.accounts.filter((account) => account.userId !== userId);
	if (nextAccounts.length === store.accounts.length) {
		return;
	}
	writeStore({...store, accounts: nextAccounts});
}

export function replaceDesktopAccounts(accounts: Array<DesktopStoredAccount>): void {
	writeStore({version: 1, accounts: [...accounts]});
}
