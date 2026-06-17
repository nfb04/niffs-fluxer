// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {GlobalLimits} from '@app/features/app/utils/GlobalLimits';
import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {ExpressionPickerPopout} from '@app/features/expressions/components/popouts/ExpressionPickerPopout';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {getEmojiURL} from '@app/features/expressions/utils/EmojiUtils';
import styles from '@app/features/guild/components/modals/guild_tabs/UploadSoundModal.module.css';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Slider} from '@app/features/ui/components/Slider';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {
	audioBufferToWavBlob,
	audioBufferToWebMBlob,
	blobToBase64,
	decodeAudioFile,
	getWaveformData,
	sliceAudioBuffer,
} from '@app/features/voice/utils/SoundboardTrimUtils';
import {Trans, useLingui} from '@lingui/react/macro';
import {PauseIcon, PlayIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

function getPopoutClose(renderProps: unknown): () => void {
	const props = renderProps as {close?: () => void; requestClose?: () => void; onClose?: () => void};
	if (typeof props.close === 'function') return props.close;
	if (typeof props.requestClose === 'function') return props.requestClose;
	if (typeof props.onClose === 'function') return props.onClose;
	return () => {};
}

interface UploadSoundModalProps {
	guildId: string;
	onSuccess: () => void;
}

export const UploadSoundModal: React.FC<UploadSoundModalProps> = ({guildId, onSuccess}) => {
	const {t} = useLingui();
	const soundboardMaxDurationSec = GlobalLimits.getSoundboardMaxDurationSec();
	const soundboardMaxSize = GlobalLimits.getSoundboardMaxSize();
	const soundboardMaxSizeLabel = formatFileSize(soundboardMaxSize);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const [soundName, setSoundName] = useState('');
	const [relatedEmoji, setRelatedEmoji] = useState<FlatEmoji | null>(null);
	const [volume, setVolume] = useState(100);
	const [trimStart, setTrimStart] = useState(0);
	const [trimEnd, setTrimEnd] = useState(1);
	const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
	const [duration, setDuration] = useState(0);
	const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
	const [playing, setPlaying] = useState(false);
	const [playOffset, setPlayOffset] = useState(0);
	const [playheadPos, setPlayheadPos] = useState(0);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
	const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const startContextTimeRef = useRef(0);
	const playOffsetAtStartRef = useRef(0);
	const pausedByUserRef = useRef(false);
	const rafRef = useRef<number | null>(null);

	const startTime = duration * trimStart;
	const endTime = duration * trimEnd;
	const trimmedDuration = Math.max(0, endTime - startTime);

	const formatDuration = (sec: number) => {
		const m = Math.floor(sec / 60);
		const s = (sec % 60).toFixed(2);
		return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${sec.toFixed(2)}s`;
	};

	const loadFile = useCallback(
		async (f: File) => {
			setFile(f);
			setError(null);
			setTrimStart(0);
			setTrimEnd(1);
			try {
				const buffer = await decodeAudioFile(f);
				setAudioBuffer(buffer);
				setDuration(buffer.duration);
				setPlayOffset(0);
				setPlayheadPos(0);
				const name = f.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Sound';
				setSoundName(name);
			} catch {
				setError(t`Could not load audio file`);
				setAudioBuffer(null);
				setDuration(0);
			}
		},
		[t],
	);

	useEffect(() => {
		if (!audioBuffer || !canvasRef.current) return;
		const canvas = canvasRef.current;
		const width = canvas.width;
		const height = canvas.height;
		const data = getWaveformData(audioBuffer, width, 0, 1);
		let max = 0;
		for (let i = 0; i < data.length; i++) {
			if (data[i]! > max) max = data[i]!;
		}
		const scale = max > 0 ? 1 / max : 1;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);
		const mid = height / 2;
		const barWidth = Math.max(1, width / data.length);
		for (let i = 0; i < data.length; i++) {
			const x = i * barWidth;
			const h = data[i]! * scale * mid * 0.9 || 2;
			const barCenter = (i + 0.5) / data.length;
			const inClip = barCenter >= trimStart && barCenter <= trimEnd;
			ctx.fillStyle = inClip ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.22)';
			ctx.fillRect(x, mid - h, barWidth, h * 2);
		}
	}, [audioBuffer, duration, trimStart, trimEnd]);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const f = e.target.files?.[0];
			e.target.value = '';
			if (f) void loadFile(f);
		},
		[loadFile],
	);

	const handleWaveformClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!duration || !canvasRef.current) return;
			const rect = canvasRef.current.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const pos = Math.max(0, Math.min(1, x));
			if (pos < (trimStart + trimEnd) / 2) {
				setTrimStart(pos);
				if (trimEnd <= pos) setTrimEnd(Math.min(1, pos + 0.01));
			} else {
				setTrimEnd(pos);
				if (trimStart >= pos) setTrimStart(Math.max(0, pos - 0.01));
			}
		},
		[duration, trimStart, trimEnd],
	);

	const handleTrimPointerDown = useCallback(
		(which: 'start' | 'end') => (e: React.PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setDragging(which);
		},
		[],
	);

	useEffect(() => {
		if (dragging === null) return;
		const onMove = (e: PointerEvent) => {
			if (!canvasRef.current || !duration) return;
			const rect = canvasRef.current.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const pos = Math.max(0, Math.min(1, x));
			if (dragging === 'start') {
				setTrimStart(pos);
				if (trimEnd <= pos) setTrimEnd(Math.min(1, pos + 0.01));
			} else {
				setTrimEnd(pos);
				if (trimStart >= pos) setTrimStart(Math.max(0, pos - 0.01));
			}
		};
		const onUp = () => setDragging(null);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
	}, [dragging, duration, trimStart, trimEnd]);

	const tickPlayhead = useCallback(() => {
		const ctx = audioContextRef.current;
		if (!ctx || !playing) return;
		const elapsed = ctx.currentTime - startContextTimeRef.current;
		const pos = playOffsetAtStartRef.current + elapsed;
		const trimmed = Math.max(0, endTime - startTime);
		if (trimmed <= 0) return;
		const p = Math.min(1, pos / trimmed);
		setPlayheadPos(p);
		rafRef.current = requestAnimationFrame(tickPlayhead);
	}, [playing, startTime, endTime]);

	useEffect(() => {
		if (!playing) return;
		tickPlayhead();
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		};
	}, [playing, tickPlayhead]);

	useEffect(() => {
		if (!playing && audioBuffer && trimmedDuration > 0) {
			setPlayheadPos(Math.min(1, playOffset / trimmedDuration));
		}
	}, [playing, audioBuffer, trimmedDuration, playOffset]);

	const handlePlayPause = useCallback(() => {
		if (!audioBuffer) return;
		const ctx = audioContextRef.current ?? new AudioContext();
		if (!audioContextRef.current) audioContextRef.current = ctx;
		if (playing) {
			const elapsed = ctx.currentTime - startContextTimeRef.current;
			const newOffset = Math.min(Math.max(0, endTime - startTime), playOffsetAtStartRef.current + elapsed);
			pausedByUserRef.current = true;
			playSourceRef.current?.stop();
			playSourceRef.current = null;
			setPlaying(false);
			setPlayOffset(newOffset);
			setPlayheadPos(trimmedDuration > 0 ? newOffset / trimmedDuration : 0);
			return;
		}
		const trimmed = Math.max(0, endTime - startTime);
		if (trimmed <= 0) return;
		const start = startTime + playOffset;
		const end = Math.min(endTime, audioBuffer.duration);
		if (start >= end) {
			setPlayOffset(0);
			setPlayheadPos(0);
			return;
		}
		const source = ctx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(ctx.destination);
		source.start(0, start, end - start);
		playSourceRef.current = source;
		pausedByUserRef.current = false;
		startContextTimeRef.current = ctx.currentTime;
		playOffsetAtStartRef.current = playOffset;
		setPlaying(true);
		source.onended = () => {
			playSourceRef.current = null;
			setPlaying(false);
			if (!pausedByUserRef.current) {
				setPlayOffset(0);
				setPlayheadPos(0);
			}
		};
	}, [audioBuffer, playing, startTime, endTime, playOffset, trimmedDuration]);

	const handleUpload = useCallback(async () => {
		const name = soundName.trim().slice(0, 32);
		if (!name) {
			setError(t`Sound name is required`);
			return;
		}
		if (!file) {
			setError(t`Please select a file`);
			return;
		}
		if (trimmedDuration > soundboardMaxDurationSec) {
			setError(
				`Trimmed sound must be ${soundboardMaxDurationSec} seconds or less. Current clip: ${formatDuration(trimmedDuration)}. Trim the clip or choose a shorter section.`,
			);
			return;
		}
		setError(null);
		setUploading(true);
		try {
			let base64: string;
			const hasTrim = trimStart > 0.001 || trimEnd < 0.999;
			if (hasTrim && audioBuffer) {
				const sliced = await sliceAudioBuffer(audioBuffer, startTime, endTime);
				const webmBlob = await audioBufferToWebMBlob(sliced);
				const blob = webmBlob ?? audioBufferToWavBlob(sliced);
				base64 = await blobToBase64(blob);
			} else {
				const reader = new FileReader();
				base64 = await new Promise<string>((resolve, reject) => {
					reader.onload = () => {
						const result = reader.result;
						if (typeof result === 'string') resolve(result.replace(/^data:[^;]+;base64,/, ''));
						else reject(new Error('Failed to read file'));
					};
					reader.onerror = () => reject(reader.error);
					reader.readAsDataURL(file);
				});
			}
			const sizeBytes = Math.ceil((base64.length * 3) / 4);
			if (sizeBytes > soundboardMaxSize) {
				setError(`File is too large (max ${soundboardMaxSizeLabel})`);
				setUploading(false);
				return;
			}
			const emojiShortcode = relatedEmoji?.uniqueName?.trim();
			await GuildSoundboardCommands.create(guildId, name, base64, emojiShortcode || undefined);
			ModalCommands.pop();
			onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setUploading(false);
		}
	}, [
		guildId,
		file,
		soundName,
		trimStart,
		trimEnd,
		startTime,
		endTime,
		trimmedDuration,
		audioBuffer,
		relatedEmoji,
		onSuccess,
		soundboardMaxDurationSec,
		soundboardMaxSize,
		soundboardMaxSizeLabel,
		t,
	]);

	useEffect(
		() => () => {
			playSourceRef.current?.stop();
			void audioContextRef.current?.close();
		},
		[],
	);

	return (
		<Modal.Root size="medium" centered>
			<Modal.Header title={t`Upload a Sound`} />
			<Modal.Content>
				<div className={styles.content}>
					<div className={styles.previewSection}>
						<span className={styles.sectionLabel}>
							<Trans>Preview</Trans>
						</span>
						<div className={styles.waveformRow}>
							<button
								type="button"
								className={styles.playButton}
								onClick={handlePlayPause}
								disabled={!audioBuffer}
								aria-label={playing ? t`Pause` : t`Play`}
							>
								{playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
							</button>
							<span
								className={clsx(
									styles.duration,
									audioBuffer && trimmedDuration > soundboardMaxDurationSec && styles.durationOverLimit,
								)}
							>
								{audioBuffer ? formatDuration(trimmedDuration) : '0.00s'}
							</span>
							<div className={styles.waveformContainer} onClick={handleWaveformClick} role="presentation">
								<canvas
									ref={canvasRef}
									className={styles.waveformCanvas}
									width={500}
									height={80}
									style={{width: '100%', height: '100%'}}
								/>
								{audioBuffer && (
									<div className={styles.trimOverlay}>
										<div
											className={styles.trimClipHighlight}
											style={{
												left: `${trimStart * 100}%`,
												width: `${(trimEnd - trimStart) * 100}%`,
											}}
										/>
										<div
											className={styles.playhead}
											style={{
												left: `${(trimStart + playheadPos * (trimEnd - trimStart)) * 100}%`,
											}}
										/>
										<div className={styles.trimMask} style={{left: 0, width: `${trimStart * 100}%`}} />
										<div className={styles.trimMask} style={{left: `${trimEnd * 100}%`, right: 0}} />
										<div
											className={styles.trimHandle}
											style={{left: `${trimStart * 100}%`}}
											onPointerDown={handleTrimPointerDown('start')}
											role="slider"
											aria-valuenow={trimStart}
											aria-valuemin={0}
											aria-valuemax={1}
										/>
										<div
											className={styles.trimHandle}
											style={{left: `${trimEnd * 100}%`}}
											onPointerDown={handleTrimPointerDown('end')}
											role="slider"
											aria-valuenow={trimEnd}
											aria-valuemin={0}
											aria-valuemax={1}
										/>
									</div>
								)}
							</div>
						</div>
					</div>

					<div>
						<span className={styles.sectionLabel}>
							<Trans>File</Trans> *
						</span>
						<div className={styles.fileSection}>
							<input
								ref={fileInputRef}
								type="file"
								accept="audio/mpeg,audio/mp3,.mp3,audio/wav,audio/*"
								className={styles.hiddenInput}
								onChange={handleFileChange}
							/>
							<input
								type="text"
								className={styles.fileInput}
								readOnly
								value={file?.name ?? ''}
								placeholder={t`Select a file`}
							/>
							<button type="button" className={styles.browseButton} onClick={() => fileInputRef.current?.click()}>
								<Trans>Browse</Trans>
							</button>
						</div>
					</div>

					<div className={styles.nameSection}>
						<label htmlFor="sound-name" className={styles.sectionLabel}>
							<Trans>Sound Name</Trans> *
						</label>
						<input
							id="sound-name"
							type="text"
							className={styles.nameInput}
							value={soundName}
							onChange={(e) => setSoundName(e.target.value.slice(0, 32))}
							placeholder={t`Sound Name`}
							maxLength={32}
						/>
					</div>

					<div className={styles.emojiSection}>
						<span className={styles.sectionLabel}>
							<Trans>Related Emoji</Trans>
						</span>
						<div className={styles.emojiRow}>
							<Popout
								position="bottom-start"
								animationType="none"
								offsetMainAxis={8}
								offsetCrossAxis={0}
								onOpen={() => setEmojiPickerOpen(true)}
								onClose={() => setEmojiPickerOpen(false)}
								render={(renderProps) => {
									const closePopout = getPopoutClose(renderProps);
									return (
										<ExpressionPickerPopout
											onEmojiSelect={(emoji) => {
												setRelatedEmoji(emoji);
												setEmojiPickerOpen(false);
												closePopout();
											}}
											onClose={() => {
												setEmojiPickerOpen(false);
												closePopout();
											}}
											visibleTabs={['emojis']}
										/>
									);
								}}
							>
								<FocusRing offset={-2}>
									<button
										type="button"
										className={clsx(styles.emojiTrigger, emojiPickerOpen && styles.emojiTriggerActive)}
										aria-label={t`Choose emoji`}
									>
										{relatedEmoji ? (
											<>
												{relatedEmoji.surrogates ? (
													(getEmojiURL(relatedEmoji.surrogates) && (
														<img
															src={getEmojiURL(relatedEmoji.surrogates)!}
															alt={`:${relatedEmoji.uniqueName}:`}
															style={{width: 24, height: 24}}
															draggable={false}
														/>
													)) || <span style={{fontSize: '1.25rem'}}>{relatedEmoji.surrogates}</span>
												) : (
													<span style={{fontSize: '1.25rem'}}>😀</span>
												)}
												<span className={styles.emojiInput}>:{relatedEmoji.uniqueName}:</span>
											</>
										) : (
											<span className={styles.emojiPlaceholder}>
												<Trans>Click to select</Trans>
											</span>
										)}
									</button>
								</FocusRing>
							</Popout>
						</div>
					</div>

					<div className={styles.volumeSection}>
						<span className={styles.sectionLabel}>
							<Trans>Sound Volume</Trans>
						</span>
						<Slider
							defaultValue={100}
							factoryDefaultValue={100}
							minValue={0}
							maxValue={100}
							onValueChange={(v) => setVolume(v)}
							value={volume}
							onValueRender={(v) => `${v}%`}
						/>
					</div>

					{error && <p className={styles.error}>{error}</p>}
				</div>
			</Modal.Content>
			<Modal.Footer>
				<Button variant="secondary" onClick={() => ModalCommands.pop()}>
					<Trans>Never mind</Trans>
				</Button>
				<Button
					variant="primary"
					onClick={() => void handleUpload()}
					submitting={uploading}
					disabled={!file || !soundName.trim()}
				>
					<Trans>Upload</Trans>
				</Button>
			</Modal.Footer>
		</Modal.Root>
	);
};
