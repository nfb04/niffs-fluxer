// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {DESKTOP_DOWNLOAD_URL} from '@app/features/app/config/I18nDisplayConstants';

export function resolveDesktopDownloadUrl(): string {
	if (RuntimeConfig.isSelfHosted()) {
		try {
			return new URL('/download/', RuntimeConfig.webAppBaseUrl).toString();
		} catch {
			// fall through to official download page
		}
	}
	return DESKTOP_DOWNLOAD_URL;
}
