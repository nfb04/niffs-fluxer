// SPDX-License-Identifier: AGPL-3.0-or-later

export const APP_PROTOCOL = 'fluxer';
const embeddedDefaultAppUrl =
	typeof process !== 'undefined' && typeof process.env.FLUXER_DEFAULT_APP_URL === 'string'
		? process.env.FLUXER_DEFAULT_APP_URL.trim()
		: '';
export const DEFAULT_SELF_HOSTED_APP_URL = embeddedDefaultAppUrl.length > 0 ? embeddedDefaultAppUrl : null;
export const STABLE_APP_URL = 'https://web.fluxer.app';
export const CANARY_APP_URL = 'https://web.canary.fluxer.app';
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;
