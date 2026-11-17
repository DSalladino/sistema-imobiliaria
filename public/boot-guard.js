/* Rede de segurança da inicialização.
 *
 * Se o JavaScript principal falhar (módulo indisponível, versão antiga do
 * navegador, servidor fora do ar), o usuário não pode ficar olhando para um
 * spinner eterno. Esta mensagem explica o que aconteceu e oferece uma saída.
 */
(() => {
  const boot = document.getElementById('boot');
  const alvo = document.getElementById('boot-error');
  let mostrou = false;

  function mostrar(motivo) {
    if (mostrou || !boot || boot.hidden || !alvo) return;
    mostrou = true;
    const detalhe = motivo ? `<p class="boot-detail">${String(motivo).replace(/[<>&]/g, '')}</p>` : '';
    alvo.innerHTML = `
      <strong>Não foi possível abrir a interface.</strong>
      <p>O servidor pode estar iniciando, ou o navegador não conseguiu carregar os arquivos.</p>
      ${detalhe}
      <div class="boot-actions">
        <button type="button" data-recarregar>Recarregar</button>
        <a href="/api/health" target="_blank" rel="noopener">Ver diagnóstico</a>
      </div>
      <small>Se o problema continuar, confirme que o sistema está rodando (npm start) e que você está usando Node.js 24.</small>`;
    alvo.hidden = false;
    alvo.querySelector('[data-recarregar]')?.addEventListener('click', () => location.reload());
  }

  window.addEventListener('error', (e) => {
    // Ignora erros de recursos de terceiros; o foco é a inicialização.
    if (e?.target && e.target !== window) return;
    mostrar(e?.message || '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e?.reason?.message || e?.reason || '';
    if (/Failed to fetch|Importing a module script failed|not defined/i.test(String(msg))) mostrar(msg);
  });

  setTimeout(async () => {
    if (!boot || boot.hidden) return;
    let pista = '';
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const d = await r.json();
      if (!d.ok) pista = `O servidor respondeu, mas o banco (${d.banco}) ou os uploads (${d.uploads}) estão com problema.`;
      else pista = 'O servidor está saudável; o bloqueio parece ser no carregamento dos arquivos da interface.';
    } catch {
      pista = 'O servidor não respondeu em /api/health. Confirme se o processo está em execução.';
    }
    mostrar(pista);
  }, 12000);
})();
