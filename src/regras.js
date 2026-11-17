import { db } from './db.js';

export const hojeISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const competenciaAtual = () => hojeISO().slice(0, 7);

// Configurações mudam pouco e são lidas em laço (multa/juros por cobrança,
// nomes em relatórios). Um cache em memória evita preparar e executar a mesma
// consulta milhares de vezes por requisição. `setSetting` mantém o cache
// coerente; processos externos que editem a tabela exigem reinício.
let cacheSettings = null;

function carregarSettings() {
  if (!cacheSettings) {
    cacheSettings = new Map(db.prepare('SELECT chave, valor FROM settings').all().map(r => [r.chave, r.valor]));
  }
  return cacheSettings;
}

export function invalidarCacheSettings() {
  cacheSettings = null;
}

export function getSetting(chave, padrao = '') {
  const valor = carregarSettings().get(chave);
  return valor === undefined ? padrao : valor;
}

export function getSettingNum(chave, padrao = 0) {
  const v = String(getSetting(chave, '')).replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

export function setSetting(chave, valor) {
  const texto = String(valor ?? '');
  db.prepare('UPDATE settings SET valor = ? WHERE chave = ?').run(texto, chave);
  carregarSettings().set(chave, texto);
}

export function brl(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function diffDias(dataISO) {
  if (!dataISO) return null;
  const alvo = new Date(dataISO + 'T00:00:00');
  const hoje = new Date(hojeISO() + 'T00:00:00');
  return Math.round((alvo - hoje) / 86400000);
}

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addMeses(dataISO, meses) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setMonth(d.getMonth() + meses);
  // Formata pelos componentes locais: `toISOString()` pode voltar um dia em
  // servidores com fuso horário positivo (ex.: Europa), alterando vencimentos.
  return isoLocal(d);
}

export function competenciaDe(dataISO) {
  return String(dataISO || '').slice(0, 7);
}

export function mesFechado(competencia) {
  const f = db.prepare('SELECT * FROM fechamentos WHERE competencia = ?').get(competencia);
  return !!(f && !f.reaberto_em);
}

export function exigirMesAberto(competencia) {
  if (mesFechado(competencia)) {
    const err = new Error(`A competência ${competencia} está fechada. Peça ao administrador para reabrir.`);
    err.status = 409;
    throw err;
  }
}

/** Precedência: contrato > imóvel > proprietário > regra geral. */
export function resolverTaxa(contrato, imovel, proprietario) {
  if (contrato?.taxa_admin_pct != null) {
    return { pct: Number(contrato.taxa_admin_pct), origem: 'Exceção do contrato', detalhe: contrato.justificativa_taxa || '' };
  }
  if (imovel?.taxa_admin_pct != null) {
    return { pct: Number(imovel.taxa_admin_pct), origem: 'Regra do imóvel', detalhe: '' };
  }
  if (proprietario?.taxa_admin_pct != null) {
    return { pct: Number(proprietario.taxa_admin_pct), origem: 'Regra do proprietário', detalhe: '' };
  }
  return { pct: getSettingNum('taxa_admin_padrao', 8), origem: 'Regra geral', detalhe: '' };
}

export function contratosDoProprietario(proprietarioId) {
  return db.prepare(`
    SELECT c.*, i.endereco, i.numero, i.complemento, i.apelido, i.taxa_admin_pct AS imovel_taxa,
           q.nome AS inquilino_nome
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN inquilinos q ON q.id = c.inquilino_id
    WHERE i.proprietario_id = ?
    ORDER BY c.id
  `).all(proprietarioId);
}
// Inclui contratos encerrados/suspensos de propósito: se houve aluguel
// recebido na competência, o proprietário precisa receber o repasse mesmo que o
// contrato tenha sido encerrado depois do pagamento. O filtro real é a receita
// encontrada dentro do laço de cálculo.

export function calcularRepasse(competencia, proprietarioId) {
  const prop = db.prepare('SELECT * FROM proprietarios WHERE id = ?').get(proprietarioId);
  if (!prop) throw Object.assign(new Error('Proprietário não encontrado.'), { status: 404 });

  const contratos = contratosDoProprietario(proprietarioId);
  const detalheContratos = [];
  let aluguelTotal = 0;
  let taxaTotal = 0;

  for (const c of contratos) {
    const receitas = db.prepare(`
      SELECT COALESCE(SUM(valor_centavos),0) AS total
      FROM lancamentos
      WHERE contrato_id = ? AND competencia = ? AND tipo = 'receita'
        AND categoria = 'Aluguel' COLLATE NOCASE AND status = 'ativo'
    `).get(c.id, competencia).total;
    if (!receitas) continue;

    const taxa = resolverTaxa(
      { taxa_admin_pct: c.taxa_admin_pct, justificativa_taxa: c.justificativa_taxa },
      { taxa_admin_pct: c.imovel_taxa },
      prop
    );
    const taxaValor = Math.round(receitas * taxa.pct / 100);
    aluguelTotal += receitas;
    taxaTotal += taxaValor;
    detalheContratos.push({
      contrato_id: c.id,
      codigo: c.codigo,
      imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`,
      inquilino: c.inquilino_nome,
      aluguel_centavos: receitas,
      taxa_pct: taxa.pct,
      taxa_origem: taxa.origem,
      taxa_detalhe: taxa.detalhe,
      taxa_centavos: taxaValor,
    });
  }

  const despesas = db.prepare(`
    SELECT id, data, categoria, descricao, valor_centavos
    FROM lancamentos
    WHERE proprietario_id = ? AND competencia = ? AND tipo = 'despesa'
      AND caixa = 'proprietarios' AND status = 'ativo' AND repasse_id IS NULL
    ORDER BY data
  `).all(proprietarioId, competencia);
  // O pagamento do próprio repasse também é uma despesa no caixa dos
  // proprietários, mas nunca pode ser descontado de uma nova apuração.
  const despesasTotal = despesas.reduce((s, d) => s + d.valor_centavos, 0);

  const excecoes = db.prepare(`
    SELECT e.*, c.codigo FROM excecoes e
    JOIN contratos c ON c.id = e.contrato_id
    JOIN imoveis i ON i.id = c.imovel_id
    WHERE i.proprietario_id = ? AND e.competencia = ?
    ORDER BY e.id
  `).all(proprietarioId, competencia);
  const descontos = excecoes.filter(e => e.tipo === 'desconto').reduce((s, e) => s + e.valor_centavos, 0);
  const acrescimos = excecoes.filter(e => e.tipo === 'acrescimo').reduce((s, e) => s + e.valor_centavos, 0);

  const valor = aluguelTotal - taxaTotal - despesasTotal - descontos + acrescimos;
  const taxaPctMedia = aluguelTotal > 0 ? (taxaTotal / aluguelTotal) * 100 : 0;

  return {
    competencia,
    proprietario_id: proprietarioId,
    proprietario_nome: prop.nome,
    aluguel_centavos: aluguelTotal,
    taxa_pct: Math.round(taxaPctMedia * 10000) / 10000,
    taxa_centavos: taxaTotal,
    despesas_centavos: despesasTotal,
    descontos_centavos: descontos,
    acrescimos_centavos: acrescimos,
    valor_centavos: valor,
    detalhe: { contratos: detalheContratos, despesas, excecoes },
  };
}

export function gerarRepasses(competencia, usuarioNome) {
  exigirMesAberto(competencia);
  const props = db.prepare('SELECT id FROM proprietarios WHERE ativo = 1 ORDER BY id').all();
  const resultados = [];
  for (const p of props) {
    const calc = calcularRepasse(competencia, p.id);
    const semMovimento = calc.aluguel_centavos === 0 && calc.despesas_centavos === 0
      && calc.descontos_centavos === 0 && calc.acrescimos_centavos === 0;
    const existente = db.prepare('SELECT * FROM repasses WHERE competencia = ? AND proprietario_id = ?').get(competencia, p.id);
    if (existente && existente.status === 'pago') { resultados.push({ ...calc, id: existente.id, status: 'pago', ignorado: true }); continue; }
    if (existente) {
      // Se os lançamentos foram estornados, o repasse pendente precisa ser
      // zerado; caso contrário continuaria pagável com valores que não existem mais.
      db.prepare(`UPDATE repasses SET aluguel_centavos=?, taxa_pct=?, taxa_centavos=?, despesas_centavos=?,
                  descontos_centavos=?, acrescimos_centavos=?, valor_centavos=?, detalhe_json=?, status='calculado'
                  WHERE id=?`)
        .run(calc.aluguel_centavos, calc.taxa_pct, calc.taxa_centavos, calc.despesas_centavos,
          calc.descontos_centavos, calc.acrescimos_centavos, calc.valor_centavos, JSON.stringify(calc.detalhe), existente.id);
      resultados.push({ ...calc, id: existente.id, status: 'calculado', ignorado: semMovimento });
    } else if (!semMovimento) {
      const r = db.prepare(`INSERT INTO repasses (competencia, proprietario_id, aluguel_centavos, taxa_pct, taxa_centavos,
                  despesas_centavos, descontos_centavos, acrescimos_centavos, valor_centavos, detalhe_json, status)
                  VALUES (?,?,?,?,?,?,?,?,?,?,'calculado')`)
        .run(competencia, p.id, calc.aluguel_centavos, calc.taxa_pct, calc.taxa_centavos, calc.despesas_centavos,
          calc.descontos_centavos, calc.acrescimos_centavos, calc.valor_centavos, JSON.stringify(calc.detalhe));
      resultados.push({ ...calc, id: Number(r.lastInsertRowid), status: 'calculado' });
    }
  }
  return resultados;
}

export function pagarRepasse(id, usuarioNome) {
  const r = db.prepare('SELECT * FROM repasses WHERE id = ?').get(id);
  if (!r) throw Object.assign(new Error('Repasse não encontrado.'), { status: 404 });
  if (r.status === 'pago') throw Object.assign(new Error('Repasse já foi pago.'), { status: 409 });
  exigirMesAberto(r.competencia);

  const data = hojeISO();
  if (r.valor_centavos <= 0) {
    throw Object.assign(new Error('Este repasse não tem valor a pagar (despesas maiores que os aluguéis). Ajuste os lançamentos ou registre uma exceção antes de pagar.'), { status: 409 });
  }
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, repasse_id, criado_por)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(data, r.competencia, 'despesa', 'Repasse ao proprietário', `Repasse ${r.competencia}`, r.valor_centavos, 'proprietarios', r.proprietario_id, r.id, usuarioNome);
    if (r.taxa_centavos > 0) {
      db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, repasse_id, criado_por)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(data, r.competencia, 'receita', 'Taxa de administração', `Taxa de administração ${r.competencia}`, r.taxa_centavos, 'imobiliaria', r.proprietario_id, r.id, usuarioNome);
    }
    db.prepare(`UPDATE repasses SET status = 'pago', pago_em = ? WHERE id = ?`).run(data, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return db.prepare('SELECT * FROM repasses WHERE id = ?').get(id);
}

export function saldos() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN caixa='imobiliaria' AND tipo='receita' THEN valor_centavos ELSE 0 END),0) AS rec_imob,
      COALESCE(SUM(CASE WHEN caixa='imobiliaria' AND tipo='despesa' THEN valor_centavos ELSE 0 END),0) AS desp_imob,
      COALESCE(SUM(CASE WHEN caixa='proprietarios' AND tipo='receita' THEN valor_centavos ELSE 0 END),0) AS rec_prop,
      COALESCE(SUM(CASE WHEN caixa='proprietarios' AND tipo='despesa' THEN valor_centavos ELSE 0 END),0) AS desp_prop
    FROM lancamentos WHERE status = 'ativo'
  `).get();
  return {
    imobiliaria_centavos: row.rec_imob - row.desp_imob,
    proprietarios_centavos: row.rec_prop - row.desp_prop,
    receitas_imob_centavos: row.rec_imob,
    despesas_imob_centavos: row.desp_imob,
  };
}

export function alertas() {
  const lista = [];
  const hoje = hojeISO();
  const limiares = String(getSetting('dias_alerta_contrato', '90,60,30'))
    .split(',').map(n => Number(n.trim())).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const maxContrato = limiares.length ? Math.max(...limiares) : 90;
  const nivelPorDias = (dias) => {
    if (!limiares.length) return 'info';
    if (dias <= limiares[0]) return 'urgente';
    if (limiares.length > 1 && dias <= limiares[1]) return 'atencao';
    return 'info';
  };

  const contratos = db.prepare(`
    SELECT c.*, i.endereco, i.numero, i.complemento, i.proprietario_id, p.nome AS proprietario_nome, q.nome AS inquilino_nome, q.telefone AS inquilino_telefone, q.email AS inquilino_email
    FROM contratos c
    JOIN imoveis i ON i.id = c.imovel_id
    JOIN proprietarios p ON p.id = i.proprietario_id
    JOIN inquilinos q ON q.id = c.inquilino_id
    WHERE c.status = 'ativo'
  `).all();

  for (const c of contratos) {
    const endereco = `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`;
    if (c.fim) {
      const dias = diffDias(c.fim);
      if (dias != null && dias <= maxContrato) {
        lista.push({
          tipo: 'contrato', nivel: dias < 0 ? 'urgente' : nivelPorDias(dias),
          titulo: `Contrato ${c.codigo || '#' + c.id}: ${endereco}`,
          descricao: dias < 0 ? `Venceu há ${Math.abs(dias)} dias (${c.fim})` : `Vence em ${dias} dias (${c.fim})`,
          data: c.fim, dias, contrato_id: c.id, proprietario: c.proprietario_nome, inquilino: c.inquilino_nome,
          responsavel: c.proprietario_nome,
        });
      }
    }

    const baseReajuste = c.ultimo_reajuste || c.inicio;
    let proximo = addMeses(baseReajuste, 12);
    let guard = 0;
    while (diffDias(proximo) < 0 && guard++ < 50) proximo = addMeses(proximo, 12);
    const diasReajuste = diffDias(proximo);
    if (diasReajuste != null && diasReajuste <= getSettingNum('dias_alerta_reajuste', 30)) {
      lista.push({
        tipo: 'reajuste', nivel: diasReajuste <= 7 ? 'urgente' : 'atencao',
        titulo: `Reajuste ${c.codigo || '#' + c.id}: ${endereco}`,
        descricao: `Reajuste anual (${c.indice_reajuste || 'índice'}) em ${diasReajuste} dias (${proximo})`,
        data: proximo, dias: diasReajuste, contrato_id: c.id, proprietario: c.proprietario_nome, inquilino: c.inquilino_nome,
        responsavel: c.proprietario_nome,
      });
    }

    if (c.garantia_fim) {
      const diasG = diffDias(c.garantia_fim);
      if (diasG != null && diasG <= getSettingNum('dias_alerta_garantia', 30)) {
        lista.push({
          tipo: 'garantia', nivel: diasG < 0 ? 'urgente' : 'atencao',
          titulo: `Garantia ${c.codigo || '#' + c.id}: ${endereco}`,
          descricao: diasG < 0 ? `Garantia vencida há ${Math.abs(diasG)} dias` : `Garantia termina em ${diasG} dias (${c.garantia_fim})`,
          data: c.garantia_fim, dias: diasG, contrato_id: c.id, proprietario: c.proprietario_nome, inquilino: c.inquilino_nome,
          responsavel: c.proprietario_nome,
        });
      }
    }

    const comp = hoje.slice(0, 7);
    const [ano, mes] = comp.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const diaVenc = Math.min(c.dia_vencimento || 5, ultimoDia);
    const venc = `${comp}-${String(diaVenc).padStart(2, '0')}`;
    const diasAtraso = diffDias(venc) * -1;
    if (diasAtraso >= getSettingNum('dias_alerta_atraso', 1)) {
      const pago = db.prepare(`SELECT COALESCE(SUM(valor_centavos),0) AS total FROM lancamentos
        WHERE contrato_id = ? AND competencia = ? AND tipo='receita' AND categoria='Aluguel' COLLATE NOCASE AND status='ativo'`)
        .get(c.id, comp).total;
      // Pagamento parcial também é inadimplência: compara valores, não a
      // quantidade de lançamentos.
      if (pago < (c.aluguel_centavos || 0)) {
        lista.push({
          tipo: 'atraso', nivel: diasAtraso > 10 ? 'urgente' : 'atencao',
          titulo: `Aluguel em atraso: ${endereco}`,
          descricao: `${diasAtraso} dia(s) de atraso — vencimento ${venc}`,
          data: venc, dias: -diasAtraso, contrato_id: c.id, proprietario: c.proprietario_nome, inquilino: c.inquilino_nome,
          responsavel: c.inquilino_nome, telefone: c.inquilino_telefone, email: c.inquilino_email, imovel: endereco,
          valor_centavos: c.aluguel_centavos, competencia: comp,
        });
      }
    }
  }

  const ordem = { urgente: 0, atencao: 1, info: 2 };
  lista.sort((a, b) => (ordem[a.nivel] - ordem[b.nivel]) || (Math.abs(a.dias) - Math.abs(b.dias)));
  return lista;
}

export function resumoDashboard() {
  const totalProps = db.prepare('SELECT COUNT(*) AS n FROM proprietarios WHERE ativo=1').get().n;
  const totalImoveis = db.prepare('SELECT COUNT(*) AS n FROM imoveis WHERE ativo=1').get().n;
  const totalContratos = db.prepare("SELECT COUNT(*) AS n FROM contratos WHERE status='ativo'").get().n;
  const totalInquilinos = db.prepare('SELECT COUNT(*) AS n FROM inquilinos WHERE ativo=1').get().n;
  const comp = competenciaAtual();
  const repassesPendentes = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor_centavos),0) AS v FROM repasses WHERE competencia=? AND status='calculado'").get(comp);
  const al = alertas();
  return {
    competencia: comp,
    totalProps, totalImoveis, totalContratos, totalInquilinos,
    saldos: saldos(),
    alertas: al,
    alertasResumo: {
      urgente: al.filter(a => a.nivel === 'urgente').length,
      atencao: al.filter(a => a.nivel === 'atencao').length,
      info: al.filter(a => a.nivel === 'info').length,
    },
    repassesPendentes: { quantidade: repassesPendentes.n, valor_centavos: repassesPendentes.v },
    mesFechado: mesFechado(comp),
  };
}
