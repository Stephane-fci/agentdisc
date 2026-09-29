/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sound handling in the browser: Google sends plain WAV sound (about 3 MB a minute).
// Before a copy goes to the voice service's store, it is squeezed with the browser's
// own Opus encoder to about 0.2 MB a minute, so 30 days of answers fit in the free store.
// A saved copy is unpacked back to WAV here for playing.

export interface Sound {
    wav: Uint8Array;
    seconds: number;
}

export function base64ToBytes(b64: string) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function wavHeader(dataBytes: number, rate: number, channels = 1) {
    const h = new DataView(new ArrayBuffer(44));
    const text = (at: number, s: string) => [...s].forEach((c, i) => h.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF"); h.setUint32(4, 36 + dataBytes, true); text(8, "WAVE");
    text(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, channels, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * channels * 2, true); h.setUint16(32, channels * 2, true); h.setUint16(34, 16, true);
    text(36, "data"); h.setUint32(40, dataBytes, true);
    return new Uint8Array(h.buffer);
}

export function pcmToWav(pcm: Uint8Array, rate: number) {
    const out = new Uint8Array(44 + pcm.length);
    out.set(wavHeader(pcm.length, rate), 0);
    out.set(pcm, 44);
    return out;
}

// Reads a 16-bit WAV: its sample rate and where the sound data sits.
export function readWav(wav: Uint8Array) {
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
    let at = 12, rate = 24000, channels = 1;
    while (at + 8 <= wav.length) {
        const id = tag(at), size = v.getUint32(at + 4, true);
        if (id === "fmt ") {
            channels = v.getUint16(at + 10, true);
            rate = v.getUint32(at + 12, true);
        } else if (id === "data") {
            const len = Math.min(size, wav.length - at - 8);
            return { rate, channels, data: wav.subarray(at + 8, at + 8 + len) };
        }
        at += 8 + size + (size & 1);
    }
    throw new Error("WAV file without sound data");
}

// Google's answer: {candidates:[{content:{parts:[{inlineData:{mimeType,data}}]}}]}.
// Mostly a WAV file; older answers were bare 16-bit sound with the rate in the type.
export function soundFromGoogle(answer: any): Sound {
    const part = answer?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData;
    if (!part) throw new Error("the voice sent no sound");
    let bytes = base64ToBytes(part.data);
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF") {
        const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1]) || 24000;
        bytes = pcmToWav(bytes, rate);
    }
    return fromWav(bytes);
}

export function fromWav(wav: Uint8Array): Sound {
    const { rate, channels, data } = readWav(wav);
    return { wav, seconds: data.length / (rate * channels * 2) };
}

// Packed Opus copy, "ADV1": magic, rate, channels, original sample count, codec setup, then packets.
const MAGIC = [0x41, 0x44, 0x56, 0x31];

export async function packOpus(sound: Sound): Promise<Uint8Array | null> {
    if (typeof AudioEncoder === "undefined") return null;
    const { rate, channels, data } = readWav(sound.wav);
    if (channels !== 1) return null;
    const config = { codec: "opus", sampleRate: rate, numberOfChannels: 1, bitrate: 32000 };
    try {
        if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
    } catch {
        return null;
    }

    const packets: { bytes: Uint8Array; micros: number; }[] = [];
    let description: Uint8Array = new Uint8Array(0);
    let failed: unknown = null;
    const encoder = new AudioEncoder({
        output(chunk, meta) {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            packets.push({ bytes, micros: chunk.duration ?? 20000 });
            const d = meta?.decoderConfig?.description;
            if (d && !description.length) description = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d as ArrayBuffer);
        },
        error(e) { failed = e; }
    });
    encoder.configure(config);

    const samples = new Int16Array(data.slice().buffer as ArrayBuffer);
    const step = rate; // one second at a time
    for (let i = 0; i < samples.length; i += step) {
        const frame = samples.subarray(i, Math.min(i + step, samples.length));
        const audio = new AudioData({ format: "s16", sampleRate: rate, numberOfFrames: frame.length, numberOfChannels: 1, timestamp: Math.round(i / rate * 1e6), data: frame });
        encoder.encode(audio);
        audio.close();
    }
    await encoder.flush();
    encoder.close();
    if (failed || !packets.length) return null;

    const size = 4 + 4 + 1 + 4 + 2 + description.length + packets.reduce((n, p) => n + 6 + p.bytes.length, 0);
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    out.set(MAGIC, 0);
    v.setUint32(4, rate, true);
    v.setUint8(8, 1);
    v.setUint32(9, samples.length, true);
    v.setUint16(13, description.length, true);
    out.set(description, 15);
    let at = 15 + description.length;
    for (const p of packets) {
        v.setUint16(at, p.bytes.length, true);
        v.setUint32(at + 2, p.micros, true);
        out.set(p.bytes, at + 6);
        at += 6 + p.bytes.length;
    }
    return out;
}

export async function unpackOpus(packed: Uint8Array): Promise<Sound> {
    if (![...packed.subarray(0, 4)].every((b, i) => b === MAGIC[i])) throw new Error("unknown saved sound");
    if (typeof AudioDecoder === "undefined") throw new Error("this browser cannot unpack saved sound");
    const v = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    const rate = v.getUint32(4, true);
    const total = v.getUint32(9, true);
    const descLen = v.getUint16(13, true);
    const description = packed.slice(15, 15 + descLen);

    const chunks: Float32Array[] = [];
    let outRate = rate;
    let failed: unknown = null;
    const decoder = new AudioDecoder({
        output(audio) {
            outRate = audio.sampleRate;
            const f = new Float32Array(audio.numberOfFrames);
            audio.copyTo(f, { planeIndex: 0, format: "f32-planar" });
            chunks.push(f);
            audio.close();
        },
        error(e) { failed = e; }
    });
    decoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 1, ...(descLen ? { description } : {}) });

    let at = 15 + descLen, time = 0;
    while (at + 6 <= packed.length) {
        const len = v.getUint16(at, true), micros = v.getUint32(at + 2, true);
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: time, duration: micros, data: packed.subarray(at + 6, at + 6 + len) }));
        time += micros;
        at += 6 + len;
    }
    await decoder.flush();
    decoder.close();
    if (failed) throw failed;

    const want = Math.round(total * outRate / rate);
    const pcm = new Int16Array(want);
    let n = 0;
    for (const c of chunks) for (let i = 0; i < c.length && n < want; i++) pcm[n++] = Math.max(-1, Math.min(1, c[i])) * 0x7fff;
    return fromWav(pcmToWav(new Uint8Array(pcm.buffer), outRate));
}
