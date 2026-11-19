/** Converte a resposta do JARVIS em texto natural para ser falado (Siri, navegador, celular). */
export function toSpeakable(text: string): string {
  return text
    .replace(/[•✓⚠*_#>`“”"]/g, '')
    .replace(/\[(.*?)\]/g, '$1')
    .replace(/(\d{1,2})h(\d{2})/g, '$1 e $2')
    .replace(/:\s*\n/g, ': ')
    .replace(/\n+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
