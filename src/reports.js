import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { db } from './db.js';
import { serieMensal, ultimoDia, mesesEntre } from './analytics.js';
import { resolverTaxa, getSetting, hojeISO, competenciaAtual } from './regras.js';
import { construirRelatorioDre } from './dre.js';

export const RELATORIOS = [
  { id: 'resumo-financeiro', nome: 'Resumo financeiro', descricao: 'Receitas, despesas, repasses e resultado mês a mês.', filtros: ['periodo'], cor: 'sage' },
  { id: 'lancamentos', nome: 'Lançamentos', descricao: 'Todas as entradas e saídas do período, com caixa e status.', filtros: ['periodo', 'proprietario'], cor: 'sky' },
  { id: 'repasses', nome: 'Repasses', descricao: 'Repasses calculados e pagos por proprietário, com composição do cálculo.', filtros: ['periodo', 'proprietario'], cor: 'lavender' },
  { id: 'cobrancas', nome: 'Cobranças', descricao: 'Cobranças por competência, encargos, baixas e saldo em aberto.', filtros: ['periodo', 'proprietario'], cor: 'blush' },
  { id: 'fluxo-caixa', nome: 'Fluxo de caixa', descricao: 'Entradas, saídas e saldo mês a mês, separando os dois caixas.', filtros: ['periodo', 'proprietario'], cor: 'mint' },
  { id: 'comissoes', nome: 'Comissões', descricao: 'Corretagem por contrato, corretor, status e lançamento financeiro.', filtros: ['periodo', 'proprietario'], cor: 'peach' },
  { id: 'contas', nome: 'Contas a pagar/receber', descricao: 'Compromissos, recorrências, atrasos e baixas no período.', filtros: ['periodo', 'proprietario'], cor: 'sky' },
  { id: 'contratos', nome: 'Carteira de contratos', descricao: 'Vigência, valores, garantias e taxa aplicada.', filtros: ['proprietario'], cor: 'butter' },
  { id: 'inadimplencia', nome: 'Inadimplência', descricao: 'Aluguéis vencidos e não pagos na competência.', filtros: ['competencia'], cor: 'blush' },
  { id: 'proprietarios', nome: 'Proprietários', descricao: 'Cadastro, carteira e totais por proprietário.', filtros: [], cor: 'peach' },
  { id: 'imoveis', nome: 'Imóveis', descricao: 'Carteira de imóveis, ocupação e contrato atual.', filtros: ['proprietario'], cor: 'mint' },
  { id: 'dre-imovel', nome: 'DRE por imóvel', descricao: 'Aluguéis, taxa, despesas e comissões com o resultado de cada imóvel.', filtros: ['periodo', 'proprietario'], cor: 'sage' },
];

const money = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function hojeBR() {
  const [a, m, d] = hojeISO().split('-');
  return `${d}/${m}/${a}`;
}

function filtroProprietario(propId) {
  return propId ? ` AND i.proprietario_id = ${Number(propId)}` : '';
}

export function construirRelatorio(tipo, { de, ate, competencia, proprietario_id } = {}) {
  if (tipo === 'dre-imovel') {
    return construirRelatorioDre({ de, ate, proprietario_id });
  }
  const propId = proprietario_id ? Number(proprietario_id) : null;
  ate = ate || competencia || competenciaAtual();
  de = de || ate;
  const empresa = getSetting('imob_nome', 'Imobiliária');
  const base = {
    empresa,
    cnpj: getSetting('imob_cnpj', ''),
    gerado_em: hojeBR(),
    filtro_proprietario: propId ? db.prepare('SELECT nome FROM proprietarios WHERE id=?').get(propId)?.nome : null,
  };

  if (tipo === 'resumo-financeiro') {
    const serie = serieMensal(de, ate, propId);
    const tot = serie.reduce((a, m) => {
      for (const k of ['alugueis', 'taxa', 'desp_imob', 'desp_prop', 'repasses', 'resultado_imob', 'inadimplencia']) a[k] = (a[k] || 0) + m[k];
      return a;
    }, {});
    return {
      ...base,
      titulo: 'Resumo financeiro',
      subtitulo: `Período de ${mesesEntre(de, ate)[0]} a ${mesesEntre(de, ate).slice(-1)[0]}`,
      colunas: [
        { key: 'mes', titulo: 'Competência', largura: 10, tipo: 'text' },
        { key: 'alugueis', titulo: 'Aluguéis', largura: 13, tipo: 'money', align: 'right' },
        { key: 'taxa', titulo: 'Taxa admin.', largura: 12, tipo: 'money', align: 'right' },
        { key: 'desp_imob', titulo: 'Despesas imob.', largura: 13, tipo: 'money', align: 'right' },
        { key: 'desp_prop', titulo: 'Despesas prop.', largura: 13, tipo: 'money', align: 'right' },
        { key: 'repasses', titulo: 'Repasses', largura: 12, tipo: 'money', align: 'right' },
        { key: 'resultado_imob', titulo: 'Resultado imob.', largura: 13, tipo: 'money', align: 'right' },
        { key: 'inadimplencia', titulo: 'Inadimplência', largura: 12, tipo: 'money', align: 'right' },
      ],
      linhas: serie.map(m => ({ ...m, mes: m.mes.split('-').reverse().join('/') })),
      resumo: [
        { rotulo: 'Aluguéis administrados', valor: money(tot.alugueis), bruto: tot.alugueis },
        { rotulo: 'Taxa de administração', valor: money(tot.taxa), bruto: tot.taxa },
        { rotulo: 'Repasses realizados', valor: money(tot.repasses), bruto: tot.repasses },
        { rotulo: 'Resultado da imobiliária', valor: money(tot.resultado_imob), bruto: tot.resultado_imob },
      ],
    };
  }

  if (tipo === 'lancamentos') {
    const linhas = db.prepare(`
      SELECT l.*, p.nome AS proprietario_nome, i.endereco AS imovel_endereco
      FROM lancamentos l
      LEFT JOIN proprietarios p ON p.id = l.proprietario_id
      LEFT JOIN imoveis i ON i.id = l.imovel_id
      WHERE l.competencia BETWEEN ? AND ?${propId ? ` AND l.proprietario_id = ${propId}` : ''}
      ORDER BY l.competencia, l.data, l.id
    `).all(de, ate);
    const receitas = linhas.filter(l => l.tipo === 'receita' && l.status === 'ativo').reduce((s, l) => s + l.valor_centavos, 0);
    const despesas = linhas.filter(l => l.tipo === 'despesa' && l.status === 'ativo').reduce((s, l) => s + l.valor_centavos, 0);
    return {
      ...base,
      titulo: 'Lançamentos',
      subtitulo: `Competências de ${de} a ${ate}`,
      colunas: [
        { key: 'data', titulo: 'Data', largura: 9, tipo: 'date' },
        { key: 'competencia', titulo: 'Comp.', largura: 7, tipo: 'text' },
        { key: 'tipo', titulo: 'Tipo', largura: 7, tipo: 'text' },
        { key: 'categoria', titulo: 'Categoria', largura: 13, tipo: 'text' },
        { key: 'descricao', titulo: 'Descrição', largura: 17, tipo: 'text' },
        { key: 'caixa', titulo: 'Caixa', largura: 9, tipo: 'text' },
        { key: 'proprietario_nome', titulo: 'Proprietário', largura: 11, tipo: 'text' },
        { key: 'vinculo', titulo: 'Vínculo', largura: 12, tipo: 'text' },
        { key: 'valor_centavos', titulo: 'Valor (R$)', largura: 10, tipo: 'money', align: 'right' },
        { key: 'status', titulo: 'Status', largura: 8, tipo: 'text' },
        { key: 'criado_por', titulo: 'Criado por', largura: 9, tipo: 'text' },
      ],
      linhas: linhas.map(l => ({
        ...l,
        data: l.data.split('-').reverse().join('/'),
        tipo: l.tipo === 'receita' ? 'Receita' : 'Despesa',
        caixa: l.caixa === 'imobiliaria' ? 'Imobiliária' : 'Proprietários',
        vinculo: l.repasse_id ? `Repasse #${l.repasse_id}` : l.cobranca_id ? `Cobrança #${l.cobranca_id}` : l.estorno_de_id ? `Estorno de #${l.estorno_de_id}` : l.contrato_codigo || '—',
        valor_centavos: l.status === 'estornado' ? 0 : l.valor_centavos,
      })),
      resumo: [
        { rotulo: 'Receitas', valor: money(receitas), bruto: receitas },
        { rotulo: 'Despesas', valor: money(despesas), bruto: despesas },
        { rotulo: 'Resultado', valor: money(receitas - despesas), bruto: receitas - despesas },
        { rotulo: 'Lançamentos', valor: String(linhas.length), bruto: linhas.length },
      ],
    };
  }

  if (tipo === 'repasses') {
    const linhas = db.prepare(`
      SELECT r.*, p.nome AS proprietario_nome
      FROM repasses r JOIN proprietarios p ON p.id = r.proprietario_id
      WHERE r.competencia BETWEEN ? AND ?${propId ? ` AND r.proprietario_id = ${propId}` : ''}
      ORDER BY r.competencia, p.nome
    `).all(de, ate);
    const total = linhas.reduce((s, r) => s + r.valor_centavos, 0);
    const pago = linhas.filter(r => r.status === 'pago').reduce((s, r) => s + r.valor_centavos, 0);
    return {
      ...base,
      titulo: 'Repasses aos proprietários',
      subtitulo: `Competências de ${de} a ${ate}`,
      colunas: [
        { key: 'competencia', titulo: 'Comp.', largura: 7, tipo: 'text' },
        { key: 'proprietario_nome', titulo: 'Proprietário', largura: 17, tipo: 'text' },
        { key: 'aluguel_centavos', titulo: 'Aluguéis', largura: 12, tipo: 'money', align: 'right' },
        { key: 'taxa_pct', titulo: 'Taxa %', largura: 7, tipo: 'pct', align: 'right' },
        { key: 'taxa_centavos', titulo: 'Taxa', largura: 11, tipo: 'money', align: 'right' },
        { key: 'despesas_centavos', titulo: 'Despesas', largura: 11, tipo: 'money', align: 'right' },
        { key: 'descontos_centavos', titulo: 'Descontos', largura: 10, tipo: 'money', align: 'right' },
        { key: 'acrescimos_centavos', titulo: 'Acréscimos', largura: 10, tipo: 'money', align: 'right' },
        { key: 'valor_centavos', titulo: 'Valor repassado', largura: 13, tipo: 'money', align: 'right' },
        { key: 'status', titulo: 'Status', largura: 9, tipo: 'text' },
      ],
      linhas,
      resumo: [
        { rotulo: 'Total calculado', valor: money(total), bruto: total },
        { rotulo: 'Já pago', valor: money(pago), bruto: pago },
        { rotulo: 'Pendente', valor: money(total - pago), bruto: total - pago },
        { rotulo: 'Repasses', valor: String(linhas.length), bruto: linhas.length },
      ],
    };
  }

  if (tipo === 'contratos') {
    const linhas = db.prepare(`
      SELECT c.*, i.endereco, i.numero, i.complemento, i.taxa_admin_pct AS imovel_taxa,
             p.nome AS proprietario_nome, p.taxa_admin_pct AS prop_taxa, p.id AS prop_id,
             q.nome AS inquilino_nome, q.telefone AS inquilino_telefone
      FROM contratos c
      JOIN imoveis i ON i.id = c.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      JOIN inquilinos q ON q.id = c.inquilino_id
      WHERE 1=1${filtrar(propId)}
      ORDER BY c.status='ativo' DESC, p.nome, i.endereco
    `).all();
    const ativos = linhas.filter(c => c.status === 'ativo');
    return {
      ...base,
      titulo: 'Carteira de contratos',
      subtitulo: `${linhas.length} contratos · ${ativos.length} ativos`,
      colunas: [
        { key: 'codigo', titulo: 'Código', largura: 7, tipo: 'text' },
        { key: 'imovel', titulo: 'Imóvel', largura: 20, tipo: 'text' },
        { key: 'proprietario_nome', titulo: 'Proprietário', largura: 13, tipo: 'text' },
        { key: 'inquilino_nome', titulo: 'Inquilino', largura: 13, tipo: 'text' },
        { key: 'inicio', titulo: 'Início', largura: 8, tipo: 'date' },
        { key: 'fim', titulo: 'Fim', largura: 8, tipo: 'date' },
        { key: 'aluguel_centavos', titulo: 'Aluguel', largura: 10, tipo: 'money', align: 'right' },
        { key: 'dia_vencimento', titulo: 'Venc.', largura: 6, tipo: 'int', align: 'right' },
        { key: 'taxa', titulo: 'Taxa %', largura: 6, tipo: 'pct', align: 'right' },
        { key: 'garantia_tipo', titulo: 'Garantia', largura: 9, tipo: 'text' },
        { key: 'status', titulo: 'Status', largura: 8, tipo: 'text' },
      ],
      linhas: linhas.map(c => {
        const t = resolverTaxa({ taxa_admin_pct: c.taxa_admin_pct }, { taxa_admin_pct: c.imovel_taxa }, { taxa_admin_pct: c.prop_taxa });
        return {
          ...c,
          imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`,
          inicio: c.inicio?.split('-').reverse().join('/'),
          fim: c.fim ? c.fim.split('-').reverse().join('/') : '—',
          taxa: t.pct,
        };
      }),
      resumo: [
        { rotulo: 'Contratos ativos', valor: String(ativos.length), bruto: ativos.length },
        { rotulo: 'Aluguel mensal ativo', valor: money(ativos.reduce((s, c) => s + c.aluguel_centavos, 0)), bruto: 0 },
        { rotulo: 'Ticket médio', valor: money(ativos.length ? ativos.reduce((s, c) => s + c.aluguel_centavos, 0) / ativos.length : 0), bruto: 0 },
        { rotulo: 'Total de contratos', valor: String(linhas.length), bruto: linhas.length },
      ],
    };
  }

  if (tipo === 'inadimplencia') {
    const comp = competencia || ate;
    const venc = ultimoDia(comp);
    const hoje = hojeISO();
    const linhas = db.prepare(`
      SELECT c.*, i.endereco, i.numero, i.complemento, i.proprietario_id,
             p.nome AS proprietario_nome, q.nome AS inquilino_nome, q.telefone AS inquilino_telefone,
             (SELECT COALESCE(SUM(l.valor_centavos),0) FROM lancamentos l WHERE l.contrato_id=c.id AND l.competencia=? AND l.tipo='receita' AND l.categoria='Aluguel' AND l.status='ativo') AS pago
      FROM contratos c
      JOIN imoveis i ON i.id = c.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      JOIN inquilinos q ON q.id = c.inquilino_id
      WHERE c.status='ativo' AND c.inicio <= ? AND (c.fim IS NULL OR c.fim >= ?)${filtrar(propId)}
      ORDER BY p.nome, i.endereco
    `).all(comp, venc, `${comp}-01`).map(c => {
      const vencimento = `${comp}-${String(Math.min(c.dia_vencimento || 5, Number(ultimoDia(comp).slice(-2)))).padStart(2, '0')}`;
      const dias = Math.max(Math.round((new Date(hoje) - new Date(vencimento)) / 86400000), 0);
      return {
        ...c,
        vencimento,
        dias,
        saldo_centavos: Math.max((c.aluguel_centavos || 0) - (c.pago || 0), 0),
      };
    }).filter(c => c.dias > 0 && c.saldo_centavos > 0);
    const total = linhas.reduce((s, c) => s + c.saldo_centavos, 0);
    return {
      ...base,
      titulo: 'Inadimplência',
      subtitulo: `Competência ${comp.split('-').reverse().join('/')}`,
      colunas: [
        { key: 'imovel', titulo: 'Imóvel', largura: 24, tipo: 'text' },
        { key: 'proprietario_nome', titulo: 'Proprietário', largura: 14, tipo: 'text' },
        { key: 'inquilino_nome', titulo: 'Inquilino', largura: 16, tipo: 'text' },
        { key: 'telefone', titulo: 'Telefone', largura: 11, tipo: 'text' },
        { key: 'vencimento', titulo: 'Vencimento', largura: 9, tipo: 'date' },
        { key: 'dias', titulo: 'Dias', largura: 6, tipo: 'int', align: 'right' },
        { key: 'aluguel_centavos', titulo: 'Valor', largura: 10, tipo: 'money', align: 'right' },
      ],
      linhas: linhas.map(c => ({
        ...c,
        imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`,
        telefone: c.inquilino_telefone || '—',
        vencimento: c.vencimento.split('-').reverse().join('/'),
        aluguel_centavos: c.saldo_centavos,
        dias: c.dias,
      })),
      resumo: [
        { rotulo: 'Contratos em atraso', valor: String(linhas.length), bruto: linhas.length },
        { rotulo: 'Valor em aberto', valor: money(total), bruto: total },
        { rotulo: 'Competência', valor: comp.split('-').reverse().join('/'), bruto: 0 },
        { rotulo: 'Ticket médio em atraso', valor: money(linhas.length ? total / linhas.length : 0), bruto: 0 },
      ],
    };
  }

  if (tipo === 'proprietarios') {
    const linhas = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM imoveis i WHERE i.proprietario_id=p.id AND i.ativo=1) AS imoveis,
        (SELECT COUNT(*) FROM contratos c JOIN imoveis i ON i.id=c.imovel_id WHERE i.proprietario_id=p.id AND c.status='ativo') AS contratos,
        (SELECT COALESCE(SUM(c.aluguel_centavos),0) FROM contratos c JOIN imoveis i ON i.id=c.imovel_id WHERE i.proprietario_id=p.id AND c.status='ativo') AS aluguel_total
      FROM proprietarios p WHERE 1=1${propId ? ` AND p.id=${propId}` : ''}
      ORDER BY p.nome
    `).all();
    return {
      ...base,
      titulo: 'Proprietários',
      subtitulo: `${linhas.length} cadastros`,
      colunas: [
        { key: 'nome', titulo: 'Nome', largura: 20, tipo: 'text' },
        { key: 'cpf_cnpj', titulo: 'CPF / CNPJ', largura: 13, tipo: 'text' },
        { key: 'telefone', titulo: 'Telefone', largura: 12, tipo: 'text' },
        { key: 'email', titulo: 'E-mail', largura: 18, tipo: 'text' },
        { key: 'imoveis', titulo: 'Imóveis', largura: 7, tipo: 'int', align: 'right' },
        { key: 'contratos', titulo: 'Contratos', largura: 8, tipo: 'int', align: 'right' },
        { key: 'aluguel_total', titulo: 'Aluguel/mês', largura: 11, tipo: 'money', align: 'right' },
        { key: 'taxa_admin_pct', titulo: 'Taxa %', largura: 6, tipo: 'pct', align: 'right' },
      ],
      linhas,
      resumo: [
        { rotulo: 'Proprietários', valor: String(linhas.length), bruto: linhas.length },
        { rotulo: 'Imóveis administrados', valor: String(linhas.reduce((s, p) => s + p.imoveis, 0)), bruto: 0 },
        { rotulo: 'Contratos ativos', valor: String(linhas.reduce((s, p) => s + p.contratos, 0)), bruto: 0 },
        { rotulo: 'Aluguel mensal total', valor: money(linhas.reduce((s, p) => s + p.aluguel_total, 0)), bruto: 0 },
      ],
    };
  }

  if (tipo === 'imoveis') {
    const linhas = db.prepare(`
      SELECT i.*, p.nome AS proprietario_nome,
             c.codigo AS contrato_codigo, c.aluguel_centavos, c.status AS contrato_status,
             q.nome AS inquilino_nome
      FROM imoveis i
      JOIN proprietarios p ON p.id = i.proprietario_id
      LEFT JOIN contratos c ON c.imovel_id = i.id AND c.status='ativo'
      LEFT JOIN inquilinos q ON q.id = c.inquilino_id
      WHERE i.ativo=1${filtrar(propId)}
      ORDER BY p.nome, i.endereco
    `).all();
    return {
      ...base,
      titulo: 'Carteira de imóveis',
      subtitulo: `${linhas.length} imóveis ativos`,
      colunas: [
        { key: 'imovel', titulo: 'Imóvel', largura: 24, tipo: 'text' },
        { key: 'proprietario_nome', titulo: 'Proprietário', largura: 15, tipo: 'text' },
        { key: 'tipo', titulo: 'Tipo', largura: 9, tipo: 'text' },
        { key: 'situacao', titulo: 'Situação', largura: 9, tipo: 'text' },
        { key: 'contrato_codigo', titulo: 'Contrato', largura: 8, tipo: 'text' },
        { key: 'inquilino_nome', titulo: 'Inquilino', largura: 16, tipo: 'text' },
        { key: 'aluguel_centavos', titulo: 'Aluguel', largura: 10, tipo: 'money', align: 'right' },
        { key: 'taxa_admin_pct', titulo: 'Taxa %', largura: 6, tipo: 'pct', align: 'right' },
      ],
      linhas: linhas.map(i => ({
        ...i,
        imovel: `${i.endereco}${i.numero ? ', ' + i.numero : ''}${i.complemento ? ' - ' + i.complemento : ''}`,
        aluguel_centavos: i.aluguel_centavos || 0,
      })),
      resumo: [
        { rotulo: 'Imóveis', valor: String(linhas.length), bruto: linhas.length },
        { rotulo: 'Alugados', valor: String(linhas.filter(i => i.situacao === 'alugado').length), bruto: 0 },
        { rotulo: 'Vagos', valor: String(linhas.filter(i => i.situacao === 'vago').length), bruto: 0 },
        { rotulo: 'Aluguel mensal', valor: money(linhas.reduce((s, i) => s + (i.aluguel_centavos || 0), 0)), bruto: 0 },
      ],
    };
  }

  if (tipo === 'fluxo-caixa') {
    const serie = serieMensal(de, ate, propId);
    const linhas = serie.map(m => ({
      ...m,
      entradas: m.alugueis + m.taxa + m.outras_imob + m.outras_prop,
      saidas: m.desp_imob + m.desp_prop + m.repasses,
      resultado_caixa: (m.alugueis + m.taxa + m.outras_imob + m.outras_prop) - (m.desp_imob + m.desp_prop + m.repasses),
      mes: m.mes.split('-').reverse().join('/'),
    }));
    const tot = linhas.reduce((a, m) => {
      for (const k of ['alugueis', 'taxa', 'outras_imob', 'outras_prop', 'desp_imob', 'desp_prop', 'repasses', 'entradas', 'saidas', 'resultado_caixa']) a[k] = (a[k] || 0) + m[k];
      return a;
    }, {});
    return {
      ...base,
      titulo: 'Fluxo de caixa',
      subtitulo: `Entradas e saídas por competência · ${de} a ${ate}`,
      colunas: [
        { key: 'mes', titulo: 'Competência', largura: 9, tipo: 'text' },
        { key: 'alugueis', titulo: 'Aluguéis', largura: 11, tipo: 'money', align: 'right' },
        { key: 'taxa', titulo: 'Taxa admin.', largura: 10, tipo: 'money', align: 'right' },
        { key: 'outras_imob', titulo: 'Outras rec. imob.', largura: 11, tipo: 'money', align: 'right' },
        { key: 'desp_imob', titulo: 'Despesas imob.', largura: 11, tipo: 'money', align: 'right' },
        { key: 'desp_prop', titulo: 'Despesas prop.', largura: 11, tipo: 'money', align: 'right' },
        { key: 'repasses', titulo: 'Repasses', largura: 11, tipo: 'money', align: 'right' },
        { key: 'entradas', titulo: 'Entradas', largura: 10, tipo: 'money', align: 'right' },
        { key: 'saidas', titulo: 'Saídas', largura: 10, tipo: 'money', align: 'right' },
        { key: 'resultado_caixa', titulo: 'Saldo do mês', largura: 11, tipo: 'money', align: 'right' },
      ],
      linhas,
      resumo: [
        { rotulo: 'Entradas', valor: money(tot.entradas), bruto: tot.entradas },
        { rotulo: 'Saídas', valor: money(tot.saidas), bruto: tot.saidas },
        { rotulo: 'Resultado do caixa', valor: money(tot.resultado_caixa), bruto: tot.resultado_caixa },
        { rotulo: 'Meses', valor: String(linhas.length), bruto: linhas.length },
      ],
    };
  }

  if (tipo === 'cobrancas') {
    const linhas = db.prepare(`
      SELECT c.*, ct.codigo AS contrato_codigo, i.endereco, i.numero, i.complemento,
             p.nome AS proprietario_nome, q.nome AS inquilino_nome, q.telefone AS inquilino_telefone
      FROM cobrancas c
      JOIN contratos ct ON ct.id = c.contrato_id
      JOIN imoveis i ON i.id = ct.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      JOIN inquilinos q ON q.id = ct.inquilino_id
      WHERE c.competencia BETWEEN ? AND ?${propId ? ` AND p.id = ${propId}` : ''}
      ORDER BY c.competencia, p.nome, i.endereco
    `).all(de, ate).map(c => {
      const saldo = Math.max((c.valor_original_centavos || 0) + (c.multa_centavos || 0) + (c.juros_centavos || 0) - (c.desconto_centavos || 0) - (c.valor_pago_centavos || 0), 0);
      return {
        ...c,
        imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}${c.complemento ? ' - ' + c.complemento : ''}`,
        vencimento: c.vencimento?.split('-').reverse().join('/'),
        status_label: c.status === 'pago' ? 'Pago' : c.status === 'cancelado' ? 'Cancelado' : c.status === 'pago_parcial' ? 'Pago parcial' : (c.vencimento && c.vencimento < hojeISO() ? 'Em atraso' : 'Em aberto'),
        saldo_centavos: saldo,
      };
    });
    const total = linhas.reduce((s, c) => s + c.valor_original_centavos, 0);
    const pago = linhas.reduce((s, c) => s + c.valor_pago_centavos, 0);
    const aberto = linhas.reduce((s, c) => s + c.saldo_centavos, 0);
    return {
      ...base,
      titulo: 'Cobranças',
      subtitulo: `Competências de ${de} a ${ate} · ${linhas.length} cobrança(s)`,
      colunas: [
        { key: 'competencia', titulo: 'Comp.', largura: 7, tipo: 'text' },
        { key: 'contrato_codigo', titulo: 'Contrato', largura: 8, tipo: 'text' },
        { key: 'imovel', titulo: 'Imóvel', largura: 15, tipo: 'text' },
        { key: 'inquilino_nome', titulo: 'Inquilino', largura: 13, tipo: 'text' },
        { key: 'vencimento', titulo: 'Vencimento', largura: 8, tipo: 'date' },
        { key: 'valor_original_centavos', titulo: 'Original', largura: 9, tipo: 'money', align: 'right' },
        { key: 'multa_centavos', titulo: 'Multa', largura: 7, tipo: 'money', align: 'right' },
        { key: 'juros_centavos', titulo: 'Juros', largura: 7, tipo: 'money', align: 'right' },
        { key: 'desconto_centavos', titulo: 'Desconto', largura: 8, tipo: 'money', align: 'right' },
        { key: 'valor_pago_centavos', titulo: 'Pago', largura: 8, tipo: 'money', align: 'right' },
        { key: 'saldo_centavos', titulo: 'Saldo', largura: 8, tipo: 'money', align: 'right' },
        { key: 'status_label', titulo: 'Status', largura: 9, tipo: 'text' },
      ],
      linhas,
      resumo: [
        { rotulo: 'Cobranças', valor: String(linhas.length), bruto: linhas.length },
        { rotulo: 'Valor original', valor: money(total), bruto: total },
        { rotulo: 'Recebido', valor: money(pago), bruto: pago },
        { rotulo: 'Saldo em aberto', valor: money(aberto), bruto: aberto },
      ],
    };
  }

  if (tipo === 'comissoes') {
    const linhas = db.prepare(`
      SELECT cm.*, ct.codigo AS contrato_codigo, i.endereco, i.numero, p.nome AS proprietario_nome, q.nome AS inquilino_nome
      FROM comissoes cm
      JOIN contratos ct ON ct.id = cm.contrato_id
      JOIN imoveis i ON i.id = ct.imovel_id
      JOIN proprietarios p ON p.id = i.proprietario_id
      JOIN inquilinos q ON q.id = ct.inquilino_id
      WHERE cm.competencia BETWEEN ? AND ?${propId ? ` AND p.id = ${propId}` : ''}
      ORDER BY cm.competencia, cm.corretor
    `).all(de, ate);
    const total = linhas.reduce((s, c) => s + c.valor_centavos, 0);
    const pagas = linhas.filter(c => c.status === 'paga').reduce((s, c) => s + c.valor_centavos, 0);
    const label = { prevista: 'Prevista', liberada: 'Liberada', paga: 'Paga', cancelada: 'Cancelada' };
    return {
      ...base,
      titulo: 'Comissões de corretagem',
      subtitulo: `Competências de ${de} a ${ate}`,
      colunas: [
        { key: 'competencia', titulo: 'Comp.', largura: 7, tipo: 'text' },
        { key: 'corretor', titulo: 'Corretor', largura: 14, tipo: 'text' },
        { key: 'contrato_codigo', titulo: 'Contrato', largura: 8, tipo: 'text' },
        { key: 'imovel', titulo: 'Imóvel', largura: 17, tipo: 'text' },
        { key: 'inquilino_nome', titulo: 'Inquilino', largura: 13, tipo: 'text' },
        { key: 'base_centavos', titulo: 'Base', largura: 10, tipo: 'money', align: 'right' },
        { key: 'pct', titulo: '%', largura: 6, tipo: 'pct', align: 'right' },
        { key: 'valor_centavos', titulo: 'Comissão', largura: 10, tipo: 'money', align: 'right' },
        { key: 'status_label', titulo: 'Status', largura: 8, tipo: 'text' },
      ],
      linhas: linhas.map(c => ({
        ...c,
        imovel: `${c.endereco}${c.numero ? ', ' + c.numero : ''}`,
        status_label: label[c.status] || c.status,
      })),
      resumo: [
        { rotulo: 'Comissões', valor: String(linhas.length), bruto: linhas.length },
        { rotulo: 'Total', valor: money(total), bruto: total },
        { rotulo: 'Pagas', valor: money(pagas), bruto: pagas },
        { rotulo: 'Pendentes', valor: money(total - pagas), bruto: total - pagas },
      ],
    };
  }

  if (tipo === 'contas') {
    const linhas = db.prepare(`
      SELECT c.*, p.nome AS proprietario_nome, i.endereco AS imovel_endereco
      FROM contas c
      LEFT JOIN proprietarios p ON p.id = c.proprietario_id
      LEFT JOIN imoveis i ON i.id = c.imovel_id
      WHERE c.competencia BETWEEN ? AND ?${propId ? ` AND c.proprietario_id = ${propId}` : ''}
      ORDER BY c.vencimento, c.id
    `).all(de, ate);
    const aPagar = linhas.filter(c => c.tipo === 'pagar' && c.status === 'aberta').reduce((s, c) => s + c.valor_centavos, 0);
    const aReceber = linhas.filter(c => c.tipo === 'receber' && c.status === 'aberta').reduce((s, c) => s + c.valor_centavos, 0);
    const baixadas = linhas.filter(c => c.status === 'paga').reduce((s, c) => s + (c.pago_centavos || c.valor_centavos), 0);
    const hoje = hojeISO();
    return {
      ...base,
      titulo: 'Contas a pagar e a receber',
      subtitulo: `Competências de ${de} a ${ate}`,
      colunas: [
        { key: 'vencimento', titulo: 'Vencimento', largura: 9, tipo: 'date' },
        { key: 'tipo', titulo: 'Tipo', largura: 7, tipo: 'text' },
        { key: 'descricao', titulo: 'Descrição', largura: 18, tipo: 'text' },
        { key: 'categoria', titulo: 'Categoria', largura: 11, tipo: 'text' },
        { key: 'fornecedor', titulo: 'Fornecedor', largura: 12, tipo: 'text' },
        { key: 'valor_centavos', titulo: 'Valor', largura: 10, tipo: 'money', align: 'right' },
        { key: 'pago_centavos', titulo: 'Baixado', largura: 10, tipo: 'money', align: 'right' },
        { key: 'status_label', titulo: 'Status', largura: 9, tipo: 'text' },
        { key: 'atraso', titulo: 'Atraso (dias)', largura: 8, tipo: 'int', align: 'right' },
      ],
      linhas: linhas.map(c => ({
        ...c,
        vencimento: c.vencimento?.split('-').reverse().join('/'),
        tipo: c.tipo === 'pagar' ? 'A pagar' : 'A receber',
        status_label: c.status === 'aberta' ? (c.vencimento < hoje ? 'Vencida' : 'Em aberto') : c.status === 'paga' ? 'Baixada' : 'Cancelada',
        atraso: c.status === 'aberta' && c.vencimento < hoje ? Math.round((new Date(hoje) - new Date(c.vencimento)) / 86400000) : 0,
      })),
      resumo: [
        { rotulo: 'A pagar (aberto)', valor: money(aPagar), bruto: aPagar },
        { rotulo: 'A receber (aberto)', valor: money(aReceber), bruto: aReceber },
        { rotulo: 'Baixado no período', valor: money(baixadas), bruto: baixadas },
        { rotulo: 'Contas', valor: String(linhas.length), bruto: linhas.length },
      ],
    };
  }

  throw Object.assign(new Error('Relatório desconhecido.'), { status: 404 });
}

function filtrar(propId) {
  const id = Number(propId);
  return Number.isFinite(id) && id > 0 ? ` AND i.proprietario_id = ${id}` : '';
}

/* ---------------- CSV ---------------- */

function celulaCSV(v, proteger = true) {
  const s = v == null ? '' : String(v);
  // Mitiga injeção de fórmula em planilhas (CSV injection): uma célula de texto
  // que comece com =, +, @, tab ou CR não pode ser interpretada pelo Excel.
  // Números negativos legítimos (ex.: -1.234,56) continuam numéricos.
  const numeroNegativo = /^-\d[\d.,]*$/.test(s);
  const formula = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !numeroNegativo);
  const seguro = proteger && formula ? "'" + s : s;
  return /[";\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function gerarCSV(rel) {
  const linhas = [];
  linhas.push([`${rel.empresa} — ${rel.titulo}`]);
  if (rel.subtitulo) linhas.push([rel.subtitulo]);
  if (rel.filtro_proprietario) linhas.push([`Proprietário: ${rel.filtro_proprietario}`]);
  linhas.push([`Gerado em ${rel.gerado_em}`]);
  linhas.push([]);
  linhas.push(rel.colunas.map(c => c.titulo));
  for (const l of rel.linhas) {
    linhas.push(rel.colunas.map(c => {
      const v = l[c.key];
      if (c.tipo === 'money') return money(v);
      if (c.tipo === 'pct') return v == null ? '—' : num(v, 2);
      if (c.tipo === 'date') return v || '—';
      return v == null ? '' : String(v);
    }));
  }
  linhas.push([]);
  linhas.push(['Resumo']);
  for (const r of rel.resumo) linhas.push([r.rotulo, r.valor]);
  // A proteção e o escape acontecem uma única vez, no final. Antes, texto com
  // ponto e vírgula era escapado duas vezes ("a;b" virava """a;b""").
  return '\uFEFF' + linhas.map(l => l.map(c => celulaCSV(c)).join(';')).join('\r\n');
}

/* ---------------- XLSX ---------------- */

export function gerarXLSX(rel) {
  const wb = XLSX.utils.book_new();
  const aoa = [
    [rel.empresa],
    [rel.titulo],
    [rel.subtitulo || ''],
    [rel.filtro_proprietario ? `Proprietário: ${rel.filtro_proprietario}` : ''],
    [`Gerado em ${rel.gerado_em}`],
    [],
    rel.colunas.map(c => c.titulo),
  ];
  for (const l of rel.linhas) {
    aoa.push(rel.colunas.map(c => {
      const v = l[c.key];
      if (c.tipo === 'money') return Number(v || 0) / 100;
      if (c.tipo === 'pct') return v == null ? '—' : Number(v);
      if (c.tipo === 'int') return Number(v || 0);
      return v == null ? '' : v;
    }));
  }
  // Linha de totais: somente colunas monetárias somam. Facilita a conferência
  // no Excel sem depender de tabela dinâmica.
  if (rel.linhas.length) {
    const totais = rel.colunas.map((c, i) => {
      if (i === 0) return 'TOTAL';
      if (c.tipo === 'money') {
        const soma = rel.linhas.reduce((s, l) => s + Number(l[c.key] || 0), 0);
        return soma / 100;
      }
      return '';
    });
    aoa.push([]);
    aoa.push(totais);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = rel.colunas.map(c => ({ wch: Math.max(10, Math.round((c.largura || 10) * 1.12)) }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  const linhaCabecalho = 6; // zero-based: a sétima linha do arquivo
  const ultimaLinhaDados = 6 + rel.linhas.length;
  if (rel.linhas.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: linhaCabecalho, c: 0 }, e: { r: ultimaLinhaDados, c: rel.colunas.length - 1 } }),
    };
  }
  for (let R = linhaCabecalho; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      const col = rel.colunas[C];
      if (col?.tipo === 'money') cell.z = 'R$ #,##0.00';
      if (col?.tipo === 'pct') cell.z = '0.00';
      if (R === ultimaLinhaDados + 2) cell.z = col?.tipo === 'money' ? 'R$ #,##0.00' : cell.z;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');

  // Resumo com valor numérico separado do texto formatado, para o Excel poder
  // somar/ordenar sem perder a apresentação em reais.
  const resumoAoa = [
    [rel.titulo],
    ['Resumo'],
    rel.subtitulo ? [rel.subtitulo] : [],
    [],
    ['Indicador', 'Valor formatado', 'Valor numérico'],
    ...rel.resumo.map(r => [r.rotulo, r.valor, typeof r.bruto === 'number' ? r.bruto / 100 : '']),
    [],
    ['Gerado em', rel.gerado_em],
    ['Fonte', 'Sistema de Gestão Imobiliária'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(resumoAoa);
  ws2['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 18 }];
  const rr = XLSX.utils.decode_range(ws2['!ref']);
  for (let R = 5; R <= rr.e.r; R++) {
    const cell = ws2[XLSX.utils.encode_cell({ r: R, c: 2 })];
    if (cell && typeof cell.v === 'number') cell.z = 'R$ #,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumo');

  const params = [
    ['Parâmetros do relatório'],
    [],
    ['Empresa', rel.empresa],
    ['CNPJ', rel.cnpj || '—'],
    ['Relatório', rel.titulo],
    ['Período / recorte', rel.subtitulo || '—'],
    ['Proprietário', rel.filtro_proprietario || 'Todos'],
    ['Colunas', String(rel.colunas.length)],
    ['Registros', String(rel.linhas.length)],
    ['Gerado em', rel.gerado_em],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(params);
  ws3['!cols'] = [{ wch: 22 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Parâmetros');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* ---------------- PDF ---------------- */

const COR = {
  ink: '#2C3634',
  soft: '#5E6B67',
  sage: '#5C8571',
  sageClaro: '#E7F0EA',
  creme: '#FAF7F2',
  linha: '#ECE6DE',
  branco: '#FFFFFF',
  blush: '#B8747A',
};

function valorTexto(col, v) {
  if (col.tipo === 'money') return money(v);
  if (col.tipo === 'pct') return v == null ? '—' : num(v, 2);
  if (col.tipo === 'int') return String(v ?? '');
  if (col.tipo === 'date') return v || '—';
  return v == null || v === '' ? '—' : String(v);
}

export function gerarPDF(rel) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;
      const M = 36;
      const larguraUtil = W - M * 2;

      const desenharCabecalho = () => {
        doc.rect(0, 0, W, 92).fill(COR.sage);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(rel.empresa, M, 26, { width: larguraUtil * 0.55 });
        doc.font('Helvetica').fontSize(9).fillColor('#DCEAE2')
          .text(`${rel.cnpj ? 'CNPJ ' + rel.cnpj + '  ·  ' : ''}Gerado em ${rel.gerado_em}`, M, 50, { width: larguraUtil * 0.55 });
        doc.font('Helvetica-Bold').fontSize(15).fillColor('#FFFFFF')
          .text(rel.titulo, W - M - 320, 26, { width: 320, align: 'right' });
        doc.font('Helvetica').fontSize(9).fillColor('#DCEAE2')
          .text(rel.subtitulo || '', W - M - 320, 48, { width: 320, align: 'right' });
        if (rel.filtro_proprietario) {
          doc.text(`Proprietário: ${rel.filtro_proprietario}`, W - M - 320, 62, { width: 320, align: 'right' });
        }
      };

      const desenharResumo = (y) => {
        const boxes = rel.resumo.slice(0, 4);
        const gap = 10;
        const bw = (larguraUtil - gap * (boxes.length - 1)) / boxes.length;
        boxes.forEach((b, i) => {
          const x = M + i * (bw + gap);
          doc.roundedRect(x, y, bw, 54, 8).fill(COR.sageClaro);
          doc.fillColor(COR.soft).font('Helvetica').fontSize(8).text(b.rotulo.toUpperCase(), x + 12, y + 10, { width: bw - 24 });
          doc.fillColor(COR.ink).font('Helvetica-Bold').fontSize(14).text(b.valor, x + 12, y + 26, { width: bw - 24 });
        });
        return y + 54 + 18;
      };

      const colWidths = () => {
        const total = rel.colunas.reduce((s, c) => s + (c.largura || 10), 0);
        return rel.colunas.map(c => ((c.largura || 10) / total) * larguraUtil);
      };
      const widths = colWidths();

      const desenharCabecalhoTabela = (y) => {
        doc.rect(M, y, larguraUtil, 22).fill(COR.sage);
        let x = M;
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
        rel.colunas.forEach((c, i) => {
          doc.text(c.titulo, x + 5, y + 7, { width: widths[i] - 10, align: c.align === 'right' ? 'right' : 'left' });
          x += widths[i];
        });
        return y + 22;
      };

      desenharCabecalho();
      let y = desenharResumo(112);
      y = desenharCabecalhoTabela(y);
      let zebra = false;
      const alturaLinha = 20;

      for (const l of rel.linhas) {
        if (y + alturaLinha > H - 45) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: M });
          y = M;
          y = desenharCabecalhoTabela(y);
          zebra = false;
        }
        if (zebra) doc.rect(M, y, larguraUtil, alturaLinha).fill(COR.creme);
        zebra = !zebra;
        let x = M;
        doc.fillColor(COR.ink).font('Helvetica').fontSize(7.5);
        rel.colunas.forEach((c, i) => {
          const txt = valorTexto(c, l[c.key]);
          doc.text(txt, x + 5, y + 6.5, {
            width: widths[i] - 10,
            align: c.align === 'right' ? 'right' : 'left',
            ellipsis: true,
            lineBreak: false,
          });
          x += widths[i];
        });
        doc.moveTo(M, y + alturaLinha).lineTo(M + larguraUtil, y + alturaLinha).strokeColor(COR.linha).lineWidth(0.5).stroke();
        y += alturaLinha;
      }

      if (!rel.linhas.length) {
        doc.fillColor(COR.soft).font('Helvetica').fontSize(10).text('Nenhum registro no período selecionado.', M, y + 20, { width: larguraUtil, align: 'center' });
      }

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.fillColor(COR.soft).font('Helvetica').fontSize(7.5)
          .text(`${rel.empresa} · ${rel.titulo}`, M, H - 24, { width: larguraUtil - 80, align: 'left' });
        doc.text(`Página ${i + 1} de ${range.count}`, W - M - 80, H - 24, { width: 80, align: 'right' });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
