// SPDX-License-Identifier: AGPL-3.0-or-later

import messageSound from '@app/media/sounds/message.mp3';
import userJoinSound from '@app/media/sounds/user-join.mp3';
import userLeaveSound from '@app/media/sounds/user-leave.mp3';

export interface SoundboardSoundEntry {
	id: string;
	label: string;
	url: string;
}

export const SOUNDBOARD_SOUNDS: Array<SoundboardSoundEntry> = [
	{id: 'user-join', label: 'Join', url: userJoinSound as string},
	{id: 'user-leave', label: 'Leave', url: userLeaveSound as string},
	{id: 'message', label: 'Message', url: messageSound as string},
];
