// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import type {Room} from 'livekit-client';
import {Track} from 'livekit-client';

const logger = new Logger('VoiceSoundboardUtils');

export async function playSoundboardSound(room: Room | null, blob: Blob): Promise<void> {
	if (!room?.localParticipant) {
		return;
	}

	const trackName = `soundboard-${Date.now()}`;

	try {
		const audioContext = new AudioContext();
		const arrayBuffer = await blob.arrayBuffer();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
		const source = audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(audioContext.destination);

		const dest = audioContext.createMediaStreamDestination();
		source.connect(dest);

		const audioTrack = dest.stream.getAudioTracks()[0];
		if (!audioTrack) {
			await audioContext.close();
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
				const pub = pubs.find((p) => p.trackName === trackName);
				if (pub?.track) {
					await participant.unpublishTrack(pub.track);
				}
				await audioContext.close();
			} catch (error) {
				logger.error('Soundboard cleanup failed', error);
			}
		};
	} catch (error) {
		logger.error('Soundboard play failed', error);
	}
}
