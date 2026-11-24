import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRepo } from '../data/memoryRepo.ts';
import { clearWeatherCache, weatherTool } from './weatherTools.ts';
import { parseCommand } from './nlu.ts';
import type { ToolContext } from './tools.ts';

const NOW = new Date('2026-11-24T13:00:00Z');
const geo = { results: [{ name: 'Salvador', admin1: 'Bahia', latitude: -12.97, longitude: -38.5 }] };
const forecast = { daily: { time: ['2026-11-24', '2026-11-25'], temperature_2m_max: [30.4, 29.6], temperature_2m_min: [23.1, 22.8], precipitation_probability_max: [10, 60], weather_code: [1, 61] } };

function ctx(fetchImpl: typeof fetch): ToolContext {
  return { repo: new MemoryRepo('u'), now: NOW, tz: 'America/Bahia', source: 'ai', prefs: {} as never, fetch: fetchImpl } as unknown as ToolContext;
}
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => clearWeatherCache());

describe('get_weather', () => {
  it('devolve a previsão real de amanhã com a fonte', async () => {
    const f = vi.fn((url: string) => ok(url.includes('geocoding') ? geo : forecast)) as unknown as typeof fetch;
    const r = await weatherTool.run(ctx(f), { date: 'tomorrow' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Amanhã em Salvador, Bahia: chuva');
    expect(r.message).toContain('60% de chance de chuva');
    expect(r.message).toContain('Open-Meteo');
  });

  it('usa o cache e não chama a API de novo', async () => {
    const f = vi.fn((url: string) => ok(url.includes('geocoding') ? geo : forecast)) as unknown as typeof fetch;
    await weatherTool.run(ctx(f), { date: 'today' });
    await weatherTool.run(ctx(f), { date: 'tomorrow' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falha de rede vira mensagem clara, sem inventar dados', async () => {
    const f = vi.fn(() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    const r = await weatherTool.run(ctx(f), { date: 'today' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não respondeu/);
  });

  it('cidade inexistente é informada', async () => {
    const f = vi.fn(() => ok({ results: [] })) as unknown as typeof fetch;
    expect((await weatherTool.run(ctx(f), { city: 'Xyzabc', date: 'today' })).message).toContain('Não encontrei');
  });

  it('interpretador extrai cidade e dia', () => {
    const r = parseCommand('vai chover amanhã em Feira de Santana?', { now: NOW, tz: 'America/Bahia' }) as { calls: { input: unknown }[] };
    expect(r.calls[0].input).toEqual({ date: 'tomorrow', city: 'feira de santana' });
  });
});
