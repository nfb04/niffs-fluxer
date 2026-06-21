// SPDX-License-Identifier: AGPL-3.0-or-later

import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import {isNativeVoiceEngineSelected} from '@app/features/voice/engine/native_voice_engine/NativeVoiceEngineSelection';
import {getVoiceEngineV2AppNativeBridge} from '@app/features/voice/engine/v2/VoiceEngineV2AppNativeBridge';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {VoiceEngineV2BridgeApi} from '@fluxer/voice_engine_v2/bridge';
import type {Room} from 'livekit-client';
import {Track} from 'livekit-client';

const logger = new Logger('VoiceSoundboardUtils');

const SOUNDBOARD_SAMPLE_RATE = 48_000;
const SOUNDBOARD_CHANNELS = 1;
const SOUNDBOARD_FRAME_MS = 10;
const SOUNDBOARD_SAMPLES_PER_FRAME = (SOUNDBOARD_SAMPLE_RATE * SOUNDBOARD_FRAME_MS) / 1000;
const SOUNDBOARD_IPC_CHUNK_FRAMES = 5;

function floatToInt16Pcm(samples: Float32Array): Int16Array {
	const pcm = new Int16Array(samples.length);
	for (let index = 0; index < samples.length; index += 1) {
		const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
		pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
	}
	return pcm;
}

async function decodeBlobTo48kMonoPcm(blob: Blob): Promise<Int16Array> {
	const decodeContext = new AudioContext();
	try {
		const arrayBuffer = await blob.arrayBuffer();
		const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
		const offline = new OfflineAudioContext(
			SOUNDBOARD_CHANNELS,
			Math.max(1, Math.ceil(decoded.duration * SOUNDBOARD_SAMPLE_RATE)),
			SOUNDBOARD_SAMPLE_RATE,
		);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		source.connect(offline.destination);
		source.start();
		const rendered = await offline.startRendering();
		return floatToInt16Pcm(rendered.getChannelData(0));
	} finally {
		await decodeContext.close().catch(() => undefined);
	}
}

async function playSoundboardSoundLocally(blob: Blob): Promise<void> {
	const audioContext = new AudioContext();
	try {
		const arrayBuffer = await blob.arrayBuffer();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(audioContext.destination);
		await new Promise<void>((resolve) => {
			source.onended = () => resolve();
			source.start();
		});
	} catch (error) {
		logger.error('Local soundboard preview failed', error);
	} finally {
		await audioContext.close().catch(() => undefined);
	}
}

async function streamPcmThroughNativeBridge(bridge: VoiceEngineV2BridgeApi, pcm: Int16Array): Promise<void> {
	await bridge.publishSoundboardAudio({
		sampleRate: SOUNDBOARD_SAMPLE_RATE,
		numChannels: SOUNDBOARD_CHANNELS,
	});
	try {
		const chunkSamples = SOUNDBOARD_SAMPLES_PER_FRAME * SOUNDBOARD_IPC_CHUNK_FRAMES;
		for (let offset = 0; offset < pcm.length; offset += chunkSamples) {
			const chunk = pcm.subarray(offset, offset + chunkSamples);
			const samples = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
			const pushed = await bridge.pushSoundboardPcm({
				sampleRate: SOUNDBOARD_SAMPLE_RATE,
				numChannels: SOUNDBOARD_CHANNELS,
				samples,
			});
			if (!pushed) {
				break;
			}
		}
		const durationMs = Math.ceil((pcm.length / SOUNDBOARD_SAMPLE_RATE) * 1000);
		if (durationMs > 0) {
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, durationMs);
			});
		}
	} finally {
		await bridge.unpublishSoundboardAudio().catch((error) => {
			logger.error('Native soundboard cleanup failed', error);
		});
	}
}

async function playSoundboardSoundInLiveKitRoom(room: Room, blob: Blob): Promise<void> {
	const trackName = `soundboard-${Date.now()}`;
	const audioContext = new AudioContext();
	try {
		const arrayBuffer = await blob.arrayBuffer();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(audioContext.destination);

		const dest = audioContext.createMediaStreamDestination();
		source.connect(dest);

		const audioTrack = dest.stream.getAudioTracks()[0];
		if (!audioTrack) {
			return;
		}

		const participant = room.localParticipant;
		await participant.publishTrack(audioTrack, {
			name: trackName,
			source: Track.Source.Microphone,
		});
		source.start();
		source.onended = async () => {
			try {
				const pubs = Array.from(participant.audioTrackPublications.values());
				const pub = pubs.find((publication) => publication.trackName === trackName);
				if (pub?.track) {
					await participant.unpublishTrack(pub.track);
				}
			} catch (error) {
				logger.error('Soundboard cleanup failed', error);
			} finally {
				await audioContext.close().catch(() => undefined);
			}
		};
	} catch (error) {
		logger.error('Soundboard play failed', error);
		await audioContext.close().catch(() => undefined);
	}
}

export function canPlaySoundboardSound(): boolean {
	return Boolean(MediaEngine.room?.localParticipant) || MediaEngine.connected;
}

export async function playSoundboardSound(room: Room | null, blob: Blob): Promise<void> {
	if (room?.localParticipant) {
		await playSoundboardSoundInLiveKitRoom(room, blob);
		return;
	}
	if (!MediaEngine.connected || !isNativeVoiceEngineSelected()) {
		return;
	}
	const bridge = getVoiceEngineV2AppNativeBridge();
	if (!bridge) {
		return;
	}
	try {
		const pcm = await decodeBlobTo48kMonoPcm(blob);
		await streamPcmThroughNativeBridge(bridge, pcm);
		void playSoundboardSoundLocally(blob);
	} catch (error) {
		logger.error('Native soundboard play failed', error);
	}
}
