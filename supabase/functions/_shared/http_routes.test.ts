// Cada módulo inicia um servidor Deno ao ser importado. Nos testes apenas o
// endereço de escuta muda, para que a requisição passe pelo handler original.
for (const slug of ['ai-chat', 'automation-gateway', 'jarvis-command', 'jarvis-events', 'process-reminders', 'transcribe']) {
  Deno.test(slug + ' valida o método e exige autenticação', async () => {
    const serve = Deno.serve;
    let server: Deno.HttpServer<Deno.NetAddr> | undefined;
    Deno.serve = ((handler: Deno.ServeHandler) => {
      server = serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, handler);
      return server;
    }) as typeof Deno.serve;
    try {
      await import(`../${slug}/index.ts`);
      if (!server) throw new Error('O handler não iniciou');
      const url = `http://127.0.0.1:${server.addr.port}`;
      for (const [method, expected] of [['GET', 405], ['POST', 401]] as const) {
        const response = await fetch(url, { method });
        await response.text();
        if (response.status !== expected) throw new Error(`${method}: esperado ${expected}, recebido ${response.status}`);
      }
    } finally {
      Deno.serve = serve;
      await server?.shutdown();
    }
  });
}
