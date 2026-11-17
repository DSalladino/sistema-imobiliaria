import * as XLSX from 'xlsx';
import { db } from './db.js';
import { inserirAuditoria } from './auditoria.js';

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

function parseValor(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).replace(/[R$\s]/gi, '');
  if (!s) return null;
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) s = s.replace(/\./g, '').replace(',', '.');
  else if (temVirgula) s = s.replace(',', '.');
  else if (temPonto) {
    const partes = s.split('.');
    if (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3) s = partes.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseNumero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[%\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += 2000;
    return `${ano}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

function parseSituacao(v) {
  const n = norm(v);
  if (!n) return 'alugado';
  if (n.startsWith('alug')) return 'alugado';
  if (n.startsWith('vag')) return 'vago';
  if (n.startsWith('manut')) return 'manutencao';
  if (n.startsWith('reserv')) return 'reservado';
  return 'alugado';
}

function parseTipo(v) {
  const n = norm(v);
  if (!n) return 'apartamento';
  if (n.includes('apart')) return 'apartamento';
  if (n.includes('casa')) return 'casa';
  if (n.includes('comerc') || n.includes('sala') || n.includes('loja')) return 'comercial';
  if (n.includes('terren') || n.includes('lote')) return 'terreno';
  return 'outro';
}

function parseGarantia(v) {
  const n = norm(v);
  if (!n || n === 'nenhuma' || n === 'sem') return 'nenhuma';
  if (n.includes('cauc')) return 'caucao';
  if (n.includes('fiad')) return 'fiador';
  if (n.includes('seguro')) return 'seguro';
  if (n.includes('titulo') || n.includes('capital')) return 'titulo';
  return 'nenhuma';
}

export const MODELOS = {
  proprietarios: {
    nome: 'Proprietários',
    descricao: 'Cadastre vários proprietários de uma vez. O nome é obrigatório; CPF/CNPJ evita duplicidade.',
    colunas: [
      { chave: 'nome', titulo: 'Nome', req: true, exemplo: 'Maria Souza', aliases: ['nome completo', 'proprietario'] },
      { chave: 'cpf_cnpj', titulo: 'CPF/CNPJ', exemplo: '123.456.789-00', aliases: ['cpf', 'cnpj', 'documento'] },
      { chave: 'email', titulo: 'E-mail', exemplo: 'maria@exemplo.com', aliases: ['email'] },
      { chave: 'telefone', titulo: 'Telefone', exemplo: '(11) 98888-1111', aliases: ['celular', 'fone', 'whatsapp'] },
      { chave: 'endereco', titulo: 'Endereço', exemplo: 'Rua das Acácias, 45', aliases: ['endereco completo'] },
      { chave: 'banco', titulo: 'Banco', exemplo: 'Banco do Brasil' },
      { chave: 'agencia', titulo: 'Agência', exemplo: '1234-5' },
      { chave: 'conta', titulo: 'Conta', exemplo: '67890-1' },
      { chave: 'tipo_conta', titulo: 'Tipo de conta', exemplo: 'corrente', aliases: ['tipo conta'] },
      { chave: 'pix', titulo: 'Pix', exemplo: 'maria@exemplo.com', aliases: ['chave pix'] },
      { chave: 'taxa_admin_pct', titulo: 'Taxa (%)', exemplo: '6', aliases: ['taxa', 'taxa administracao', 'percentual'] },
      { chave: 'observacoes', titulo: 'Observações', exemplo: 'Contrato antigo', aliases: ['obs', 'observacao'] },
    ],
  },
  imoveis: {
    nome: 'Imóveis',
    descricao: 'O proprietário precisa existir. Se o imóvel já existir (mesmo proprietário e endereço), ele pode ser atualizado.',
    colunas: [
      { chave: 'proprietario', titulo: 'Proprietário', req: true, exemplo: 'Maria Souza', aliases: ['nome proprietario'] },
      { chave: 'endereco', titulo: 'Endereço', req: true, exemplo: 'Rua das Flores', aliases: ['rua', 'logradouro'] },
      { chave: 'numero', titulo: 'Número', exemplo: '120', aliases: ['numero'] },
      { chave: 'complemento', titulo: 'Complemento', exemplo: 'Apto 302' },
      { chave: 'bairro', titulo: 'Bairro', exemplo: 'Centro' },
      { chave: 'cidade', titulo: 'Cidade', exemplo: 'São Paulo' },
      { chave: 'uf', titulo: 'UF', exemplo: 'SP', aliases: ['estado'] },
      { chave: 'cep', titulo: 'CEP', exemplo: '01000-000' },
      { chave: 'tipo', titulo: 'Tipo', exemplo: 'apartamento', aliases: ['tipo imovel'] },
      { chave: 'situacao', titulo: 'Situação', exemplo: 'alugado', aliases: ['status'] },
      { chave: 'taxa_admin_pct', titulo: 'Taxa (%)', exemplo: '8', aliases: ['taxa', 'taxa administracao'] },
      { chave: 'observacoes', titulo: 'Observações', exemplo: '', aliases: ['obs', 'observacao'] },
    ],
  },
  inquilinos: {
    nome: 'Inquilinos',
    descricao: 'O nome é obrigatório. CPF/CNPJ evita duplicidade.',
    colunas: [
      { chave: 'nome', titulo: 'Nome', req: true, exemplo: 'Carlos Mendes', aliases: ['nome completo', 'inquilino'] },
      { chave: 'cpf_cnpj', titulo: 'CPF/CNPJ', exemplo: '222.333.444-55', aliases: ['cpf', 'cnpj', 'documento'] },
      { chave: 'email', titulo: 'E-mail', exemplo: 'carlos@exemplo.com' },
      { chave: 'telefone', titulo: 'Telefone', exemplo: '(11) 95555-4444', aliases: ['celular', 'fone', 'whatsapp'] },
      { chave: 'observacoes', titulo: 'Observações', exemplo: '', aliases: ['obs'] },
    ],
  },
  contratos: {
    nome: 'Contratos',
    descricao: 'Proprietário e imóvel precisam existir. O inquilino pode ser criado automaticamente.',
    colunas: [
      { chave: 'codigo', titulo: 'Código', exemplo: 'CT-010', aliases: ['codigo contrato', 'contrato'] },
      { chave: 'proprietario', titulo: 'Proprietário', req: true, exemplo: 'Maria Souza' },
      { chave: 'imovel', titulo: 'Imóvel', req: true, exemplo: 'Rua das Flores', aliases: ['endereco', 'endereco imovel'] },
      { chave: 'numero', titulo: 'Número', exemplo: '120', aliases: ['numero imovel'] },
      { chave: 'inquilino', titulo: 'Inquilino', req: true, exemplo: 'Carlos Mendes' },
      { chave: 'inquilino_cpf', titulo: 'Inquilino CPF/CNPJ', exemplo: '222.333.444-55' },
      { chave: 'inquilino_telefone', titulo: 'Inquilino Telefone', exemplo: '(11) 95555-4444' },
      { chave: 'inquilino_email', titulo: 'Inquilino E-mail', exemplo: 'carlos@exemplo.com' },
      { chave: 'inicio', titulo: 'Início', req: true, exemplo: '01/03/2024', aliases: ['data inicio'] },
      { chave: 'fim', titulo: 'Fim', exemplo: '01/03/2027', aliases: ['data fim', 'termino'] },
      { chave: 'aluguel_centavos', titulo: 'Aluguel (R$)', exemplo: '1800,00', aliases: ['aluguel', 'valor aluguel'] },
      { chave: 'dia_vencimento', titulo: 'Vencimento', exemplo: '5', aliases: ['dia vencimento'] },
      { chave: 'indice_reajuste', titulo: 'Índice', exemplo: 'IGP-M', aliases: ['indice reajuste'] },
      { chave: 'ultimo_reajuste', titulo: 'Último reajuste', exemplo: '', aliases: ['data reajuste'] },
      { chave: 'garantia_tipo', titulo: 'Garantia', exemplo: 'fiador', aliases: ['tipo garantia'] },
      { chave: 'garantia_valor_centavos', titulo: 'Valor garantia (R$)', exemplo: '0', aliases: ['valor garantia'] },
      { chave: 'garantia_fim', titulo: 'Fim garantia', exemplo: '', aliases: ['termino garantia'] },
      { chave: 'taxa_admin_pct', titulo: 'Taxa (%)', exemplo: '4', aliases: ['taxa', 'taxa administracao'] },
      { chave: 'status', titulo: 'Status', exemplo: 'ativo' },
      { chave: 'observacoes', titulo: 'Observações', exemplo: '', aliases: ['obs'] },
    ],
  },
};

function lerPlanilha(base64) {
  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (limpo.length > 16 * 1024 * 1024) throw Object.assign(new Error('Arquivo acima do limite permitido.'), { status: 400 });
  const buf = Buffer.from(limpo, 'base64');
  if (!buf.length) throw Object.assign(new Error('Arquivo vazio.'), { status: 400 });
  if (buf.length > 12 * 1024 * 1024) throw Object.assign(new Error('Arquivo acima de 12 MB.'), { status: 400 });
  let wb;
  try {
    const ehZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const ehXls = buf[0] === 0xd0 && buf[1] === 0xcf;
    if (ehZip || ehXls) {
      wb = XLSX.read(buf, { type: 'buffer', cellDates: true, sheetRows: 5001 });
    } else {
      const texto = buf.toString('utf8').replace(/^\uFEFF/, '');
      const primeiraLinha = texto.split(/\r?\n/)[0] || '';
      const fs = primeiraLinha.includes(';') && !primeiraLinha.includes(',') ? ';' : ',';
      wb = XLSX.read(texto, { type: 'string', FS: fs, raw: true, sheetRows: 5001 });
    }
  } catch {
    throw Object.assign(new Error('Não foi possível ler a planilha. Use .xlsx, .xls ou .csv.'), { status: 400 });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error('A planilha está vazia.'), { status: 400 });
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const uteis = rows.filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (uteis.length > 5000) throw Object.assign(new Error('A planilha tem mais de 5.000 linhas. Divida em partes menores.'), { status: 400 });
  if (uteis.some(r => r.length > 60)) throw Object.assign(new Error('A planilha tem colunas demais (máximo 60).'), { status: 400 });
  return uteis;
}

function mapearColunas(entidade, header) {
  const modelo = MODELOS[entidade];
  const mapa = {};
  const usados = new Set();
  header.forEach((h, idx) => {
    const n = norm(h);
    if (!n) return;
    for (const col of modelo.colunas) {
      if (usados.has(col.chave)) continue;
      const candidatos = [col.titulo, col.chave, ...(col.aliases || [])].map(norm);
      if (candidatos.includes(n)) {
        mapa[col.chave] = idx;
        usados.add(col.chave);
        break;
      }
    }
  });
  return mapa;
}

function carregarReferencias() {
  const props = db.prepare('SELECT id, nome, cpf_cnpj, taxa_admin_pct FROM proprietarios').all();
  const imoveis = db.prepare('SELECT i.id, i.proprietario_id, i.endereco, i.numero, i.taxa_admin_pct FROM imoveis i').all();
  const inquilinos = db.prepare('SELECT id, nome, cpf_cnpj, telefone, email FROM inquilinos').all();
  const propPorNome = new Map();
  const propPorDoc = new Map();
  for (const p of props) {
    propPorNome.set(norm(p.nome), p);
    const d = soDigitos(p.cpf_cnpj);
    if (d) propPorDoc.set(d, p);
  }
  const imovelPorChave = new Map();
  for (const i of imoveis) {
    imovelPorChave.set(`${i.proprietario_id}|${norm(i.endereco)}|${norm(i.numero)}`, i);
  }
  const inqPorNome = new Map();
  const inqPorDoc = new Map();
  for (const q of inquilinos) {
    inqPorNome.set(norm(q.nome), q);
    const d = soDigitos(q.cpf_cnpj);
    if (d) inqPorDoc.set(d, q);
  }
  return { props, imoveis, inquilinos, propPorNome, propPorDoc, imovelPorChave, inqPorNome, inqPorDoc };
}

function processarLinha(entidade, linha, mapa, refs, opcoes) {
  const val = (chave) => {
    const idx = mapa[chave];
    return idx == null ? '' : linha[idx];
  };
  const erros = [];
  const dados = {};
  const modelo = MODELOS[entidade];

  for (const col of modelo.colunas) {
    const bruto = val(col.chave);
    let v = bruto;
    if (col.chave.endsWith('_centavos')) v = parseValor(bruto);
    else if (col.chave === 'taxa_admin_pct') v = parseNumero(bruto);
    else if (col.chave === 'dia_vencimento') v = parseNumero(bruto);
    else if (['inicio', 'fim', 'ultimo_reajuste', 'garantia_fim'].includes(col.chave)) v = parseData(bruto);
    else if (col.chave === 'tipo') v = parseTipo(bruto);
    else if (col.chave === 'situacao') v = parseSituacao(bruto);
    else if (col.chave === 'garantia_tipo') v = parseGarantia(bruto);
    else v = String(bruto ?? '').trim().slice(0, 2000);
    dados[col.chave] = v;
  }

  if (entidade === 'proprietarios') {
    if (!dados.nome) erros.push('Nome é obrigatório.');
    if (dados.taxa_admin_pct != null && (dados.taxa_admin_pct < 0 || dados.taxa_admin_pct > 100)) erros.push('Taxa deve ficar entre 0 e 100.');
    const doc = soDigitos(dados.cpf_cnpj);
    const existente = (doc && refs.propPorDoc.get(doc)) || refs.propPorNome.get(norm(dados.nome));
    if (existente) {
      dados._existente = existente;
      if (!opcoes.atualizar) erros.push(`Já cadastrado (${existente.nome}).`);
    }
    dados.tipo_conta = norm(dados.tipo_conta).startsWith('poup') ? 'poupanca' : 'corrente';
  }

  if (entidade === 'imoveis') {
    if (!dados.endereco) erros.push('Endereço é obrigatório.');
    const prop = refs.propPorNome.get(norm(dados.proprietario));
    if (!dados.proprietario) erros.push('Proprietário é obrigatório.');
    else if (!prop) erros.push(`Proprietário "${dados.proprietario}" não encontrado.`);
    else dados.proprietario_id = prop.id;
    if (prop) {
      const chave = `${prop.id}|${norm(dados.endereco)}|${norm(dados.numero)}`;
      const existente = refs.imovelPorChave.get(chave);
      if (existente) {
        dados._existente = existente;
        if (!opcoes.atualizar) erros.push('Imóvel já cadastrado para este proprietário.');
      }
    }
    if (dados.taxa_admin_pct != null && (dados.taxa_admin_pct < 0 || dados.taxa_admin_pct > 100)) erros.push('Taxa deve ficar entre 0 e 100.');
  }

  if (entidade === 'inquilinos') {
    if (!dados.nome) erros.push('Nome é obrigatório.');
    const doc = soDigitos(dados.cpf_cnpj);
    const existente = (doc && refs.inqPorDoc.get(doc)) || refs.inqPorNome.get(norm(dados.nome));
    if (existente) {
      dados._existente = existente;
      if (!opcoes.atualizar) erros.push(`Já cadastrado (${existente.nome}).`);
    }
  }

  if (entidade === 'contratos') {
    if (!dados.inicio) erros.push('Data de início inválida.');
    if (dados.fim && dados.inicio && dados.fim < dados.inicio) erros.push('Fim anterior ao início.');
    if (!dados.aluguel_centavos || dados.aluguel_centavos <= 0) erros.push('Aluguel deve ser maior que zero.');
    if (!dados.dia_vencimento || dados.dia_vencimento < 1 || dados.dia_vencimento > 31) dados.dia_vencimento = 5;
    const prop = refs.propPorNome.get(norm(dados.proprietario));
    if (!dados.proprietario) erros.push('Proprietário é obrigatório.');
    else if (!prop) erros.push(`Proprietário "${dados.proprietario}" não encontrado.`);
    let imovel = null;
    if (prop) {
      imovel = refs.imovelPorChave.get(`${prop.id}|${norm(dados.imovel)}|${norm(dados.numero)}`);
      if (!imovel) erros.push(`Imóvel "${dados.imovel}" não encontrado para ${prop.nome}.`);
      else dados.imovel_id = imovel.id;
    }
    let inq = refs.inqPorDoc.get(soDigitos(dados.inquilino_cpf)) || refs.inqPorNome.get(norm(dados.inquilino));
    if (!dados.inquilino) erros.push('Inquilino é obrigatório.');
    else if (!inq) {
      if (opcoes.criar_inquilinos === false) erros.push(`Inquilino "${dados.inquilino}" não encontrado.`);
      else dados._novoInquilino = true;
    } else dados.inquilino_id = inq.id;

    if (dados.codigo) {
      const existente = db.prepare('SELECT * FROM contratos WHERE lower(codigo)=lower(?)').get(dados.codigo);
      if (existente) {
        dados._existente = existente;
        if (!opcoes.atualizar) erros.push(`Contrato ${dados.codigo} já existe.`);
      }
    }
    dados.indice_reajuste = ['IGP-M', 'IPCA', 'INCC', 'IGP-DI', 'Fixo'].find(i => norm(i) === norm(dados.indice_reajuste)) || (dados.indice_reajuste ? String(dados.indice_reajuste).toUpperCase() : 'IGP-M');
    const st = norm(dados.status);
    dados.status = st.startsWith('encerr') ? 'encerrado' : st.startsWith('susp') ? 'suspenso' : 'ativo';
    if (dados.imovel_id && dados.status === 'ativo') {
      const outro = db.prepare("SELECT id, codigo FROM contratos WHERE imovel_id = ? AND status = 'ativo' AND id <> ?")
        .get(dados.imovel_id, dados._existente?.id ?? -1);
      if (outro) erros.push(`O imóvel já tem contrato ativo (${outro.codigo || '#' + outro.id}).`);
    }
    if (dados.taxa_admin_pct != null && (dados.taxa_admin_pct < 0 || dados.taxa_admin_pct > 100)) erros.push('Taxa deve ficar entre 0 e 100.');
  }

  return { dados, erros };
}

function inserirProprietario(d) {
  const r = db.prepare(`INSERT INTO proprietarios (nome, cpf_cnpj, email, telefone, endereco, banco, agencia, conta, tipo_conta, pix, taxa_admin_pct, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.nome, d.cpf_cnpj || null, d.email || null, d.telefone || null, d.endereco || null,
    d.banco || null, d.agencia || null, d.conta || null, d.tipo_conta || 'corrente', d.pix || null, d.taxa_admin_pct, d.observacoes || null);
  return Number(r.lastInsertRowid);
}

function atualizarProprietario(id, d) {
  const campos = ['nome', 'cpf_cnpj', 'email', 'telefone', 'endereco', 'banco', 'agencia', 'conta', 'tipo_conta', 'pix', 'taxa_admin_pct', 'observacoes'];
  const sets = [];
  const vals = [];
  for (const c of campos) {
    if (d[c] === '' || d[c] == null) continue;
    sets.push(`${c} = ?`); vals.push(d[c]);
  }
  if (sets.length) db.prepare(`UPDATE proprietarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

function inserirImovel(d) {
  const r = db.prepare(`INSERT INTO imoveis (proprietario_id, endereco, numero, complemento, bairro, cidade, uf, cep, tipo, situacao, taxa_admin_pct, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.proprietario_id, d.endereco, d.numero || null, d.complemento || null, d.bairro || null,
    d.cidade || null, d.uf || null, d.cep || null, d.tipo || 'apartamento', d.situacao || 'alugado', d.taxa_admin_pct, d.observacoes || null);
  return Number(r.lastInsertRowid);
}

function atualizarImovel(id, d) {
  const campos = ['endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'tipo', 'situacao', 'taxa_admin_pct', 'observacoes'];
  const sets = [];
  const vals = [];
  for (const c of campos) {
    if (d[c] === '' || d[c] == null) continue;
    sets.push(`${c} = ?`); vals.push(d[c]);
  }
  if (sets.length) db.prepare(`UPDATE imoveis SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

function inserirInquilino(d) {
  const r = db.prepare('INSERT INTO inquilinos (nome, cpf_cnpj, email, telefone, observacoes) VALUES (?,?,?,?,?)')
    .run(d.nome, d.cpf_cnpj || null, d.email || null, d.telefone || null, d.observacoes || null);
  return Number(r.lastInsertRowid);
}

function atualizarInquilino(id, d) {
  const campos = ['nome', 'cpf_cnpj', 'email', 'telefone', 'observacoes'];
  const sets = [];
  const vals = [];
  for (const c of campos) {
    if (d[c] === '' || d[c] == null) continue;
    sets.push(`${c} = ?`); vals.push(d[c]);
  }
  if (sets.length) db.prepare(`UPDATE inquilinos SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

function registrarInquilinoNovo(refs, d, id) {
  if (!refs) return;
  const novo = {
    id,
    nome: d.inquilino,
    cpf_cnpj: d.inquilino_cpf || null,
    telefone: d.inquilino_telefone || null,
    email: d.inquilino_email || null,
  };
  refs.inqPorNome.set(norm(novo.nome), novo);
  const doc = soDigitos(novo.cpf_cnpj);
  if (doc) refs.inqPorDoc.set(doc, novo);
}

function inserirContrato(d, refs) {
  let inquilinoId = d.inquilino_id;
  if (!inquilinoId && d._novoInquilino) {
    inquilinoId = inserirInquilino({
      nome: d.inquilino,
      cpf_cnpj: d.inquilino_cpf,
      telefone: d.inquilino_telefone,
      email: d.inquilino_email,
    });
    // Sem atualizar as referências, a segunda linha da mesma planilha criaria
    // um inquilino duplicado com o mesmo nome/documento.
    d.inquilino_id = inquilinoId;
    registrarInquilinoNovo(refs, d, inquilinoId);
  }
  const r = db.prepare(`INSERT INTO contratos (codigo, imovel_id, inquilino_id, inicio, fim, aluguel_centavos, dia_vencimento,
      indice_reajuste, ultimo_reajuste, garantia_tipo, garantia_valor_centavos, garantia_fim, taxa_admin_pct, status, observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.codigo || null, d.imovel_id, inquilinoId, d.inicio, d.fim || null, d.aluguel_centavos, d.dia_vencimento || 5,
      d.indice_reajuste || 'IGP-M', d.ultimo_reajuste || null, d.garantia_tipo || 'nenhuma', d.garantia_valor_centavos || 0,
      d.garantia_fim || null, d.taxa_admin_pct, d.status || 'ativo', d.observacoes || null);
  const id = Number(r.lastInsertRowid);
  if (!d.codigo) db.prepare('UPDATE contratos SET codigo = ? WHERE id = ?').run(`CT-${String(id).padStart(3, '0')}`, id);
  return id;
}

function atualizarContrato(id, d, refs) {
  let inquilinoId = d.inquilino_id;
  if (!inquilinoId && d._novoInquilino) {
    inquilinoId = inserirInquilino({
      nome: d.inquilino, cpf_cnpj: d.inquilino_cpf, telefone: d.inquilino_telefone, email: d.inquilino_email,
    });
    d.inquilino_id = inquilinoId;
    registrarInquilinoNovo(refs, d, inquilinoId);
  }
  const sets = [];
  const vals = [];
  const campos = ['codigo', 'imovel_id', 'inquilino_id', 'inicio', 'fim', 'aluguel_centavos', 'dia_vencimento', 'indice_reajuste',
    'ultimo_reajuste', 'garantia_tipo', 'garantia_valor_centavos', 'garantia_fim', 'taxa_admin_pct', 'status', 'observacoes'];
  for (const c of campos) {
    let v = c === 'inquilino_id' ? inquilinoId : d[c];
    if (v === '' || v == null) continue;
    sets.push(`${c} = ?`); vals.push(v);
  }
  if (sets.length) db.prepare(`UPDATE contratos SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function analisarImportacao({ entidade, arquivo_base64, opcoes = {} }) {
  const modelo = MODELOS[entidade];
  if (!modelo) throw Object.assign(new Error('Tipo de importação inválido.'), { status: 400 });
  const rows = lerPlanilha(arquivo_base64);
  if (rows.length < 2) throw Object.assign(new Error('A planilha precisa ter cabeçalho e pelo menos uma linha de dados.'), { status: 400 });
  const header = rows[0];
  const mapa = mapearColunas(entidade, header);
  const faltando = modelo.colunas.filter(c => c.req && mapa[c.chave] == null);
  if (faltando.length) {
    throw Object.assign(new Error(`Colunas obrigatórias não encontradas: ${faltando.map(c => c.titulo).join(', ')}. Baixe o modelo para conferir os nomes.`), { status: 400 });
  }
  const refs = carregarReferencias();
  const opcoesEfetivas = { atualizar: !!opcoes.atualizar, criar_inquilinos: opcoes.criar_inquilinos !== false };
  const linhas = [];
  let validos = 0;
  let erros = 0;
  rows.slice(1).forEach((linha, i) => {
    if (!linha.some(c => String(c ?? '').trim() !== '')) return;
    const p = processarLinha(entidade, linha, mapa, refs, opcoesEfetivas);
    if (p.erros.length) erros++; else validos++;
    if (linhas.length < 60) {
      linhas.push({
        linha: i + 2,
        status: p.erros.length ? 'erro' : (p.dados._existente ? 'atualizar' : 'novo'),
        resumo: resumoLinha(entidade, p.dados),
        erros: p.erros,
      });
    }
  });
  return {
    entidade,
    modelo: modelo.nome,
    total: validos + erros,
    validos,
    erros,
    colunas_detectadas: Object.keys(mapa).length,
    colunas_ignoradas: header.filter((h, i) => String(h ?? '').trim() && !Object.values(mapa).includes(i)).map(String),
    linhas,
  };
}

function resumoLinha(entidade, d) {
  if (entidade === 'proprietarios') return `${d.nome || '—'}${d.cpf_cnpj ? ' · ' + d.cpf_cnpj : ''}`;
  if (entidade === 'imoveis') return `${d.endereco || '—'}${d.numero ? ', ' + d.numero : ''} · ${d.proprietario || ''}`;
  if (entidade === 'inquilinos') return `${d.nome || '—'}${d.cpf_cnpj ? ' · ' + d.cpf_cnpj : ''}`;
  if (entidade === 'contratos') return `${d.codigo || 'novo'} · ${d.imovel || ''} · ${d.inquilino || ''} · ${moneyBR(d.aluguel_centavos)}`;
  return '';
}

function moneyBR(c) {
  return (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function importar({ entidade, arquivo_base64, opcoes = {}, usuario }) {
  const modelo = MODELOS[entidade];
  if (!modelo) throw Object.assign(new Error('Tipo de importação inválido.'), { status: 400 });
  const rows = lerPlanilha(arquivo_base64);
  if (rows.length < 2) throw Object.assign(new Error('Planilha sem dados.'), { status: 400 });
  const header = rows[0];
  const mapa = mapearColunas(entidade, header);
  const faltando = modelo.colunas.filter(c => c.req && mapa[c.chave] == null);
  if (faltando.length) throw Object.assign(new Error(`Colunas obrigatórias ausentes: ${faltando.map(c => c.titulo).join(', ')}.`), { status: 400 });

  const refs = carregarReferencias();
  const opcoesEfetivas = { atualizar: !!opcoes.atualizar, criar_inquilinos: opcoes.criar_inquilinos !== false };
  let inseridos = 0;
  let atualizados = 0;
  const erros = [];

  db.exec('BEGIN');
  try {
    rows.slice(1).forEach((linha, i) => {
      if (!linha.some(c => String(c ?? '').trim() !== '')) return;
      const p = processarLinha(entidade, linha, mapa, refs, opcoesEfetivas);
      if (p.erros.length) {
        erros.push({ linha: i + 2, erros: p.erros });
        return;
      }
      try {
        const d = p.dados;
        if (entidade === 'proprietarios') {
          if (d._existente) { atualizarProprietario(d._existente.id, d); atualizados++; }
          else { inserirProprietario(d); inseridos++; }
        } else if (entidade === 'imoveis') {
          if (d._existente) { atualizarImovel(d._existente.id, d); atualizados++; }
          else { inserirImovel(d); inseridos++; }
        } else if (entidade === 'inquilinos') {
          if (d._existente) { atualizarInquilino(d._existente.id, d); atualizados++; }
          else { inserirInquilino(d); inseridos++; }
        } else if (entidade === 'contratos') {
          if (d._existente) { atualizarContrato(d._existente.id, d, refs); atualizados++; }
          else { inserirContrato(d, refs); inseridos++; }
        }
      } catch (e) {
        erros.push({ linha: i + 2, erros: [e.message] });
      }
    });
    inserirAuditoria({
      usuario_id: usuario?.id ?? null, usuario_nome: usuario?.nome ?? 'sistema', acao: 'importar',
      entidade, entidade_id: null, detalhe: { inseridos, atualizados, erros: erros.length }, ip: null,
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { inseridos, atualizados, erros, total: inseridos + atualizados + erros.length };
}

export function gerarModelo(entidade, formato = 'xlsx') {
  const modelo = MODELOS[entidade];
  if (!modelo) throw Object.assign(new Error('Modelo inválido.'), { status: 404 });
  const header = modelo.colunas.map(c => c.titulo + (c.req ? ' *' : ''));
  const exemplos = [0, 1].map(i => modelo.colunas.map(c => {
    if (c.chave === 'proprietario') return i === 0 ? 'Maria Souza' : 'João Pereira';
    if (c.chave === 'imovel') return i === 0 ? 'Rua das Flores' : 'Rua do Sol';
    if (c.chave === 'inquilino') return i === 0 ? 'Carlos Mendes' : 'Fernanda Alves';
    if (c.chave === 'nome') return i === 0 ? 'Maria Souza' : 'João Pereira';
    return c.exemplo ?? '';
  }));

  if (formato === 'csv') {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '\uFEFF' + [header, ...exemplos].map(l => l.map(esc).join(';')).join('\r\n');
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...exemplos]);
  ws['!cols'] = modelo.colunas.map(c => ({ wch: Math.max(14, (c.titulo || '').length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, modelo.nome.slice(0, 28));

  const instrucoes = [
    [modelo.nome],
    [],
    [modelo.descricao],
    [],
    ['Como usar'],
    ['1. Preencha a aba principal sem alterar os nomes das colunas.'],
    ['2. Campos com * são obrigatórios.'],
    ['3. Datas no formato dd/mm/aaaa. Valores em reais, por exemplo 1800,00.'],
    ['4. Salve como .xlsx e importe pelo sistema.'],
    [],
    ['Colunas'],
    ['Coluna', 'Obrigatória', 'Exemplo'],
    ...modelo.colunas.map(c => [c.titulo, c.req ? 'Sim' : 'Não', c.exemplo ?? '']),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instrucoes);
  ws2['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Instruções');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
