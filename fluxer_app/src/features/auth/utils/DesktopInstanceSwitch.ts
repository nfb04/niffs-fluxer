// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Account} from '@app/features/platform/state/AuthSession';
import {getElectronAPI, isDesktop} from '@app/features/ui/utils/NativeUtils';

function resolveAccountWebAppOrigin(account: Account): string | null {
	const endpoint = account.instance?.webAppEndpoint;
	if (!endpoint) {
		return null;
	}
	try {
		return new URL(endpoint).origin;
	} catch {
		return null;
	}
}

export function accountRequiresInstanceReload(account: Account): boolean {
	if (!isDesktop()) {
		return false;
	}
	const targetOrigin = resolveAccountWebAppOrigin(account);
	if (!targetOrigin) {
		return false;
	}
	return targetOrigin !== window.location.origin;
}

export async function reloadDesktopToAccountInstance(account: Account): Promise<boolean> {
	const electronApi = getElectronAPI();
	if (!electronApi?.switchInstanceUrl) {
		return false;
	}
	const targetOrigin = resolveAccountWebAppOrigin(account);
	if (!targetOrigin || targetOrigin === window.location.origin) {
		return false;
	}
	await electronApi.switchInstanceUrl({
		instanceUrl: targetOrigin,
		accountSwitchUserId: account.userId,
	});
	return true;
}
