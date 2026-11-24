/**
 * Ferramenta `get_weather`: previsão real pelo Open-Meteo (gratuito, sem chave).
 * Hosts fixos (sem URL vinda do usuário), cache de 10 minutos, nunca inventa dados.
 */
import { z } from 'zod';
import { addDaysLocal, localDateKey, localDateOf } from '../time.ts';
import { registerTools, tool, type ToolDef } from './tools.ts';

/** Cidade padrão quando o usuário não informa (fuso America/Bahia). */
export const DEFAULT_CITY = 'Salvador';
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  const res = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as T;
  cache.set(url, { at: Date.now(), data });
  return data;
}

export function clearWeatherCache() {
  cache.clear();
}

const CODES: [number[], string][] = [
  [[0], 'céu limpo'], [[1, 2], 'poucas nuvens'], [[3], 'nublado'], [[45, 48], 'neblina'],
  [[51, 53, 55, 56, 57], 'garoa'], [[61, 63, 65, 66, 67, 80, 81, 82], 'chuva'], [[71, 73, 75, 77, 85, 86], 'neve'], [[95, 96, 99], 'tempestade'],
];
const describe = (c: number) => CODES.find(([cs]) => cs.includes(c))?.[1] ?? 'condição indefinida';

interface Geo { results?: { name: string; latitude: number; longitude: number; admin1?: string; country_code?: string }[] }
interface Forecast { daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; weather_code: number[] } }

export const weatherTool = tool({
  name: 'get_weather',
  description: 'Previsão do tempo REAL (Open-Meteo) para uma cidade e um dia dos próximos 7. Sem cidade, usa a cidade padrão do usuário.',
  readOnly: true,
  timeoutMs: 12_000,
  retries: 1,
  schema: z.object({
    city: z.string().min(2).max(80).optional().describe('Cidade, ex.: "Salvador" ou "Feira de Santana"'),
    date: z.string().regex(/^(today|tomorrow|\d{4}-\d{2}-\d{2})$/).default('today').describe('today, tomorrow ou YYYY-MM-DD'),
  }),
  async run(ctx, i) {
    const fetcher = (ctx as { fetch?: typeof fetch }).fetch ?? fetch;
    const city = i.city?.trim() || DEFAULT_CITY;
    const today = localDateOf(ctx.now, ctx.tz);
    const day = i.date === 'today' ? localDateKey(today) : i.date === 'tomorrow' ? localDateKey(addDaysLocal(today, 1)) : i.date;
    try {
      const geo = await getJson<Geo>(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&format=json&name=${encodeURIComponent(city)}`, fetcher);
      const place = geo.results?.[0];
      if (!place) return { ok: false, message: `Não encontrei a cidade “${city}”.` };
      const f = await getJson<Forecast>(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=7&timezone=${encodeURIComponent(ctx.tz)}`,
        fetcher,
      );
      const idx = f.daily?.time.indexOf(day) ?? -1;
      if (!f.daily || idx < 0) return { ok: false, message: `Só tenho previsão para os próximos 7 dias.` };
      const d = f.daily;
      const rain = d.precipitation_probability_max[idx];
      const label = day === localDateKey(today) ? 'Hoje' : day === localDateKey(addDaysLocal(today, 1)) ? 'Amanhã' : day.split('-').reverse().join('/');
      const where = [place.name, place.admin1].filter(Boolean).join(', ');
      return {
        ok: true,
        message: `${label} em ${where}: ${describe(d.weather_code[idx])}, mínima de ${Math.round(d.temperature_2m_min[idx])}°C e máxima de ${Math.round(d.temperature_2m_max[idx])}°C${rain != null ? `, ${rain}% de chance de chuva` : ''}. (Fonte: Open-Meteo)`,
        data: { city: where, date: day, min: d.temperature_2m_min[idx], max: d.temperature_2m_max[idx], rain_probability: rain, code: d.weather_code[idx] },
      };
    } catch {
      return { ok: false, message: 'O serviço de previsão do tempo não respondeu agora. Tente novamente em instantes.' };
    }
  },
});

registerTools([weatherTool] as unknown as ToolDef[]);
