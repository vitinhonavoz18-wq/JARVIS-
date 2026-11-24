import { describe, it, expect, vi } from 'vitest';
import { SilenceDetector, TtsCache, VOICE_LIMITS, isCacheablePhrase, speakWithFallback, validateRecording, type TextToSpeech } from './voice.ts';

const loud = VOICE_LIMITS.speechLevel + 0.2;

/** Alimenta o detector a cada 100 ms e devolve o instante (ms) em que pediu para parar. */
function run(levels: number[], step = 100) {
  const d = new SilenceDetector();
  for (let i = 0; i < levels.length; i++) if (d.push(levels[i], i * step) === 'stop') return { d, stopAt: i * step };
  return { d, stopAt: null };
}

describe('detecção de silêncio', () => {
  it('para após o silêncio configurado depois da fala', () => {
    const { stopAt } = run([...Array(10).fill(loud), ...Array(20).fill(0)]);
    // última fala em 900 ms → para em 900 + silenceMs
    expect(stopAt).toBe(900 + VOICE_LIMITS.silenceMs);
  });

  it('não para por silêncio antes de alguém falar, só no limite máximo', () => {
    const { d, stopAt } = run(Array(200).fill(0));
    expect(d.heardSpeech).toBe(false);
    expect(stopAt).toBe(VOICE_LIMITS.maxRecordingMs);
  });

  it('respeita a duração máxima mesmo com fala contínua', () => {
    expect(run(Array(200).fill(loud)).stopAt).toBe(VOICE_LIMITS.maxRecordingMs);
  });

  it('ruído abaixo do limiar não conta como fala', () => {
    const { d } = run(Array(30).fill(VOICE_LIMITS.speechLevel / 2));
    expect(d.speechMs).toBe(0);
  });
});

describe('rejeição de áudio curto ou vazio', () => {
  it('rejeita gravação vazia', () => {
    expect(validateRecording({ bytes: 0, speechMs: 2000 })).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejeita fala mais curta que o mínimo (ruído, clique)', () => {
    expect(validateRecording({ bytes: 5000, speechMs: VOICE_LIMITS.minSpeechMs - 100 })).toEqual({ ok: false, reason: 'too_short' });
  });
  it('aceita fala suficiente', () => {
    const { d } = run([...Array(8).fill(loud), ...Array(15).fill(0)]);
    expect(validateRecording({ bytes: 5000, speechMs: d.speechMs }).ok).toBe(true);
  });
});

describe('cache de TTS', () => {
  const blob = (size: number) => ({ size });

  it('só aceita frases fixas, curtas e sem dados', () => {
    expect(isCacheablePhrase('Pronto.')).toBe(true);
    expect(isCacheablePhrase('  posso executar estas ações? ')).toBe(true);
    expect(isCacheablePhrase('Reunião com Ana às 15h amanhã.')).toBe(false);
    expect(isCacheablePhrase('Você tem 3 tarefas.')).toBe(false);
  });

  it('a chave inclui voz e idioma', () => {
    expect(TtsCache.key('Pronto.', 'v1', 'pt-BR')).not.toBe(TtsCache.key('Pronto.', 'v2', 'pt-BR'));
    expect(TtsCache.key('Pronto.', 'v1', 'pt-BR')).not.toBe(TtsCache.key('Pronto.', 'v1', 'en'));
  });

  it('descarta o menos usado ao passar do limite de entradas (LRU)', () => {
    const c = new TtsCache<{ size: number }>(2, 1000);
    c.set('a', blob(10));
    c.set('b', blob(10));
    c.get('a'); // "a" passa a ser o mais recente
    c.set('c', blob(10));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeDefined();
    expect(c.size).toBe(2);
  });

  it('respeita o limite de bytes e ignora itens grandes demais', () => {
    const c = new TtsCache<{ size: number }>(10, 100);
    c.set('a', blob(60));
    c.set('b', blob(60));
    expect(c.get('a')).toBeUndefined();
    expect(c.totalBytes).toBe(60);
    c.set('x', blob(500));
    expect(c.get('x')).toBeUndefined();
  });
});

describe('fallback de voz', () => {
  const tts = (id: string, result: boolean | Error, available = true): TextToSpeech => ({
    id,
    available: () => available,
    speak: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    stop: () => {},
  });

  it('usa a voz premium quando funciona', async () => {
    const browser = tts('browser', true);
    expect(await speakWithFallback([tts('premium', true), browser], 'oi', {})).toBe('premium');
    expect(browser.speak).not.toHaveBeenCalled();
  });

  it('cai para o navegador quando a premium falha e registra o erro', async () => {
    const onError = vi.fn();
    expect(await speakWithFallback([tts('premium', new Error('502')), tts('browser', true)], 'oi', {}, onError)).toBe('browser');
    expect(onError).toHaveBeenCalledWith('premium', expect.any(Error));
  });

  it('pula provedor indisponível e devolve null se nenhum falar (resposta fica só em texto)', async () => {
    expect(await speakWithFallback([tts('premium', true, false), tts('browser', false)], 'oi', {})).toBeNull();
  });
});
