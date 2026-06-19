// SPDX-License-Identifier: AGPL-3.0-or-later

import UnicodeEmojis from '@app/features/expressions/utils/UnicodeEmojis';
import * as EmojiUtils from '@app/features/expressions/utils/EmojiUtils';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {mediaUrl} from '@app/features/messaging/utils/MessagingUrlUtils';
import {SOUNDBOARD_SOUNDS} from '@app/features/voice/components/VoiceSoundboardConstants';
import styles from '@app/features/voice/components/VoiceSoundboardPopover.module.css';
import {canPlaySoundboardSound, playSoundboardSound} from '@app/features/voice/utils/VoiceSoundboardUtils';
import {useLingui} from '@lingui/react/macro';
import {MagnifyingGlassIcon} from '@phosphor-icons/react';
import type {Room} from 'livekit-client';
import React, {useCallback, useEffect, useMemo, useState} from 'react';

interface CustomSound {
	id: string;
	name: string;
	url: string;
	isCustom: true;
}

interface BuiltInSound {
	id: string;
	label: string;
	url: string;
	isCustom: false;
}

type GridSound = BuiltInSound | CustomSound;

function getSoundDisplayName(sound: GridSound): string {
	return sound.isCustom ? sound.name : sound.label;
}

function renderSoundboardLabelWithTwemoji(name: string): React.ReactNode {
	const re = new RegExp(UnicodeEmojis.EMOJI_NAME_AND_DIVERSITY_RE.source, 'g');
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let key = 0;
	for (const match of name.matchAll(re)) {
		if (match.index! > lastIndex) {
			parts.push(<React.Fragment key={key++}>{name.slice(lastIndex, match.index)}</React.Fragment>);
		}
		const shortcode = match[1];
		const surrogate = UnicodeEmojis.convertNameToSurrogate(shortcode);
		if (surrogate) {
			const url = EmojiUtils.getEmojiURL(surrogate);
			if (url) {
				parts.push(
					<img
						key={key++}
						src={url}
						alt={`:${shortcode}:`}
						className={styles.soundboardEmoji}
						draggable={false}
					/>,
				);
			} else {
				parts.push(<React.Fragment key={key++}>{surrogate}</React.Fragment>);
			}
		} else {
			parts.push(<React.Fragment key={key++}>{match[0]}</React.Fragment>);
		}
		lastIndex = match.index! + match[0].length;
	}
	if (lastIndex < name.length) {
		parts.push(<React.Fragment key={key++}>{name.slice(lastIndex)}</React.Fragment>);
	}
	return parts.length > 0 ? <>{parts}</> : name;
}

interface VoiceSoundboardGridProps {
	room: Room | null;
	guildId: string | null;
}

export function VoiceSoundboardGrid({room, guildId}: VoiceSoundboardGridProps) {
	const {t} = useLingui();
	const [loadingId, setLoadingId] = useState<string | null>(null);
	const [customSounds, setCustomSounds] = useState<Array<{id: string; name: string}>>([]);
	const [searchQuery, setSearchQuery] = useState('');

	const builtIns: GridSound[] = SOUNDBOARD_SOUNDS.map((s) => ({
		id: s.id,
		label: s.label,
		url: s.url,
		isCustom: false as const,
	}));

	const customs: GridSound[] =
		guildId != null
			? customSounds.map((s) => ({
					id: s.id,
					name: s.name,
					url: mediaUrl(`soundboard/${guildId}/${s.id}`),
					isCustom: true as const,
				}))
			: [];

	const allSounds: GridSound[] = [...builtIns, ...customs];

	const filteredSounds = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allSounds;
		return allSounds.filter((s) => getSoundDisplayName(s).toLowerCase().includes(q));
	}, [allSounds, searchQuery]);

	useEffect(() => {
		if (guildId == null) {
			setCustomSounds([]);
			return;
		}
		let cancelled = false;
		GuildSoundboardCommands.list(guildId)
			.then((res) => {
				if (!cancelled) setCustomSounds(res.sounds);
			})
			.catch(() => {
				if (!cancelled) setCustomSounds([]);
			});
		return () => {
			cancelled = true;
		};
	}, [guildId]);

	const handlePlay = useCallback(
		async (url: string, id: string) => {
			if (!canPlaySoundboardSound()) return;
			setLoadingId(id);
			try {
				const res = await fetch(url, {cache: 'no-store'});
				if (!res.ok) throw new Error(`Soundboard fetch ${res.status}`);
				const blob = await res.blob();
				await playSoundboardSound(room, blob);
			} finally {
				setLoadingId(null);
			}
		},
		[room],
	);

	return (
		<div className={styles.gridWrapper} role="group" aria-label={t`Soundboard`}>
			<div className={styles.searchBarWrap}>
				<MagnifyingGlassIcon size={18} weight="bold" className={styles.searchIcon} aria-hidden />
				<input
					type="search"
					className={styles.searchBarInput}
					placeholder={t`Find the perfect sound`}
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					aria-label={t`Search sounds`}
				/>
			</div>
			<div className={styles.gridScroll}>
				<div className={styles.grid}>
					{filteredSounds.map((sound) => (
						<div key={sound.isCustom ? `custom-${sound.id}` : sound.id} className={styles.gridCell}>
							<button
								type="button"
								className={styles.gridButton}
								disabled={loadingId !== null}
								onClick={() => void handlePlay(sound.url, sound.id)}
								title={getSoundDisplayName(sound)}
							>
								<span className={styles.gridButtonLabel}>
									{renderSoundboardLabelWithTwemoji(getSoundDisplayName(sound))}
								</span>
							</button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
