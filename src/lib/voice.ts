/**
 * Voz: reconhecimento (fala → texto), síntese (texto → fala) e palavra de ativação.
 * Tudo roda no navegador, com permissão explícita do microfone. Nada é gravado em segundo plano.
 */
import { supabase } from './supabase.ts';
import { toSpeakable } from '@/core/speech.ts';
import { SilenceDetector, TtsCache, VOICE_LIMITS, isCacheablePhrase, speakWithFallback, validateRecording, type ListenHandle, type ListenOptions, type SpeakOptions, type SpeechToText, type TextToSpeech } from '@/core/voice.ts';

export { toSpeakable };

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
  try {
    const disconnect = meterForStream(stream, onLevel);
    return () => {
      stream.getTracks().forEach((track) => track.stop());
      disconnect();
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

function meterForStream(stream: MediaStream, onLevel: (v: number) => void) {
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
    ctx.close().catch(() => {});
    onLevel(0);
  };
}

export type { ListenHandle };

/** Fala → texto: reconhecimento nativo do navegador; sem ele, grava e transcreve no servidor. */
export const nativeStt: SpeechToText = { id: 'browser', available: () => Boolean(getRecognitionCtor()), listen: (o) => listenNative(o) };
export const serverStt: SpeechToText = { id: 'server', available: () => Boolean(supabase) && voiceSupport.recorder(), listen: (o) => recordAndTranscribe(o) };

/** Escuta uma frase e devolve o texto. */
export function listenOnce(opts: ListenOptions): ListenHandle {
  return (nativeStt.available() ? nativeStt : serverStt).listen(opts);
}

function listenNative(opts: ListenOptions): ListenHandle {
  const Ctor = getRecognitionCtor()!;
  const rec: SR = new Ctor();
  rec.lang = opts.lang ?? 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let closeMeter: (() => void) | null = null;
  let finished = false;
  const finishMeter = () => {
    finished = true;
    closeMeter?.();
    closeMeter = null;
  };
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
      finishMeter();
      if (e.error === 'no-speech' || e.error === 'aborted') return resolve('');
      reject(new Error(micErrorMessage(e.error)));
    };
    rec.onend = () => {
      finishMeter();
      resolve(aborted ? '' : finalText.trim());
    };
  });

  try {
    rec.start();
    if (opts.onLevel) openMicLevel(opts.onLevel).then((close) => {
      if (finished) close();
      else closeMeter = close;
    }).catch(() => {});
  } catch (e) {
    return { result: Promise.reject(e), stop() {}, abort() {} };
  }
  return {
    result,
    stop: () => { finishMeter(); rec.stop(); },
    abort: () => {
      aborted = true;
      finishMeter();
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
  let stopped = false;
  let aborted = false;
  const result = (async () => {
    if (!supabase) throw new Error('Este navegador não reconhece voz nativamente. Use o Chrome/Edge ou configure a transcrição no servidor.');
    if (!voiceSupport.recorder()) throw new Error('Este navegador não permite gravar áudio.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let stopMeter: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunks: Blob[] = [];
    let mime: string;
    const vad = new SilenceDetector();
    try {
      if (stopped) return '';
      recorder = new MediaRecorder(stream);
      mime = recorder.mimeType;
      // Fim de fala por silêncio (VAD) e limite de duração — valores em VOICE_LIMITS.
      try {
        stopMeter = meterForStream(stream, (v) => {
          opts.onLevel?.(v);
          if (vad.push(v, performance.now()) === 'stop' && recorder?.state === 'recording') recorder.stop();
        });
      } catch { /* sem medidor: vale só o limite de duração */ }
      recorder.ondataavailable = (event) => chunks.push(event.data);
      await new Promise<void>((resolve, reject) => {
        recorder!.onstop = () => resolve();
        recorder!.onerror = () => reject(new Error('Falha na gravação do microfone.'));
        recorder!.start();
        timer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), VOICE_LIMITS.maxRecordingMs);
      });
    } finally {
      clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      stopMeter?.();
    }
    if (aborted || !chunks.length) return '';
    const blob = new Blob(chunks, { type: mime || chunks[0].type });
    // Silêncio ou ruído curto não vai para a transcrição (economiza chamada).
    if (!validateRecording({ bytes: blob.size, speechMs: vad.speechMs }).ok) return '';
    // O áudio é enviado só para transcrição e não é armazenado.
    const form = new FormData();
    form.append('audio', blob, 'fala.webm');
    const { data, error } = await supabase.functions.invoke('transcribe', { body: form });
    if (error || data?.error) throw new Error(data?.error ?? 'Transcrição indisponível no servidor.');
    return String(data.text ?? '').trim();
  })();
  return {
    result,
    stop: () => { stopped = true; if (recorder?.state === 'recording') recorder.stop(); },
    abort: () => {
      aborted = true;
      stopped = true;
      if (recorder?.state === 'recording') recorder.stop();
    },
  };
}

/* ------------------------------ Fala ------------------------------ */

export function ptVoices(): SpeechSynthesisVoice[] {
  if (!voiceSupport.tts()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
}


/** Valor de `tts_voice` que escolhe a voz premium do servidor (ElevenLabs). */
export const PREMIUM_VOICE = 'premium:jarvis';
let premiumOff = false; // desliga a tentativa premium nesta sessão se o servidor não estiver configurado
let current: { audio: HTMLAudioElement; ctrl: AbortController; url: string; done: () => void } | null = null;

export const premiumVoiceAvailable = () => Boolean(supabase) && !premiumOff;

/** Áudio só de frases fixas (lista em core/voice.ts), nunca de respostas com dados do usuário. */
const ttsCache = new TtsCache<Blob>(20, 2_000_000);

/** Texto → fala: voz premium (ElevenLabs, em streaming) e voz do navegador como reserva. */
export const premiumTts: TextToSpeech = {
  id: 'premium',
  available: premiumVoiceAvailable,
  speak: (text, opts) => speakPremium(text, opts),
  stop: () => stopPremium(),
};
export const browserTts: TextToSpeech = {
  id: 'browser',
  available: () => voiceSupport.tts(),
  speak: (text, opts) => speakBrowser(text, { ...opts, voice: opts.voice === PREMIUM_VOICE ? null : opts.voice }),
  stop: () => speechSynthesis.cancel(),
};

/** Fala com a voz premium quando escolhida (ou automática no Modo Nuvem); cai para a voz do navegador em falhas. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  stopSpeaking();
  const wantsPremium = !opts.voice || opts.voice === PREMIUM_VOICE;
  await speakWithFallback(wantsPremium ? [premiumTts, browserTts] : [browserTts], text, opts, (id) => console.warn(`[voz] provedor ${id} falhou; usando o próximo`));
}

async function speakPremium(text: string, opts: SpeakOptions): Promise<boolean> {
  if (!supabase) return false;
  const ctrl = new AbortController();
  const speed = opts.rate ?? 1;
  const cacheKey = isCacheablePhrase(text) ? TtsCache.key(`${text}@${speed}`, PREMIUM_VOICE, 'pt-BR') : null;
  const cached = cacheKey ? ttsCache.get(cacheKey) : undefined;
  if (cached) return play(URL.createObjectURL(cached), ctrl, opts);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: toSpeakable(text), speed }),
    signal: ctrl.signal,
  });
  if (res.status === 503) premiumOff = true;
  if (!res.ok || !res.body) return false;

  let url: string;
  if (cacheKey) {
    const blob = await res.blob();
    ttsCache.set(cacheKey, blob);
    url = URL.createObjectURL(blob);
  } else if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) {
    // Streaming: começa a tocar com os primeiros pedaços (Chrome/Edge/Android). Safari recebe o arquivo inteiro.
    const ms = new MediaSource();
    url = URL.createObjectURL(ms);
    const body = res.body;
    ms.addEventListener('sourceopen', async () => {
      const sb = ms.addSourceBuffer('audio/mpeg');
      const reader = body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (sb.updating) await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
          sb.appendBuffer(value);
        }
        if (sb.updating) await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
        if (ms.readyState === 'open') ms.endOfStream();
      } catch { /* interrompido */ }
    }, { once: true });
  } else {
    url = URL.createObjectURL(await res.blob());
  }
  return play(url, ctrl, opts);
}

function play(url: string, ctrl: AbortController, opts: SpeakOptions): Promise<boolean> {
  const audio = new Audio(url);
  return new Promise<boolean>((resolve) => {
    let tick: ReturnType<typeof setInterval> | undefined;
    const done = () => {
      clearInterval(tick);
      URL.revokeObjectURL(url);
      if (current?.audio === audio) current = null;
      resolve(true);
    };
    current = { audio, ctrl, url, done };
    audio.onended = done;
    audio.onerror = done;
    audio.onplaying = () => { tick = setInterval(() => opts.onBoundary?.(), 120); };
    audio.play().catch(() => { clearInterval(tick); URL.revokeObjectURL(url); current = null; ctrl.abort(); resolve(false); });
  });
}

function speakBrowser(text: string, opts: SpeakOptions): Promise<boolean> {
  if (!voiceSupport.tts()) return Promise.resolve(false);
  const u = new SpeechSynthesisUtterance(toSpeakable(text).slice(0, 1200));
  u.lang = 'pt-BR';
  u.rate = opts.rate ?? 1;
  const voices = ptVoices();
  const v = voices.find((x) => x.name === opts.voice) ?? voices.find((x) => /pt-BR/i.test(x.lang) && /(google|natural|neural|francisca|antonio)/i.test(x.name)) ?? voices[0];
  if (v) u.voice = v;
  return new Promise((resolve) => {
    u.onend = () => resolve(true);
    u.onerror = (e) => resolve(e.error === 'interrupted' || e.error === 'canceled');
    u.onboundary = () => opts.onBoundary?.();
    speechSynthesis.speak(u);
  });
}

/** Interrompe qualquer fala (premium ou do navegador) imediatamente. */
export function stopSpeaking() {
  stopPremium();
  if (voiceSupport.tts()) speechSynthesis.cancel();
}

function stopPremium() {
  if (current) {
    const c = current;
    current = null;
    c.ctrl.abort();
    c.audio.pause();
    c.done();
  }
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
