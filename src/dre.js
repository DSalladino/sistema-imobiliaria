import { db } from './db.js';
import { resolverTaxa, getSetting, hojeISO, competenciaAtual, brl } from './regras.js';

/**
 * DRE por imóvel: mostra, imóvel a imóvel, quanto entrou de aluguel, quanto foi
 * taxa da imobiliária, despesas, comissões e o que sobra para o proprietário.
 */

const money = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function drePorImovel({ de, ate, proprietario_id = null } = {}) {
  const ateFinal = /^\d{4}-\d{2}$/.test(String(ate || '')) ? String(ate) : competenciaAtual();
  const deInicial = /^\d{4}-\d{2}$/.test(String(de || '')) ? String(de) : ateFinal;
  const propId = proprietario_id ? Number(proprietario_id) : null;

  const imoveis = db.prepare(`
    SELECT i.*, p.nome AS proprietario_nome, p.taxa_admin_pct AS prop_taxa
    FROM imoveis i JOIN proprietarios p ON p.id = i.proprietario_id
    WHERE i.ativo = 1${propId ? ' AND i.proprietario_id = ' + propId : ''}
    ORDER BY p.nome, i.endereco
  `).all();

  const linhas = [];
  for (const imovel of imoveis) {
    const contratos = db.prepare('SELECT * FROM contratos WHERE imovel_id = ?').all(imovel.id);
    let alugueis = 0;
    let taxa = 0;
    for (const c of contratos) {
      const recebido = db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) AS total FROM lancamentos
        WHERE contrato_id = ? AND competencia BETWEEN ? AND ? AND tipo = 'receita'
          AND categoria = 'Aluguel' AND status = 'ativo'`).get(c.id, deInicial, ateFinal).total;
      if (!recebido) continue;
      const regra = resolverTaxa(
        { taxa_admin_pct: c.taxa_admin_pct, justificativa_taxa: c.justificativa_taxa },
        { taxa_admin_pct: imovel.taxa_admin_pct },
        { taxa_admin_pct: imovel.prop_taxa }
      );
      alugueis += recebido;
      taxa += Math.round(recebido * regra.pct / 100);
    }

    const despesas = db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) AS total FROM lancamentos
      WHERE imovel_id = ? AND competencia BETWEEN ? AND ? AND tipo = 'despesa' AND status = 'ativo'
        AND caixa = 'proprietarios' AND categoria <> 'Repasse ao proprietário'`).get(imovel.id, deInicial, ateFinal).total;

    const comissoes = db.prepare(`SELECT COALESCE(SUM(cm.valor_centavos),0) AS total FROM comissoes cm
      JOIN contratos ct ON ct.id = cm.contrato_id
      WHERE ct.imovel_id = ? AND cm.competencia BETWEEN ? AND ? AND cm.status <> 'cancelada'`)
      .get(imovel.id, deInicial, ateFinal).total;

    if (!alugueis && !despesas && !comissoes) continue;

    const resultadoProprietario = alugueis - taxa - despesas;
    const resultadoImobiliaria = taxa - comissoes;
    linhas.push({
      imovel_id: imovel.id,
      imovel: `${imovel.endereco}${imovel.numero ? ', ' + imovel.numero : ''}${imovel.complemento ? ' - ' + imovel.complemento : ''}`,
      proprietario: imovel.proprietario_nome,
      contratos: contratos.length,
      alugueis_centavos: alugueis,
      taxa_centavos: taxa,
      despesas_centavos: despesas,
      comissoes_centavos: comissoes,
      resultado_proprietario_centavos: resultadoProprietario,
      resultado_imobiliaria_centavos: resultadoImobiliaria,
      margem_pct: alugueis > 0 ? Math.round((resultadoImobiliaria / alugueis) * 10000) / 100 : 0,
    });
  }

  const total = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
  return {
    de: deInicial,
    ate: ateFinal,
    linhas,
    totais: {
      alugueis_centavos: total('alugueis_centavos'),
      taxa_centavos: total('taxa_centavos'),
      despesas_centavos: total('despesas_centavos'),
      comissoes_centavos: total('comissoes_centavos'),
      resultado_proprietario_centavos: total('resultado_proprietario_centavos'),
      resultado_imobiliaria_centavos: total('resultado_imobiliaria_centavos'),
    },
  };
}

/** Versão no formato dos relatórios existentes (CSV, XLSX e PDF). */
export function construirRelatorioDre({ de, ate, proprietario_id = null } = {}) {
  const dre = drePorImovel({ de, ate, proprietario_id });
  const t = dre.totais;
  const prop = proprietario_id ? db.prepare('SELECT nome FROM proprietarios WHERE id = ?').get(Number(proprietario_id)) : null;
  return {
    empresa: getSetting('imob_nome', 'Imobiliária'),
    cnpj: getSetting('imob_cnpj', ''),
    gerado_em: hojeISO().split('-').reverse().join('/'),
    filtro_proprietario: prop?.nome || null,
    titulo: 'DRE por imóvel',
    subtitulo: `Competências de ${dre.de} a ${dre.ate}`,
    colunas: [
      { key: 'imovel', titulo: 'Imóvel', largura: 22, tipo: 'text' },
      { key: 'proprietario', titulo: 'Proprietário', largura: 15, tipo: 'text' },
      { key: 'alugueis_centavos', titulo: 'Aluguéis', largura: 12, tipo: 'money', align: 'right' },
      { key: 'taxa_centavos', titulo: 'Taxa adm.', largura: 11, tipo: 'money', align: 'right' },
      { key: 'despesas_centavos', titulo: 'Despesas', largura: 11, tipo: 'money', align: 'right' },
      { key: 'comissoes_centavos', titulo: 'Comissões', largura: 11, tipo: 'money', align: 'right' },
      { key: 'resultado_proprietario_centavos', titulo: 'Resultado prop.', largura: 13, tipo: 'money', align: 'right' },
      { key: 'resultado_imobiliaria_centavos', titulo: 'Resultado imob.', largura: 13, tipo: 'money', align: 'right' },
      { key: 'margem_pct', titulo: 'Margem %', largura: 8, tipo: 'pct', align: 'right' },
    ],
    linhas: dre.linhas,
    resumo: [
      { rotulo: 'Aluguéis administrados', valor: money(t.alugueis_centavos), bruto: t.alugueis_centavos },
      { rotulo: 'Taxa de administração', valor: money(t.taxa_centavos), bruto: t.taxa_centavos },
      { rotulo: 'Despesas dos imóveis', valor: money(t.despesas_centavos), bruto: t.despesas_centavos },
      { rotulo: 'Comissões', valor: money(t.comissoes_centavos), bruto: t.comissoes_centavos },
      { rotulo: 'Resultado dos proprietários', valor: money(t.resultado_proprietario_centavos), bruto: t.resultado_proprietario_centavos },
      { rotulo: 'Resultado da imobiliária', valor: money(t.resultado_imobiliaria_centavos), bruto: t.resultado_imobiliaria_centavos },
    ],
    total_geral: brl(t.resultado_imobiliaria_centavos),
  };
}
