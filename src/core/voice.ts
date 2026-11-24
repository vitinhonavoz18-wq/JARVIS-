/**
 * Lógica de voz independente do navegador (testável): limites, detecção de silêncio,
 * validação da gravação, cache de áudio de frases fixas e encadeamento de provedores.
 */

/** Limites da voz — ajuste aqui, em um só lugar. */
export const VOICE_LIMITS = {
  /** Silêncio contínuo, depois de já ter havido fala, que encerra a gravação. */
  silenceMs: 1200,
  /** Fala mínima para valer a pena transcrever (abaixo disso é descartado). */
  minSpeechMs: 500,
  /** Duração máxima de uma gravação. */
  maxRecordingMs: 15_000,
  /** Nível (0–1) a partir do qual o som conta como fala, e não ruído de fundo. */
  speechLevel: 0.08,
} as const;

export type VoiceLimits = typeof VOICE_LIMITS;

/**
 * Detecção de fim de fala (VAD simples por volume): recebe amostras de nível com o horário
 * e diz quando parar. Também acumula quanto tempo houve fala, para rejeitar silêncio/ruído.
 */
export class SilenceDetector {
  private started: number | null = null;
  private last: number | null = null;
  private lastSpeech: number | null = null;
  speechMs = 0;

  constructor(private limits: VoiceLimits = VOICE_LIMITS) {}

  /** Retorna 'stop' quando a fala terminou ou o tempo máximo foi atingido. */
  push(level: number, at: number): 'continue' | 'stop' {
    this.started ??= at;
    if (this.last != null && level >= this.limits.speechLevel) this.speechMs += at - this.last;
    if (level >= this.limits.speechLevel) this.lastSpeech = at;
    this.last = at;
    if (at - this.started >= this.limits.maxRecordingMs) return 'stop';
    if (this.lastSpeech != null && at - this.lastSpeech >= this.limits.silenceMs) return 'stop';
    return 'continue';
  }

  get heardSpeech() {
    return this.lastSpeech != null;
  }
}

/** Decide se uma gravação deve ir para a transcrição (economiza chamadas com áudio vazio). */
export function validateRecording(r: { bytes: number; speechMs: number }, limits: VoiceLimits = VOICE_LIMITS): { ok: true } | { ok: false; reason: 'empty' | 'too_short' } {
  if (r.bytes <= 0) return { ok: false, reason: 'empty' };
  if (r.speechMs < limits.minSpeechMs) return { ok: false, reason: 'too_short' };
  return { ok: true };
}

/* ----------------------------- Cache de TTS ----------------------------- */

/** Frases fixas que podem ser reaproveitadas. Nada fora desta lista é guardado. */
export const CACHEABLE_PHRASES = new Set(
  ['Pronto.', 'Feito.', 'Cancelado.', 'Certo.', 'Posso executar?', 'Posso executar estas ações?', 'Nenhuma alteração foi feita.', 'Sistemas operacionais e prontos.'].map(norm),
);

function norm(s: string) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Só frases curtas da lista fixa, sem números (que costumam ser dados do usuário). */
export function isCacheablePhrase(text: string): boolean {
  const t = norm(text);
  return t.length <= 60 && !/\d/.test(t) && CACHEABLE_PHRASES.has(t);
}

/** Cache LRU limitado por número de entradas e por bytes totais. */
export class TtsCache<V extends { size: number }> {
  private map = new Map<string, V>();
  private bytes = 0;
  constructor(private maxEntries = 20, private maxBytes = 2_000_000) {}

  static key(text: string, voice: string, lang: string) {
    return `${voice}|${lang}|${norm(text)}`;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v); // mais recente
    }
    return v;
  }

  set(key: string, value: V) {
    if (value.size > this.maxBytes) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.size;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.size;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [k, v] = this.map.entries().next().value as [string, V];
      this.map.delete(k);
      this.bytes -= v.size;
    }
  }

  get size() {
    return this.map.size;
  }
  get totalBytes() {
    return this.bytes;
  }
}

/* ------------------------ Interfaces de provedores ------------------------ */

export interface ListenHandle {
  result: Promise<string>;
  stop(): void;
  abort(): void;
}

export interface ListenOptions {
  lang?: string;
  onInterim?: (t: string) => void;
  onLevel?: (v: number) => void;
}

export interface SpeechToText {
  readonly id: string;
  available(): boolean;
  listen(opts: ListenOptions): ListenHandle;
}

export interface SpeakOptions {
  rate?: number;
  voice?: string | null;
  onBoundary?: () => void;
}

export interface TextToSpeech {
  readonly id: string;
  available(): boolean;
  /** true = falou (ou foi interrompido); false = não conseguiu e o próximo provedor deve tentar. */
  speak(text: string, opts: SpeakOptions): Promise<boolean>;
  stop(): void;
}

/** Tenta cada provedor em ordem; registra a falha e segue para o próximo. */
export async function speakWithFallback(providers: TextToSpeech[], text: string, opts: SpeakOptions, onError?: (id: string, e: unknown) => void): Promise<string | null> {
  for (const p of providers) {
    if (!p.available()) continue;
    try {
      if (await p.speak(text, opts)) return p.id;
      onError?.(p.id, new Error('sem áudio'));
    } catch (e) {
      onError?.(p.id, e);
    }
  }
  return null;
}
