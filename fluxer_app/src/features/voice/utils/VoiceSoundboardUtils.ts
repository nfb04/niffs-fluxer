// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import type {Room} from 'livekit-client';
import {Track} from 'livekit-client';

const logger = new Logger('VoiceSoundboardUtils');

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
	return Boolean(MediaEngine.room?.localParticipant);
}

export async function playSoundboardSound(room: Room | null, blob: Blob): Promise<void> {
	if (!room?.localParticipant) {
		return;
	}
	await playSoundboardSoundInLiveKitRoom(room, blob);
}
