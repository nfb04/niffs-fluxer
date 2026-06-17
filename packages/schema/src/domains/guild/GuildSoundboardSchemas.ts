// SPDX-License-Identifier: AGPL-3.0-or-later

import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const GuildSoundboardSoundResponse = z.object({
	id: SnowflakeStringType.describe('The unique identifier for this sound'),
	name: z.string().describe('The display name of the sound'),
	emoji: z.string().optional().describe('Related emoji shortcode (e.g. smiley)'),
});

export type GuildSoundboardSoundResponse = z.infer<typeof GuildSoundboardSoundResponse>;

export const GuildSoundboardListResponse = z.object({
	sounds: z.array(GuildSoundboardSoundResponse).describe('List of custom soundboard sounds for the guild'),
});

export type GuildSoundboardListResponse = z.infer<typeof GuildSoundboardListResponse>;
