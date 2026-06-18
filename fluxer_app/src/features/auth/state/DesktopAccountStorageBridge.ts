// SPDX-License-Identifier: AGPL-3.0-or-later

import type {StoredAccount} from '@app/features/auth/state/AccountStorage';
import {getElectronAPI} from '@app/features/ui/utils/NativeUtils';

function getDesktopAccountsApi() {
	const api = getElectronAPI();
	if (
		!api?.desktopAccountsList ||
		!api.desktopAccountsGet ||
		!api.desktopAccountsPut ||
		!api.desktopAccountsDelete
	) {
		return null;
	}
	return api;
}

export function canUseDesktopAccountStore(): boolean {
	return getDesktopAccountsApi() != null;
}

export async function listDesktopStoredAccounts(): Promise<Array<StoredAccount>> {
	const api = getDesktopAccountsApi();
	if (!api) {
		return [];
	}
	const accounts = await api.desktopAccountsList();
	return accounts as Array<StoredAccount>;
}

export async function getDesktopStoredAccount(userId: string): Promise<StoredAccount | null> {
	const api = getDesktopAccountsApi();
	if (!api) {
		return null;
	}
	const account = await api.desktopAccountsGet(userId);
	return (account as StoredAccount | null) ?? null;
}

export async function putDesktopStoredAccount(account: StoredAccount): Promise<void> {
	const api = getDesktopAccountsApi();
	if (!api) {
		return;
	}
	await api.desktopAccountsPut(account as unknown as Record<string, unknown>);
}

export async function deleteDesktopStoredAccount(userId: string): Promise<void> {
	const api = getDesktopAccountsApi();
	if (!api) {
		return;
	}
	await api.desktopAccountsDelete(userId);
}
