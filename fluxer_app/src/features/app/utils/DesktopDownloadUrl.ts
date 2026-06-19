// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {DESKTOP_DOWNLOAD_URL} from '@app/features/app/config/I18nDisplayConstants';

const DEFAULT_SELF_HOSTED_DESKTOP_DOWNLOAD_URL =
	'https://github.com/nfb04/niffs-fluxer/releases/download/0.0.1/niffbot-desktop-windows-x64.zip';

function resolveSelfHostedDesktopDownloadUrl(): string {
	const configured = import.meta.env.PUBLIC_SELF_HOSTED_DESKTOP_DOWNLOAD_URL;
	if (typeof configured === 'string' && configured.length > 0) {
		return configured;
	}
	return DEFAULT_SELF_HOSTED_DESKTOP_DOWNLOAD_URL;
}

export function resolveDesktopDownloadUrl(): string {
	if (RuntimeConfig.isSelfHosted()) {
		return resolveSelfHostedDesktopDownloadUrl();
	}
	return DESKTOP_DOWNLOAD_URL;
}
