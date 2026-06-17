// SPDX-License-Identifier: AGPL-3.0-or-later

import {BottomSheet} from '@app/features/ui/bottom_sheet/BottomSheet';
import {VoiceSoundboardGrid} from '@app/features/voice/components/VoiceSoundboardGrid';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';

interface VoiceSoundboardBottomSheetProps {
	isOpen: boolean;
	onClose: () => void;
}

export const VoiceSoundboardBottomSheet: React.FC<VoiceSoundboardBottomSheetProps> = ({isOpen, onClose}) => {
	const {t} = useLingui();
	const room = MediaEngine.room;

	return (
		<BottomSheet isOpen={isOpen} onClose={onClose} title={t`Soundboard`} snapPoints={[0.35, 0.5]}>
			<VoiceSoundboardGrid room={room} guildId={MediaEngine.guildId ?? null} />
		</BottomSheet>
	);
};
