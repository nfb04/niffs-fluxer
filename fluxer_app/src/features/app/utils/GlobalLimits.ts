// SPDX-License-Identifier: AGPL-3.0-or-later

import {LimitResolver} from '@app/features/app/utils/LimitResolverAdapter';
import type {LimitKey} from '@fluxer/constants/src/LimitConfigMetadata';

const FALLBACKS = {
	emoji_max_size: 384 * 1024,
	sticker_max_size: 512 * 1024,
	soundboard_max_size: 2 * 1024 * 1024,
	soundboard_max_duration_sec: 30,
	max_guild_soundboard_sounds: 50,
	avatar_max_size: 10 * 1024 * 1024,
} as const;

class GlobalLimitsClass {
	getEmojiMaxSize(): number {
		return LimitResolver.resolve({
			key: 'emoji_max_size',
			fallback: FALLBACKS.emoji_max_size,
		});
	}

	getStickerMaxSize(): number {
		return LimitResolver.resolve({
			key: 'sticker_max_size',
			fallback: FALLBACKS.sticker_max_size,
		});
	}

	getSoundboardMaxSize(): number {
		return LimitResolver.resolve({
			key: 'soundboard_max_size',
			fallback: FALLBACKS.soundboard_max_size,
		});
	}

	getSoundboardMaxDurationSec(): number {
		return LimitResolver.resolve({
			key: 'soundboard_max_duration_sec',
			fallback: FALLBACKS.soundboard_max_duration_sec,
		});
	}

	getMaxGuildSoundboardSounds(): number {
		return LimitResolver.resolve({
			key: 'max_guild_soundboard_sounds',
			fallback: FALLBACKS.max_guild_soundboard_sounds,
		});
	}

	getAvatarMaxSize(): number {
		return LimitResolver.resolve({
			key: 'avatar_max_size',
			fallback: FALLBACKS.avatar_max_size,
		});
	}

	get(key: LimitKey, fallback: number): number {
		return LimitResolver.resolve({key, fallback});
	}
}

export const GlobalLimits = new GlobalLimitsClass();
