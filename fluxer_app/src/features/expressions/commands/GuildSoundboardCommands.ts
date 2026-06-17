// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import type {
	GuildSoundboardListResponse,
	GuildSoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';

export async function list(guildId: string): Promise<GuildSoundboardListResponse> {
	const response = await http.get<GuildSoundboardListResponse>(Endpoints.GUILD_SOUNDBOARD(guildId));
	return response.body;
}

export async function create(
	guildId: string,
	name: string,
	audioBase64: string,
	emoji?: string,
): Promise<GuildSoundboardSoundResponse> {
	const response = await http.post<GuildSoundboardSoundResponse>(Endpoints.GUILD_SOUNDBOARD(guildId), {
		body: {
			name,
			audio: audioBase64,
			...(emoji != null && emoji !== '' ? {emoji} : {}),
		},
	});
	return response.body;
}

export async function update(
	guildId: string,
	soundId: string,
	name: string,
): Promise<GuildSoundboardSoundResponse> {
	const response = await http.patch<GuildSoundboardSoundResponse>(
		Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId),
		{body: {name}},
	);
	return response.body;
}

export async function remove(guildId: string, soundId: string): Promise<void> {
	await http.delete({url: Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId)});
}
