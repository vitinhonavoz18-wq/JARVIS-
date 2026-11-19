/**
 * Voz: reconhecimento (fala → texto), síntese (texto → fala) e palavra de ativação.
 * Tudo roda no navegador, com permissão explícita do microfone. Nada é gravado em segundo plano.
 */
import { supabase } from './supabase.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

export function getRecognitionCtor(): (new () => SR) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupport = {
  recognition: () => Boolean(getRecognitionCtor()),
  recorder: () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
  tts: () => typeof window !== 'undefined' && 'speechSynthesis' in window,
};

/** Medidor de volume do microfone para animar o núcleo. */
export async function openMicLevel(onLevel: (v: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (const v of buf) sum += v;
    onLevel(Math.min(1, sum / buf.length / 90));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    onLevel(0);
  };
}

export interface ListenHandle {
  result: Promise<string>;
  stop(): void;
  abort(): void;
}

/** Escuta uma frase e devolve o texto. */
export function listenOnce(opts: { lang?: string; onInterim?: (t: string) => void; onLevel?: (v: number) => void }): ListenHandle {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return recordAndTranscribe(opts);
  const rec: SR = new Ctor();
  rec.lang = opts.lang ?? 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let closeMeter: (() => void) | null = null;
  let finalText = '';
  let aborted = false;
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      opts.onInterim?.((finalText + interim).trim());
    };
    rec.onerror = (e: any) => {
      closeMeter?.();
      if (e.error === 'no-speech' || e.error === 'aborted') return resolve('');
      reject(new Error(micErrorMessage(e.error)));
    };
    rec.onend = () => {
      closeMeter?.();
      resolve(aborted ? '' : finalText.trim());
    };
  });
  if (opts.onLevel) openMicLevel(opts.onLevel).then((c) => (closeMeter = c)).catch(() => {});
  try {
    rec.start();
  } catch (e) {
    return { result: Promise.reject(e), stop() {}, abort() {} };
  }
  return {
    result,
    stop: () => rec.stop(),
    abort: () => {
      aborted = true;
      rec.abort();
    },
  };
}

function micErrorMessage(code: string) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permissão do microfone negada. Libere o microfone nas configurações do navegador (ícone de cadeado na barra de endereço).';
    case 'audio-capture':
      return 'Nenhum microfone encontrado.';
    case 'network':
      return 'O reconhecimento de voz do navegador precisa de internet.';
    default:
      return `Erro no reconhecimento de voz (${code}).`;
  }
}

/** Alternativa para navegadores sem reconhecimento nativo: grava e envia ao servidor. */
function recordAndTranscribe(opts: { onLevel?: (v: number) => void }): ListenHandle {
  let recorder: MediaRecorder | null = null;
  let stopMeter: (() => void) | null = null;
  let aborted = false;
  const result = (async () => {
    if (!supabase) throw new Error('Este navegador não reconhece voz nativamente. Use o Chrome/Edge ou configure a transcrição no servidor.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (opts.onLevel) stopMeter = await openMicLevel(opts.onLevel);
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => (recorder!.onstop = () => r()));
    recorder.start();
    const timer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), 15000);
    await done;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    stopMeter?.();
    if (aborted) return '';
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    // O áudio é enviado só para transcrição e não é armazenado.
    const form = new FormData();
    form.append('audio', blob, 'fala.webm');
    const { data, error } = await supabase.functions.invoke('transcribe', { body: form });
    if (error || data?.error) throw new Error(data?.error ?? 'Transcrição indisponível no servidor.');
    return String(data.text ?? '').trim();
  })();
  return {
    result,
    stop: () => recorder?.state === 'recording' && recorder.stop(),
    abort: () => {
      aborted = true;
      if (recorder?.state === 'recording') recorder.stop();
    },
  };
}

/* ------------------------------ Fala ------------------------------ */

export function ptVoices(): SpeechSynthesisVoice[] {
  if (!voiceSupport.tts()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
}

export function toSpeakable(text: string): string {
  return text
    .replace(/[•✓⚠*_#>`]/g, '')
    .replace(/\[(.*?)\]/g, '$1')
    .replace(/(\d{1,2})h(\d{2})/g, '$1 e $2')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function speak(text: string, opts: { rate?: number; voice?: string | null; onBoundary?: () => void } = {}): Promise<void> {
  if (!voiceSupport.tts()) return Promise.resolve();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(toSpeakable(text).slice(0, 1200));
  u.lang = 'pt-BR';
  u.rate = opts.rate ?? 1;
  const voices = ptVoices();
  const v = voices.find((x) => x.name === opts.voice) ?? voices.find((x) => /pt-BR/i.test(x.lang) && /(google|natural|neural|francisca|antonio)/i.test(x.name)) ?? voices[0];
  if (v) u.voice = v;
  return new Promise((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
    u.onboundary = () => opts.onBoundary?.();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (voiceSupport.tts()) speechSynthesis.cancel();
}

/* ------------------------ Palavra de ativação ------------------------ */

/**
 * Escuta contínua por “Jarvis” APENAS com o app aberto e visível, com permissão do usuário.
 * Ao detectar, chama onWake com o restante da frase (se houver).
 */
export class WakeWordListener {
  private rec: SR | null = null;
  private running = false;
  private paused = false;
  constructor(private onWake: (rest: string) => void, private onState?: (active: boolean) => void) {}

  get supported() {
    return Boolean(getRecognitionCtor());
  }

  start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor || this.running) return;
    this.running = true;
    const rec: SR = new Ctor();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text: string = e.results[i][0].transcript;
        const m = /\b(jarvis|j[áa]rvis|jarves|jarbas)\b[\s,.]*(.*)$/i.exec(text);
        if (m && e.results[i].isFinal) {
          this.pause();
          this.onWake(m[2].trim());
        }
      }
    };
    rec.onend = () => {
      if (this.running && !this.paused && document.visibilityState === 'visible') {
        try {
          rec.start();
        } catch {
          /* já iniciado */
        }
      } else this.onState?.(false);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.stop();
      }
    };
    this.rec = rec;
    try {
      rec.start();
      this.onState?.(true);
    } catch {
      /* ignore */
    }
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.running && !this.paused) this.resume();
    else if (document.visibilityState !== 'visible') this.rec?.stop();
  };

  pause() {
    this.paused = true;
    this.rec?.stop();
    this.onState?.(false);
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    try {
      this.rec?.start();
      this.onState?.(true);
    } catch {
      /* ignore */
    }
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.rec?.abort();
    this.rec = null;
    this.onState?.(false);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
