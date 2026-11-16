import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { db } from './db.js';
import { hojeISO, exigirMesAberto } from './regras.js';
import { pagar as pagarCobranca, calcularEncargos } from './cobrancas.js';
import { pagarRepasse } from './regras.js';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function parseData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += 2000;
    return `${ano}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

function parseValor(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).replace(/[R$\s]/gi, '');
  if (!s) return null;
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) s = s.replace(/\./g, '').replace(',', '.');
  else if (temVirgula) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function parseOFX(texto) {
  const blocos = String(texto).match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const ler = (bloco, tag) => {
    const m = bloco.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
    return m ? m[1].trim() : '';
  };
  const out = [];
  for (const b of blocos) {
    const dt = ler(b, 'DTPOSTED').replace(/\D/g, '').slice(0, 8);
    const data = dt.length === 8 ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : null;
    const valor = parseValor(ler(b, 'TRNAMT'));
    if (!data || valor == null) continue;
    out.push({
      data,
      valor_centavos: valor,
      descricao: (ler(b, 'MEMO') || ler(b, 'NAME') || 'Lançamento bancário').slice(0, 200),
      fitid: ler(b, 'FITID') || null,
      origem: 'ofx',
    });
  }
  return out;
}

export function parseCSV(base64, mapeamento = null) {
  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (limpo.length > 16 * 1024 * 1024) throw Object.assign(new Error('Arquivo acima do limite.'), { status: 400 });
  const buf = Buffer.from(limpo, 'base64');
  if (!buf.length) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
  let wb;
  try {
    const ehZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const ehXls = buf[0] === 0xd0 && buf[1] === 0xcf;
    if (ehZip || ehXls) wb = XLSX.read(buf, { type: 'buffer', cellDates: true, sheetRows: 5001 });
    else {
      const texto = buf.toString('utf8').replace(/^\uFEFF/, '');
      const primeira = texto.split(/\r?\n/)[0] || '';
      const fs = primeira.includes(';') && !primeira.includes(',') ? ';' : ',';
      wb = XLSX.read(texto, { type: 'string', FS: fs, raw: true, sheetRows: 5001 });
    }
  } catch {
    throw Object.assign(new Error('Não foi possível ler o arquivo. Use OFX, CSV ou Excel.'), { status: 400 });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    .filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (rows.length < 2) throw Object.assign(new Error('O arquivo precisa ter cabeçalho e dados.'), { status: 400 });
  if (rows.length > 5000) throw Object.assign(new Error('Mais de 5.000 linhas. Divida o arquivo.'), { status: 400 });
  const header = rows[0].map(h => String(h ?? '').trim());

  if (!mapeamento) {
    const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const achar = (termos) => header.findIndex(h => termos.some(t => norm(h).includes(t)));
    return {
      precisa_mapeamento: true,
      colunas: header,
      sugestao: {
        data: achar(['data', 'date', 'dt']),
        valor: achar(['valor', 'amount', 'credito', 'debito']),
        descricao: achar(['descri', 'histor', 'memo', 'lancamento']),
      },
      amostra: rows.slice(1, 4),
    };
  }

  const idx = (v) => Number(v);
  const iData = idx(mapeamento.data);
  const iValor = idx(mapeamento.valor);
  const iDesc = idx(mapeamento.descricao);
  if (iData < 0 || iValor < 0) throw Object.assign(new Error('Mapeie as colunas de data e valor.'), { status: 400 });
  const out = [];
  for (const r of rows.slice(1)) {
    const data = parseData(r[iData]);
    const valor = parseValor(r[iValor]);
    if (!data || valor == null) continue;
    out.push({
      data,
      valor_centavos: valor,
      descricao: String(iDesc >= 0 ? r[iDesc] : 'Lançamento bancário').slice(0, 200),
      fitid: null,
      origem: 'csv',
    });
  }
  return { transacoes: out, colunas: header };
}

function hashTx(t) {
  return crypto.createHash('sha1').update(`${t.data}|${t.valor_centavos}|${t.descricao}`).digest('hex');
}

function candidato(t) {
  const abs = Math.abs(t.valor_centavos);
  if (t.valor_centavos > 0) {
    const cobrancas = db.prepare(`
      SELECT c.*, ct.codigo, i.endereco, i.numero, q.nome AS inquilino
      FROM cobrancas c JOIN contratos ct ON ct.id=c.contrato_id
      JOIN imoveis i ON i.id=ct.imovel_id JOIN inquilinos q ON q.id=ct.inquilino_id
      WHERE c.status IN ('em_aberto','pago_parcial')
    `).all();
    let melhor = null;
    for (const c of cobrancas) {
      const enc = calcularEncargos(c, t.data);
      const saldo = Math.max(
        (c.valor_original_centavos || 0) + (c.multa_centavos || enc.multa) + (c.juros_centavos || enc.juros)
          - (c.desconto_centavos || 0) - (c.valor_pago_centavos || 0),
        0
      );
      if (saldo <= 0) continue;
      const diffPct = Math.abs(saldo - abs) / Math.max(abs, 1) * 100;
      const dias = Math.abs(Math.round((new Date(t.data) - new Date(c.vencimento)) / 86400000));
      if (diffPct <= 5 && dias <= 20) {
        const score = Math.round(Math.max(0, 100 - diffPct * 4 - dias));
        if (!melhor || score > melhor.score) {
          melhor = {
            tipo: 'cobranca', id: c.id, score,
            label: `Cobrança ${c.codigo || '#' + c.id} · ${c.inquilino} · ${brl(saldo)} · venc. ${c.vencimento.split('-').reverse().join('/')}`,
          };
        }
      }
    }
    if (melhor) return melhor;
  } else {
    const repasses = db.prepare(`
      SELECT r.*, p.nome FROM repasses r JOIN proprietarios p ON p.id=r.proprietario_id
      WHERE r.status='calculado' AND r.valor_centavos = ?
    `).all(abs);
    if (repasses.length === 1) {
      return {
        tipo: 'repasse', id: repasses[0].id, score: 95,
        label: `Repasse ${repasses[0].competencia} · ${repasses[0].nome} · ${brl(repasses[0].valor_centavos)}`,
      };
    }
  }
  const lanc = db.prepare(`
    SELECT l.*, p.nome AS proprietario_nome FROM lancamentos l
    LEFT JOIN proprietarios p ON p.id=l.proprietario_id
    WHERE l.status='ativo' AND l.valor_centavos = ? AND l.data BETWEEN date(?, '-3 day') AND date(?, '+3 day')
    LIMIT 1
  `).get(abs, t.data, t.data);
  if (lanc) {
    return {
      tipo: 'lancamento', id: lanc.id, score: 70,
      label: `Já lançado: ${lanc.categoria} · ${lanc.descricao || ''} · ${brl(lanc.valor_centavos)}`,
    };
  }
  return null;
}

export function previewConciliacao({ arquivo_base64, nome, mapeamento }) {
  const texto = Buffer.from(String(arquivo_base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf8');
  let transacoes;
  if (/OFXHEADER|<STMTTRN/i.test(texto)) {
    transacoes = parseOFX(texto);
  } else {
    const csv = parseCSV(arquivo_base64, mapeamento);
    if (csv.precisa_mapeamento) return csv;
    transacoes = csv.transacoes;
  }
  if (!transacoes.length) throw Object.assign(new Error('Nenhuma transação reconhecida no arquivo.'), { status: 400 });
  let importadas = 0;
  let duplicadas = 0;
  for (const t of transacoes) {
    const fitid = t.fitid || hashTx(t);
    const existe = db.prepare('SELECT id FROM conciliacoes WHERE fitid = ?').get(fitid);
    if (existe) { duplicadas++; continue; }
    const sug = candidato(t);
    db.prepare(`INSERT INTO conciliacoes (origem, fitid, data, valor_centavos, descricao, status,
        sugestao_tipo, sugestao_id, sugestao_label, confianca, criado_por)
      VALUES (?,?,?,?,?,'pendente',?,?,?,?,?)`)
      .run(t.origem, fitid, t.data, t.valor_centavos, t.descricao, sug?.tipo || null, sug?.id || null,
        sug?.label || null, sug?.score || null, null);
    importadas++;
  }
  return { importadas, duplicadas, total: transacoes.length };
}

export function listarPendentes(status = 'pendente') {
  return db.prepare(`SELECT * FROM conciliacoes WHERE status = ? ORDER BY data DESC, id DESC LIMIT 500`).all(status);
}

export function resumoConciliacao() {
  const row = db.prepare(`SELECT
    SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) AS pendentes,
    SUM(CASE WHEN status='conciliado' THEN 1 ELSE 0 END) AS conciliados,
    SUM(CASE WHEN status='ignorado' THEN 1 ELSE 0 END) AS ignorados,
    COALESCE(SUM(CASE WHEN status='pendente' AND valor_centavos > 0 THEN valor_centavos ELSE 0 END),0) AS entradas,
    COALESCE(SUM(CASE WHEN status='pendente' AND valor_centavos < 0 THEN -valor_centavos ELSE 0 END),0) AS saidas
    FROM conciliacoes`).get();
  return row;
}

export function confirmarConciliacao(id, { acao, cobranca_id, repasse_id, lancamento } = {}, usuario) {
  const c = db.prepare('SELECT * FROM conciliacoes WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('Transação não encontrada.'), { status: 404 });
  if (c.status !== 'pendente') throw Object.assign(new Error('Transação já tratada.'), { status: 409 });

  if (acao === 'ignorar') {
    db.prepare("UPDATE conciliacoes SET status='ignorado', motivo=? WHERE id=?").run(lancamento?.motivo || 'Ignorado pelo usuário', c.id);
    return { ok: true, status: 'ignorado' };
  }

  if (acao === 'cobranca') {
    const alvo = Number(cobranca_id || c.sugestao_id);
    const r = pagarCobranca(alvo, {
      valor: Math.abs(c.valor_centavos), data: c.data, forma: 'conciliacao',
      observacao: `Conciliação bancária: ${c.descricao || ''}`,
    }, usuario);
    db.prepare("UPDATE conciliacoes SET status='conciliado', cobranca_id=? WHERE id=?").run(alvo, c.id);
    return { ok: true, ...r, status: 'conciliado' };
  }

  if (acao === 'repasse') {
    const alvo = Number(repasse_id || c.sugestao_id);
    const r = pagarRepasse(alvo, usuario?.nome || 'conciliação');
    db.prepare("UPDATE conciliacoes SET status='conciliado' WHERE id=?").run(c.id);
    return { ok: true, status: 'conciliado', repasse_id: alvo };
  }

  if (acao === 'vincular-lancamento' && (c.sugestao_id || lancamento?.lancamento_id)) {
    const alvo = Number(lancamento?.lancamento_id || c.sugestao_id);
    if (!db.prepare('SELECT id FROM lancamentos WHERE id = ?').get(alvo)) {
      throw Object.assign(new Error('Lançamento não encontrado.'), { status: 404 });
    }
    db.prepare("UPDATE conciliacoes SET status='conciliado', lancamento_id=? WHERE id=?").run(alvo, c.id);
    return { ok: true, status: 'conciliado' };
  }

  if (acao === 'lancamento') {
    const valor = Math.abs(c.valor_centavos);
    const tipo = lancamento?.tipo || (c.valor_centavos > 0 ? 'receita' : 'despesa');
    const competencia = lancamento?.competencia || c.data.slice(0, 7);
    exigirMesAberto(competencia);
    if (!['receita', 'despesa'].includes(tipo)) throw Object.assign(new Error('Tipo inválido.'), { status: 400 });
    const caixa = lancamento?.caixa || (tipo === 'receita' ? 'proprietarios' : 'imobiliaria');
    if (!['imobiliaria', 'proprietarios'].includes(caixa)) throw Object.assign(new Error('Caixa inválido.'), { status: 400 });
    const categoria = lancamento?.categoria || (tipo === 'receita' ? 'Aluguel' : 'Outros');
    for (const [campo, tabela] of [['proprietario_id', 'proprietarios'], ['imovel_id', 'imoveis'], ['contrato_id', 'contratos']]) {
      const valorRef = lancamento?.[campo];
      if (valorRef !== '' && valorRef != null && !db.prepare(`SELECT id FROM ${tabela} WHERE id = ?`).get(Number(valorRef))) {
        throw Object.assign(new Error(`Registro vinculado não encontrado: ${campo}.`), { status: 400 });
      }
    }
    const r = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa,
        proprietario_id, imovel_id, contrato_id, criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.data, competencia, tipo, categoria, lancamento?.descricao || c.descricao || 'Conciliação bancária',
        valor, caixa, lancamento?.proprietario_id || null, lancamento?.imovel_id || null,
        lancamento?.contrato_id || null, usuario?.nome || null);
    db.prepare("UPDATE conciliacoes SET status='conciliado', lancamento_id=? WHERE id=?").run(Number(r.lastInsertRowid), c.id);
    return { ok: true, status: 'conciliado', lancamento_id: Number(r.lastInsertRowid) };
  }

  throw Object.assign(new Error('Ação inválida.'), { status: 400 });
}
