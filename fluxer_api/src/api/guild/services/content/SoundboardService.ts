// SPDX-License-Identifier: AGPL-3.0-or-later

import {MAX_GUILD_SOUNDBOARD_SOUNDS, SOUNDBOARD_MAX_SIZE} from '@fluxer/constants/src/LimitConstants';
import type {LimitKey} from '@fluxer/constants/src/LimitConfigMetadata';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {resolveLimit} from '@fluxer/limits/src/LimitResolver';
import type {
	GuildSoundboardListResponse,
	GuildSoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import type {GuildID, UserID} from '../../../BrandedTypes';
import {Config} from '../../../Config';
import type {ISnowflakeService} from '../../../infrastructure/ISnowflakeService';
import type {IStorageService} from '../../../infrastructure/IStorageService';
import type {LimitConfigService} from '../../../limits/LimitConfigService';
import {createLimitMatchContext} from '../../../limits/LimitMatchContextBuilder';
import type {User} from '../../../models/User';
import type {ContentHelpers} from './ContentHelpers';

const SOUNDBOARD_PREFIX = 'soundboard';
const MANIFEST_KEY = 'manifest.json';

interface ManifestEntry {
	id: string;
	name: string;
	emoji?: string;
	ext?: 'mp3' | 'wav';
}

function manifestKey(guildId: GuildID): string {
	return `${SOUNDBOARD_PREFIX}/${guildId.toString()}/${MANIFEST_KEY}`;
}

function soundKey(guildId: GuildID, soundId: string, ext: 'mp3' | 'wav' = 'mp3'): string {
	return `${SOUNDBOARD_PREFIX}/${guildId.toString()}/${soundId}.${ext}`;
}

const RIFF_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46]);

export class SoundboardService {
	constructor(
		private readonly storageService: IStorageService,
		private readonly snowflakeService: ISnowflakeService,
		private readonly contentHelpers: ContentHelpers,
		private readonly limitConfigService: LimitConfigService,
	) {}

	private resolveGuildLimit(key: LimitKey, fallback: number): number {
		const ctx = createLimitMatchContext({user: null, guildFeatures: null});
		const resolved = resolveLimit(this.limitConfigService.getConfigSnapshot(), ctx, key, {
			evaluationContext: 'guild',
		});
		if (!Number.isFinite(resolved) || resolved < 0) {
			return fallback;
		}
		return Math.floor(resolved);
	}

	async listSounds(params: {userId: UserID; guildId: GuildID}): Promise<GuildSoundboardListResponse> {
		const {userId, guildId} = params;
		await this.contentHelpers.getGuildData({userId, guildId});

		const bucket = Config.s3.buckets.cdn;
		const key = manifestKey(guildId);
		let manifest: ManifestEntry[];
		try {
			const data = await this.storageService.readObject(bucket, key);
			manifest = JSON.parse(Buffer.from(data).toString('utf8')) as ManifestEntry[];
			if (!Array.isArray(manifest)) manifest = [];
		} catch {
			manifest = [];
		}

		const sounds: Array<GuildSoundboardSoundResponse> = manifest.map((entry) => ({
			id: entry.id,
			name: entry.name,
			...(entry.emoji != null && entry.emoji !== '' ? {emoji: entry.emoji} : {}),
		}));
		return {sounds};
	}

	async createSound(params: {
		user: User;
		guildId: GuildID;
		name: string;
		audioBase64: string;
		emoji?: string;
	}): Promise<GuildSoundboardSoundResponse> {
		const {user, guildId, name, audioBase64, emoji} = params;
		await this.contentHelpers.getGuildData({userId: user.id, guildId});
		await this.contentHelpers.checkCreateExpressionsPermission({userId: user.id, guildId});

		const bucket = Config.s3.buckets.cdn;
		let audioBuffer: Buffer;
		try {
			audioBuffer = Buffer.from(audioBase64, 'base64');
		} catch {
			throw InputValidationError.fromCode('body.audio', ValidationErrorCodes.INVALID_IMAGE_DATA);
		}
		const maxSize = this.resolveGuildLimit('soundboard_max_size', SOUNDBOARD_MAX_SIZE);
		if (audioBuffer.length > maxSize) {
			throw InputValidationError.fromCode('body.audio', ValidationErrorCodes.IMAGE_SIZE_EXCEEDS_LIMIT, {
				maxSize,
			});
		}
		if (audioBuffer.length === 0) {
			throw InputValidationError.fromCode('body.audio', ValidationErrorCodes.INVALID_IMAGE_DATA);
		}

		const existing = await this.listSounds({userId: user.id, guildId});
		const maxSounds = this.resolveGuildLimit('max_guild_soundboard_sounds', MAX_GUILD_SOUNDBOARD_SOUNDS);
		if (existing.sounds.length >= maxSounds) {
			throw InputValidationError.fromCode('body', ValidationErrorCodes.MAX_GUILD_SOUNDBOARD_SOUNDS_REACHED, {
				max: maxSounds,
			});
		}

		const isWav = audioBuffer.length >= 4 && audioBuffer.subarray(0, 4).equals(RIFF_HEADER);
		const ext: 'mp3' | 'wav' = isWav ? 'wav' : 'mp3';
		const soundId = (await this.snowflakeService.generate()).toString();
		const key = soundKey(guildId, soundId, ext);
		await this.storageService.uploadObject({
			bucket,
			key,
			body: new Uint8Array(audioBuffer),
			contentType: isWav ? 'audio/wav' : 'audio/mpeg',
		});

		let manifest: ManifestEntry[];
		const manifestKeyPath = manifestKey(guildId);
		try {
			const data = await this.storageService.readObject(bucket, manifestKeyPath);
			manifest = JSON.parse(Buffer.from(data).toString('utf8')) as ManifestEntry[];
			if (!Array.isArray(manifest)) manifest = [];
		} catch {
			manifest = [];
		}
		const entry: ManifestEntry = {id: soundId, name, ext};
		if (emoji != null && emoji.trim() !== '') {
			entry.emoji = emoji.trim().slice(0, 64);
		}
		manifest.push(entry);
		await this.storageService.uploadObject({
			bucket,
			key: manifestKeyPath,
			body: new Uint8Array(Buffer.from(JSON.stringify(manifest), 'utf8')),
			contentType: 'application/json',
		});

		return {
			id: soundId,
			name,
			...(entry.emoji != null ? {emoji: entry.emoji} : {}),
		};
	}

	async deleteSound(params: {userId: UserID; guildId: GuildID; soundId: string}): Promise<void> {
		const {userId, guildId, soundId} = params;
		const soundIdStr = String(soundId);
		await this.contentHelpers.getGuildData({userId, guildId});
		await this.contentHelpers.checkCreateExpressionsPermission({userId, guildId});

		const bucket = Config.s3.buckets.cdn;
		const manifestKeyPath = manifestKey(guildId);

		let manifest: ManifestEntry[];
		try {
			const data = await this.storageService.readObject(bucket, manifestKeyPath);
			manifest = JSON.parse(Buffer.from(data).toString('utf8')) as ManifestEntry[];
			if (!Array.isArray(manifest)) manifest = [];
		} catch {
			manifest = [];
		}
		const entry = manifest.find((e) => String(e.id) === soundIdStr);
		manifest = manifest.filter((e) => String(e.id) !== soundIdStr);
		await this.storageService.uploadObject({
			bucket,
			key: manifestKeyPath,
			body: new Uint8Array(Buffer.from(JSON.stringify(manifest), 'utf8')),
			contentType: 'application/json',
		});

		const ext = entry?.ext ?? 'mp3';
		const fileKey = soundKey(guildId, soundIdStr, ext);
		await this.storageService.deleteObject(bucket, fileKey);
	}

	async updateSound(params: {
		userId: UserID;
		guildId: GuildID;
		soundId: string;
		name: string;
	}): Promise<GuildSoundboardSoundResponse> {
		const {userId, guildId, soundId, name} = params;
		const soundIdStr = String(soundId);
		await this.contentHelpers.getGuildData({userId, guildId});
		await this.contentHelpers.checkCreateExpressionsPermission({userId, guildId});

		const bucket = Config.s3.buckets.cdn;
		const manifestKeyPath = manifestKey(guildId);
		let manifest: ManifestEntry[];
		try {
			const data = await this.storageService.readObject(bucket, manifestKeyPath);
			manifest = JSON.parse(Buffer.from(data).toString('utf8')) as ManifestEntry[];
			if (!Array.isArray(manifest)) manifest = [];
		} catch {
			throw new Error('Soundboard manifest not found');
		}
		const entry = manifest.find((e) => String(e.id) === soundIdStr);
		if (!entry) {
			throw new Error('Soundboard sound not found');
		}
		entry.name = name;
		await this.storageService.uploadObject({
			bucket,
			key: manifestKeyPath,
			body: new Uint8Array(Buffer.from(JSON.stringify(manifest), 'utf8')),
			contentType: 'application/json',
		});
		return {id: soundIdStr, name};
	}
}
