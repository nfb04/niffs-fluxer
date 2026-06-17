// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {StatusSlate} from '@app/features/app/components/dialogs/shared/StatusSlate';
import {GlobalLimits} from '@app/features/app/utils/GlobalLimits';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {UploadSlotInfo} from '@app/features/guild/components/UploadSlotInfo';
import styles from '@app/features/guild/components/modals/guild_tabs/GuildSoundboardTab.module.css';
import {UploadSoundModal} from '@app/features/guild/components/modals/guild_tabs/UploadSoundModal';
import Guilds from '@app/features/guild/state/Guilds';
import {mediaUrl} from '@app/features/messaging/utils/MessagingUrlUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Spinner} from '@app/features/ui/components/Spinner';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {Trans, useLingui} from '@lingui/react/macro';
import {PencilSimpleIcon, PlayIcon, TrashIcon, UploadIcon, WarningCircleIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const logger = new Logger('GuildSoundboardTab');

const GuildSoundboardTab: React.FC<{guildId: string}> = observer(function GuildSoundboardTab({guildId}) {
	const {t} = useLingui();
	const guild = Guilds.getGuild(guildId);
	const maxSounds = guild?.maxSoundboardSounds ?? GlobalLimits.getMaxGuildSoundboardSounds();
	const soundboardMaxSizeLabel = formatFileSize(GlobalLimits.getSoundboardMaxSize());
	const soundboardMaxDurationSec = GlobalLimits.getSoundboardMaxDurationSec();
	const [sounds, setSounds] = useState<ReadonlyArray<GuildSoundboardSoundResponse>>([]);
	const [fetchStatus, setFetchStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState('');
	const editInputRef = useRef<HTMLInputElement>(null);

	const fetchSounds = useCallback(async () => {
		try {
			setFetchStatus('pending');
			const res = await GuildSoundboardCommands.list(guildId);
			setSounds(res.sounds);
			setFetchStatus('success');
		} catch (error) {
			logger.error('Failed to fetch soundboard', error);
			setFetchStatus('error');
		}
	}, [guildId]);

	useEffect(() => {
		if (fetchStatus === 'idle') {
			void fetchSounds();
		}
	}, [fetchStatus, fetchSounds]);

	useEffect(() => {
		if (editingId && editInputRef.current) {
			editInputRef.current.focus();
			editInputRef.current.select();
		}
	}, [editingId]);

	const handleAddSound = useCallback(() => {
		ModalCommands.push(modal(() => <UploadSoundModal guildId={guildId} onSuccess={fetchSounds} />));
	}, [guildId, fetchSounds]);

	const handlePlay = useCallback(
		(soundId: string) => {
			const url = mediaUrl(`soundboard/${guildId}/${soundId}`);
			const audio = new Audio(url);
			audio.play().catch(() => {});
		},
		[guildId],
	);

	const handleStartRename = useCallback((sound: GuildSoundboardSoundResponse) => {
		setEditingId(sound.id);
		setEditName(sound.name);
	}, []);

	const handleRenameSubmit = useCallback(
		async (soundId: string) => {
			const trimmed = editName.trim().slice(0, 32);
			setEditingId(null);
			if (!trimmed) return;
			try {
				await GuildSoundboardCommands.update(guildId, soundId, trimmed);
				setSounds((prev) => prev.map((s) => (s.id === soundId ? {id: s.id, name: trimmed} : s)));
			} catch (error) {
				logger.error('Failed to rename sound', error);
				void fetchSounds();
			}
		},
		[guildId, editName, fetchSounds],
	);

	const handleDelete = useCallback(
		(sound: GuildSoundboardSoundResponse) => {
			ModalCommands.push(
				modal(() => (
					<ConfirmModal
						title={t`Remove sound`}
						description={t`Are you sure you want to remove this sound? This cannot be undone.`}
						primaryText={t`Remove`}
						primaryVariant="danger-primary"
						secondaryText={t`Cancel`}
						onPrimary={async () => {
							await GuildSoundboardCommands.remove(guildId, sound.id);
							void fetchSounds();
						}}
						onSecondary={() => {}}
					/>
				)),
			);
		},
		[guildId, fetchSounds, t],
	);

	return (
		<div className={styles.container}>
			{fetchStatus === 'success' && sounds.length > 0 && (
				<UploadSlotInfo
					title={<Trans>Soundboard</Trans>}
					currentCount={sounds.length}
					maxCount={maxSounds}
					uploadButtonText={<Trans>Upload Sound</Trans>}
					onUploadClick={handleAddSound}
					description={
						<>
							<Trans>Upload custom sound reactions that anyone in this server can use. MP3, max</Trans>{' '}
							{soundboardMaxSizeLabel} <Trans>per file. Trimmed sound max</Trans> {soundboardMaxDurationSec}{' '}
							<Trans>seconds.</Trans>
						</>
					}
				/>
			)}

			{fetchStatus === 'pending' && (
				<div className={styles.spinnerContainer}>
					<Spinner />
				</div>
			)}

			{fetchStatus === 'success' && sounds.length === 0 && (
				<div className={styles.emptyState}>
					<h2 className={styles.emptyStateTitle}>
						<Trans>Soundboard</Trans>
					</h2>
					<p className={styles.emptyStateDescription}>
						<Trans>Upload custom sound reactions that anyone in this server can use.</Trans>
					</p>
					<div className={styles.emptyStateArt}>
						<span className={styles.emptyStateEmoji}>😀</span>
						<span className={styles.emptyStateEmoji}>💀</span>
						<span className={styles.emptyStateEmoji}>👑</span>
					</div>
					<h3 className={styles.emptyStateNoSounds}>
						<Trans>NO SOUNDS</Trans>
					</h3>
					<p className={styles.emptyStateSubtext}>
						<Trans>Get the party started by uploading a sound</Trans>
					</p>
					<Button variant="primary" onClick={handleAddSound} leftIcon={<UploadIcon size={18} />}>
						<Trans>Upload Sound</Trans>
					</Button>
				</div>
			)}

			{fetchStatus === 'success' && sounds.length > 0 && (
				<ul className={styles.soundList} role="list">
					{sounds.map((sound) => (
						<li key={sound.id} className={styles.soundRow}>
							<button
								type="button"
								className={styles.playButton}
								onClick={() => handlePlay(sound.id)}
								title={t`Play`}
								aria-label={t`Play ${sound.name}`}
							>
								<PlayIcon size={18} weight="fill" />
							</button>
							{editingId === sound.id ? (
								<form
									className={styles.renameForm}
									onSubmit={(e) => {
										e.preventDefault();
										void handleRenameSubmit(sound.id);
									}}
								>
									<input
										ref={editInputRef}
										type="text"
										className={styles.renameInput}
										value={editName}
										onChange={(e) => setEditName(e.target.value)}
										onBlur={() => void handleRenameSubmit(sound.id)}
										maxLength={32}
										aria-label={t`Sound name`}
									/>
								</form>
							) : (
								<>
									<span className={styles.soundName} title={sound.name}>
										{sound.name}
									</span>
									<button
										type="button"
										className={clsx(styles.iconButton, styles.renameButton)}
										onClick={() => handleStartRename(sound)}
										title={t`Rename`}
										aria-label={t`Rename ${sound.name}`}
									>
										<PencilSimpleIcon size={16} weight="bold" />
									</button>
									<button
										type="button"
										className={clsx(styles.iconButton, styles.deleteButton)}
										onClick={() => handleDelete(sound)}
										title={t`Remove`}
										aria-label={t`Remove ${sound.name}`}
									>
										<TrashIcon size={16} weight="bold" />
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			)}

			{fetchStatus === 'error' && (
				<StatusSlate
					Icon={WarningCircleIcon}
					title={t`Failed to load soundboard`}
					description={t`There was an error loading sounds. Please try again.`}
					actions={[{text: t`Retry`, onClick: fetchSounds, variant: 'primary'}]}
					fullHeight={true}
				/>
			)}
		</div>
	);
});

export default GuildSoundboardTab;
