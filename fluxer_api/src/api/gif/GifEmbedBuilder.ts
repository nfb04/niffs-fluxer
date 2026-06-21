// SPDX-License-Identifier: AGPL-3.0-or-later

import {EmbedMediaFlags} from '@fluxer/constants/src/ChannelConstants';
import {Logger} from '@fluxer/logger/src/Logger';
import type {GifMediaFormat, GifResponse} from '@fluxer/schema/src/domains/gif/GifSchemas';
import type {MessageEmbedChild} from '../database/types/MessageTypes';
import type {GifService} from './GifService';
import type {IGifProvider} from './IGifProvider';

export function isRenderableGifEmbedFromModel(embed: {
	type: string;
	thumbnail: {url?: string | null; width?: number | null; height?: number | null} | null;
	video: {url?: string | null; width?: number | null; height?: number | null} | null;
}): boolean {
	if (embed.type !== 'image' && embed.type !== 'gifv') {
		return true;
	}
	return isRenderableGifEmbed({
		type: embed.type,
		thumbnail: embed.thumbnail as MessageEmbedChild['thumbnail'],
		video: embed.video as MessageEmbedChild['video'],
	});
}

function isRenderableGifEmbed(embed: Pick<MessageEmbedChild, 'type' | 'thumbnail' | 'video'>): boolean {
	if (embed.type === 'image') {
		return Boolean(embed.thumbnail?.url && embed.thumbnail.width && embed.thumbnail.height);
	}
	if (embed.type === 'gifv') {
		return Boolean(
			embed.video?.url &&
				embed.video.width &&
				embed.video.height &&
				(embed.thumbnail?.url ? embed.thumbnail.width && embed.thumbnail.height : true),
		);
	}
	return false;
}

const ANIMATED_IMAGE_FORMAT_PRIORITY = [
	'gif',
	'mediumgif',
	'tinygif',
	'nanogif',
	'webp',
	'mediumwebp',
	'tinywebp',
	'nanowebp',
] as const;
const VIDEO_FORMAT_PRIORITY = ['mp4', 'webm', 'tinymp4', 'tinywebm', 'mediummp4', 'mediumwebm'] as const;
const THUMB_FORMAT_PRIORITY = ['webp', 'gif', 'tinywebp', 'tinygif', 'mediumwebp', 'mediumgif'] as const;

const FORMAT_CONTENT_TYPES: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
	tinymp4: 'video/mp4',
	tinywebm: 'video/webm',
	mediummp4: 'video/mp4',
	mediumwebm: 'video/webm',
	webp: 'image/webp',
	gif: 'image/gif',
	tinywebp: 'image/webp',
	tinygif: 'image/gif',
	mediumwebp: 'image/webp',
	mediumgif: 'image/gif',
	nanowebp: 'image/webp',
	nanogif: 'image/gif',
};

const logger = new Logger('GifEmbedBuilder');

function pickFormat(
	media: Record<string, GifMediaFormat>,
	priority: ReadonlyArray<string>,
): {key: string; format: GifMediaFormat} | null {
	for (const key of priority) {
		const format = media[key];
		if (isUsableFormat(format)) return {key, format};
	}
	for (const [key, format] of Object.entries(media)) {
		if (isUsableFormat(format)) return {key, format};
	}
	return null;
}

function isUsableFormat(format: GifMediaFormat | undefined): format is GifMediaFormat {
	return Boolean(format?.src && format.width > 0 && format.height > 0);
}

function inferContentType(formatKey: string, animated: boolean): string {
	return FORMAT_CONTENT_TYPES[formatKey] ?? (animated ? 'image/gif' : 'image/webp');
}

function toEmbedMedia(format: GifMediaFormat, contentType: string, animated: boolean): MessageEmbedChild['video'] {
	return {
		url: format.src,
		width: format.width,
		height: format.height,
		content_type: contentType,
		content_hash: null,
		description: null,
		placeholder: null,
		duration: null,
		flags: animated ? EmbedMediaFlags.IS_ANIMATED : 0,
	};
}

function buildAnimatedImageEmbed(gif: GifResponse, pageUrl: string, imageFormat: GifMediaFormat, formatKey: string): MessageEmbedChild {
	return {
		type: 'image',
		title: null,
		description: null,
		url: pageUrl,
		timestamp: null,
		color: null,
		author: null,
		provider: null,
		thumbnail: toEmbedMedia(imageFormat, inferContentType(formatKey, true), true),
		image: null,
		video: null,
		audio: null,
		footer: null,
		fields: null,
		html: null,
		html_width: null,
		html_height: null,
		nsfw: null,
	};
}

function buildGifvEmbed(
	gif: GifResponse,
	pageUrl: string,
	videoFormat: GifMediaFormat,
	videoKey: string,
	thumbFormat: GifMediaFormat,
	thumbKey: string,
): MessageEmbedChild {
	const providerName = gif.provider === 'klipy' ? 'KLIPY' : gif.provider === 'tenor' ? 'Tenor' : gif.provider;
	const providerUrl =
		gif.provider === 'klipy' ? 'https://klipy.com' : gif.provider === 'tenor' ? 'https://tenor.com' : null;

	return {
		type: 'gifv',
		title: null,
		description: null,
		url: pageUrl,
		timestamp: null,
		color: null,
		author: null,
		provider: {
			name: providerName,
			url: providerUrl,
		},
		thumbnail: toEmbedMedia(thumbFormat, inferContentType(thumbKey, false), false),
		image: null,
		video: toEmbedMedia(videoFormat, inferContentType(videoKey, true), true),
		audio: null,
		footer: null,
		fields: null,
		html: null,
		html_width: null,
		html_height: null,
		nsfw: null,
	};
}

export function buildGifEmbedFromResponse(gif: GifResponse, pageUrl: string): MessageEmbedChild | null {
	const media = gif.media ?? {};
	const imagePick = pickFormat(media, ANIMATED_IMAGE_FORMAT_PRIORITY);
	if (imagePick) {
		return buildAnimatedImageEmbed(gif, pageUrl, imagePick.format, imagePick.key);
	}

	const videoPick = pickFormat(media, VIDEO_FORMAT_PRIORITY);
	const thumbPick = pickFormat(media, THUMB_FORMAT_PRIORITY);
	const videoFormat =
		videoPick?.format ??
		(gif.src && gif.width > 0 && gif.height > 0
			? {src: gif.src, proxy_src: gif.proxy_src, width: gif.width, height: gif.height}
			: null);
	const thumbFormat = thumbPick?.format ?? videoFormat;
	if (!videoFormat || !thumbFormat) return null;

	return buildGifvEmbed(
		gif,
		pageUrl,
		videoFormat,
		videoPick?.key ?? 'mp4',
		thumbFormat,
		thumbPick?.key ?? 'webp',
	);
}

/** @deprecated Use buildGifEmbedFromResponse */
export const buildGifvEmbedFromResponse = buildGifEmbedFromResponse;

async function resolveProviderGif(
	provider: IGifProvider,
	params: {url: string; locale: string; country: string; cacheOnly?: boolean},
): Promise<GifResponse | null> {
	try {
		return await provider.resolveByUrl(params);
	} catch (error) {
		logger.warn({error, provider: provider.meta.name, url: params.url}, 'Failed to resolve GIF provider URL for embed');
		return null;
	}
}

export function isGifMediaEmbedType(type: string | null | undefined): boolean {
	return type === 'gifv' || type === 'image';
}

export async function isGifProviderUrl(url: string, gifService: GifService): Promise<boolean> {
	for (const provider of gifService.listProviders()) {
		if (!(await provider.isAvailable())) continue;
		if (provider.extractSlugFromUrl(url)) return true;
	}
	return false;
}

export interface ResolveGifEmbedOptions {
	cacheOnly?: boolean;
	locale?: string;
	country?: string;
}

export async function resolveGifEmbedFromProviders(
	url: string,
	gifService: GifService,
	options: ResolveGifEmbedOptions = {},
): Promise<MessageEmbedChild | null> {
	const locale = options.locale ?? 'en_US';
	const country = options.country ?? 'US';
	for (const provider of gifService.listProviders()) {
		if (!(await provider.isAvailable()) || !provider.extractSlugFromUrl(url)) continue;
		const gif = await resolveProviderGif(provider, {url, locale, country, cacheOnly: options.cacheOnly});
		if (!gif) continue;
		const embed = buildGifEmbedFromResponse(gif, url);
		if (embed) return embed;
	}
	return null;
}

/** @deprecated Use resolveGifEmbedFromProviders */
export const resolveGifvEmbedFromProviders = resolveGifEmbedFromProviders;
