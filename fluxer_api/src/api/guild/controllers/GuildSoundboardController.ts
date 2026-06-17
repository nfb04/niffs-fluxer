// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildIdParam, GuildIdSoundIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	GuildSoundboardListResponse,
	GuildSoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {
	GuildSoundboardCreateRequest,
	GuildSoundboardUpdateRequest,
} from '@fluxer/schema/src/domains/guild/GuildRequestSchemas';
import {createGuildID} from '../../BrandedTypes';
import {LoginRequired} from '../../middleware/AuthMiddleware';
import {RateLimitMiddleware} from '../../middleware/RateLimitMiddleware';
import {OpenAPI} from '../../middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '../../RateLimitConfig';
import type {HonoApp} from '../../types/HonoEnv';
import {Validator} from '../../Validator';

export function GuildSoundboardController(app: HonoApp) {
	app.get(
		'/guilds/:guild_id/soundboard',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_LIST),
		LoginRequired,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'list_guild_soundboard',
			summary: 'List guild soundboard sounds',
			responseSchema: GuildSoundboardListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
			description: 'List custom soundboard sounds for the guild. Requires guild access.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const result = await ctx.get('guildService').content.listSoundboardSounds({userId: user.id, guildId});
			return ctx.json(result);
		},
	);

	app.post(
		'/guilds/:guild_id/soundboard',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_CREATE),
		LoginRequired,
		Validator('param', GuildIdParam),
		Validator('json', GuildSoundboardCreateRequest),
		OpenAPI({
			operationId: 'create_guild_soundboard_sound',
			summary: 'Create guild soundboard sound',
			responseSchema: GuildSoundboardSoundResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
			description:
				'Upload a custom soundboard sound for the guild. Requires manage expressions permission. Max 50 sounds per guild, 2MB per file.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const {name, audio, emoji} = ctx.req.valid('json');
			const result = await ctx.get('guildService').content.createSoundboardSound({
				user,
				guildId,
				name,
				audioBase64: audio,
				emoji,
			});
			return ctx.json(result);
		},
	);

	app.patch(
		'/guilds/:guild_id/soundboard/:sound_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_UPDATE),
		LoginRequired,
		Validator('param', GuildIdSoundIdParam),
		Validator('json', GuildSoundboardUpdateRequest),
		OpenAPI({
			operationId: 'update_guild_soundboard_sound',
			summary: 'Update guild soundboard sound',
			responseSchema: GuildSoundboardSoundResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
			description: 'Rename a custom soundboard sound. Requires manage expressions permission.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {guild_id, sound_id} = ctx.req.valid('param');
			const {name} = ctx.req.valid('json');
			const guildId = createGuildID(guild_id);
			const result = await ctx
				.get('guildService')
				.content.updateSoundboardSound({userId: user.id, guildId, soundId: sound_id, name});
			return ctx.json(result);
		},
	);

	app.delete(
		'/guilds/:guild_id/soundboard/:sound_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_DELETE),
		LoginRequired,
		Validator('param', GuildIdSoundIdParam),
		OpenAPI({
			operationId: 'delete_guild_soundboard_sound',
			summary: 'Delete guild soundboard sound',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
			description: 'Remove a custom soundboard sound from the guild. Requires manage expressions permission.',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {guild_id, sound_id} = ctx.req.valid('param');
			const guildId = createGuildID(guild_id);
			await ctx.get('guildService').content.deleteSoundboardSound({userId: user.id, guildId, soundId: sound_id});
			return ctx.body(null, 204);
		},
	);
}
