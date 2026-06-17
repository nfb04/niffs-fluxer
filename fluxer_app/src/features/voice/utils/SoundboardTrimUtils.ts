// SPDX-License-Identifier: AGPL-3.0-or-later

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
	const arrayBuffer = await file.arrayBuffer();
	const ctx = new AudioContext();
	return ctx.decodeAudioData(arrayBuffer.slice(0));
}

export function getWaveformData(buffer: AudioBuffer, width: number, startNorm = 0, endNorm = 1): Float32Array {
	const channel = buffer.getChannelData(0);
	const totalSamples = channel.length;
	const startSample = Math.floor(startNorm * totalSamples);
	const endSample = Math.min(Math.ceil(endNorm * totalSamples), totalSamples);
	const rangeLength = Math.max(0, endSample - startSample);
	if (rangeLength === 0) return new Float32Array(width);
	const step = rangeLength / width;
	const data = new Float32Array(width);
	for (let i = 0; i < width; i++) {
		let sum = 0;
		const start = startSample + Math.floor(i * step);
		const end = Math.min(start + Math.ceil(step), endSample);
		const count = end - start;
		if (count > 0) {
			for (let j = start; j < end; j++) sum += Math.abs(channel[j]!);
			data[i] = sum / count;
		}
	}
	return data;
}

export async function sliceAudioBuffer(
	buffer: AudioBuffer,
	startTime: number,
	endTime: number,
): Promise<AudioBuffer> {
	const sampleRate = buffer.sampleRate;
	const startSample = Math.floor(startTime * sampleRate);
	const endSample = Math.min(Math.ceil(endTime * sampleRate), buffer.length);
	const length = Math.max(0, endSample - startSample);
	const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, sampleRate);
	const source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(ctx.destination);
	const durationSec = endTime - startTime;
	source.start(0, startTime, durationSec);
	return ctx.startRendering();
}

function writeWavHeader(
	data: ArrayBuffer,
	numChannels: number,
	sampleRate: number,
	bitsPerSample: number,
): ArrayBuffer {
	const bytesPerSample = bitsPerSample / 8;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = data.byteLength;
	const header = new ArrayBuffer(44);
	const view = new DataView(header);
	view.setUint32(0, 0x52494646, false);
	view.setUint32(4, 36 + dataSize, true);
	view.setUint32(8, 0x57415645, false);
	view.setUint32(12, 0x666d7420, false);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	view.setUint32(36, 0x64617461, false);
	view.setUint32(40, dataSize, true);
	return header;
}

function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
	const buffer = new ArrayBuffer(float32.length * 2);
	const view = new DataView(buffer);
	let offset = 0;
	for (let i = 0; i < float32.length; i++, offset += 2) {
		const s = Math.max(-1, Math.min(1, float32[i]!));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return buffer;
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
	const numChannels = buffer.numberOfChannels;
	const length = buffer.length * numChannels;
	const interleaved = new Float32Array(length);
	for (let ch = 0; ch < numChannels; ch++) {
		const channel = buffer.getChannelData(ch);
		for (let i = 0; i < buffer.length; i++) {
			interleaved[i * numChannels + ch] = channel[i]!;
		}
	}
	const pcm = floatTo16BitPCM(interleaved);
	const header = writeWavHeader(pcm, numChannels, buffer.sampleRate, 16);
	return new Blob([header, pcm], {type: 'audio/wav'});
}

const WEBM_OPUS_MIME = 'audio/webm;codecs=opus';

function isWebMOpusSupported(): boolean {
	return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(WEBM_OPUS_MIME) === true;
}

export function audioBufferToWebMBlob(buffer: AudioBuffer): Promise<Blob | null> {
	if (!isWebMOpusSupported()) return Promise.resolve(null);
	return new Promise((resolve) => {
		const ctx = new AudioContext();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const dest = ctx.createMediaStreamDestination();
		source.connect(dest);
		const stream = dest.stream;
		const mimeType = WEBM_OPUS_MIME;
		const recorder = new MediaRecorder(stream, {mimeType, audioBitsPerSecond: 64000});
		const chunks: Blob[] = [];
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		recorder.onstop = () => {
			ctx.close();
			resolve(new Blob(chunks, {type: mimeType}));
		};
		recorder.onerror = () => {
			ctx.close();
			resolve(null);
		};
		recorder.start(100);
		source.start(0, 0, buffer.duration);
		setTimeout(() => {
			try {
				recorder.stop();
			} catch {
				resolve(null);
			}
		}, buffer.duration * 1000 + 300);
	});
}

export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			if (typeof result === 'string') {
				resolve(result.replace(/^data:[^;]+;base64,/, ''));
			} else {
				reject(new Error('Failed to read blob'));
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}
