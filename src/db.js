import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashSenha } from './auth.js';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'imobiliaria.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  rotulo TEXT NOT NULL,
  grupo TEXT NOT NULL DEFAULT 'geral',
  tipo TEXT NOT NULL DEFAULT 'texto',
  opcoes TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  editavel INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'operador',
  deve_trocar_senha INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  detalhe TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS proprietarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cpf_cnpj TEXT,
  email TEXT,
  telefone TEXT,
  endereco TEXT,
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  tipo_conta TEXT DEFAULT 'corrente',
  pix TEXT,
  documento_url TEXT,
  taxa_admin_pct REAL,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS imoveis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proprietario_id INTEGER NOT NULL REFERENCES proprietarios(id),
  apelido TEXT,
  endereco TEXT NOT NULL,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  tipo TEXT DEFAULT 'apartamento',
  situacao TEXT DEFAULT 'alugado',
  taxa_admin_pct REAL,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inquilinos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cpf_cnpj TEXT,
  email TEXT,
  telefone TEXT,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT,
  imovel_id INTEGER NOT NULL REFERENCES imoveis(id),
  inquilino_id INTEGER NOT NULL REFERENCES inquilinos(id),
  inicio TEXT NOT NULL,
  fim TEXT,
  aluguel_centavos INTEGER NOT NULL DEFAULT 0,
  dia_vencimento INTEGER NOT NULL DEFAULT 5,
  indice_reajuste TEXT DEFAULT 'IGP-M',
  ultimo_reajuste TEXT,
  garantia_tipo TEXT DEFAULT 'nenhuma',
  garantia_valor_centavos INTEGER DEFAULT 0,
  garantia_fim TEXT,
  taxa_admin_pct REAL,
  justificativa_taxa TEXT,
  documento_url TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS excecoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id),
  competencia TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'desconto',
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  motivo TEXT NOT NULL,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  competencia TEXT NOT NULL,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT,
  valor_centavos INTEGER NOT NULL,
  caixa TEXT NOT NULL DEFAULT 'imobiliaria',
  proprietario_id INTEGER REFERENCES proprietarios(id),
  imovel_id INTEGER REFERENCES imoveis(id),
  contrato_id INTEGER REFERENCES contratos(id),
  repasse_id INTEGER,
  status TEXT NOT NULL DEFAULT 'ativo',
  estorno_de_id INTEGER,
  motivo_estorno TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS repasses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia TEXT NOT NULL,
  proprietario_id INTEGER NOT NULL REFERENCES proprietarios(id),
  aluguel_centavos INTEGER NOT NULL DEFAULT 0,
  taxa_pct REAL NOT NULL DEFAULT 0,
  taxa_centavos INTEGER NOT NULL DEFAULT 0,
  despesas_centavos INTEGER NOT NULL DEFAULT 0,
  descontos_centavos INTEGER NOT NULL DEFAULT 0,
  acrescimos_centavos INTEGER NOT NULL DEFAULT 0,
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  detalhe_json TEXT,
  status TEXT NOT NULL DEFAULT 'calculado',
  pago_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (competencia, proprietario_id)
);

CREATE TABLE IF NOT EXISTS fechamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia TEXT NOT NULL UNIQUE,
  fechado_por TEXT,
  fechado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reaberto_por TEXT,
  reaberto_em TEXT,
  motivo_reabertura TEXT
);

CREATE TABLE IF NOT EXISTS cobrancas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id),
  competencia TEXT NOT NULL,
  vencimento TEXT NOT NULL,
  valor_original_centavos INTEGER NOT NULL DEFAULT 0,
  multa_centavos INTEGER NOT NULL DEFAULT 0,
  juros_centavos INTEGER NOT NULL DEFAULT 0,
  desconto_centavos INTEGER NOT NULL DEFAULT 0,
  valor_pago_centavos INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'em_aberto',
  cobranca_status TEXT,
  data_pagamento TEXT,
  forma_pagamento TEXT,
  observacao TEXT,
  responsavel TEXT,
  proxima_acao TEXT,
  proxima_data TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT,
  cancelado_em TEXT,
  motivo_cancelamento TEXT,
  UNIQUE (contrato_id, competencia)
);

CREATE TABLE IF NOT EXISTS cobranca_acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cobranca_id INTEGER NOT NULL REFERENCES cobrancas(id),
  tipo TEXT NOT NULL,
  descricao TEXT,
  responsavel TEXT,
  proxima_acao TEXT,
  proxima_data TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conciliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origem TEXT NOT NULL,
  fitid TEXT,
  data TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  cobranca_id INTEGER,
  lancamento_id INTEGER,
  confianca INTEGER,
  sugestao_tipo TEXT,
  sugestao_id INTEGER,
  sugestao_label TEXT,
  motivo TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cobrancas_comp ON cobrancas(competencia, status);
CREATE INDEX IF NOT EXISTS idx_cobrancas_contrato ON cobrancas(contrato_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_status ON conciliacoes(status);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  usado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_hash ON password_resets(token_hash);

CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,
  entidade_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  mime TEXT,
  tamanho INTEGER NOT NULL DEFAULT 0,
  caminho TEXT NOT NULL,
  categoria TEXT,
  descricao TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS comunicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal TEXT NOT NULL,
  entidade TEXT,
  entidade_id INTEGER,
  destinatario_nome TEXT,
  destinatario TEXT,
  assunto TEXT,
  mensagem TEXT,
  status TEXT NOT NULL,
  erro TEXT,
  usuario TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lanc_comp ON lancamentos(competencia);
CREATE INDEX IF NOT EXISTS idx_lanc_prop ON lancamentos(proprietario_id);
CREATE INDEX IF NOT EXISTS idx_contrato_imovel ON contratos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_docs_entidade ON documentos(entidade, entidade_id);
`);

// Migrações simples: adiciona colunas novas em bancos já existentes.
function garantirColuna(tabela, coluna, definicao) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
  if (cols.includes(coluna)) return false;
  db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  return true;
}
const adicionouFlagSenha = garantirColuna('usuarios', 'deve_trocar_senha', 'INTEGER NOT NULL DEFAULT 0');
if (adicionouFlagSenha) {
  db.prepare("UPDATE usuarios SET deve_trocar_senha = 1 WHERE email = 'admin@imobiliaria.local'").run();
}
garantirColuna('proprietarios', 'documento_url', 'TEXT');
garantirColuna('contratos', 'documento_url', 'TEXT');
garantirColuna('lancamentos', 'cobranca_id', 'INTEGER');
garantirColuna('documentos', 'grupo', 'TEXT');
garantirColuna('documentos', 'versao', 'INTEGER NOT NULL DEFAULT 1');
garantirColuna('documentos', 'atual', 'INTEGER NOT NULL DEFAULT 1');
garantirColuna('documentos', 'validade', 'TEXT');
garantirColuna('usuarios', 'totp_secret', 'TEXT');
garantirColuna('usuarios', 'totp_ativo', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('usuarios', 'totp_recovery', 'TEXT');
garantirColuna('conciliacoes', 'sugestao_tipo', 'TEXT');
garantirColuna('conciliacoes', 'sugestao_id', 'INTEGER');
garantirColuna('conciliacoes', 'sugestao_label', 'TEXT');

const SETTINGS_PADRAO = [
  ['imob_nome', 'Imobiliária Exemplo', 'Nome da imobiliária', 'empresa', 'texto', null, 1],
  ['imob_cnpj', '', 'CNPJ', 'empresa', 'texto', null, 2],
  ['imob_email', '', 'E-mail', 'empresa', 'texto', null, 3],
  ['imob_telefone', '', 'Telefone', 'empresa', 'texto', null, 4],
  ['imob_endereco', '', 'Endereço', 'empresa', 'texto', null, 5],

  ['taxa_admin_padrao', '8', 'Taxa de administração padrão (%)', 'regras', 'percentual', null, 10],
  ['dia_repasse', '5', 'Dia do repasse ao proprietário', 'regras', 'numero', null, 11],
  ['indice_reajuste_padrao', 'IGP-M', 'Índice de reajuste padrão', 'regras', 'lista', 'IGP-M,IPCA,INCC,IGP-DI,Fixo', 12],
  ['multa_atraso_pct', '2', 'Multa por atraso (%)', 'regras', 'percentual', null, 13],
  ['juros_atraso_dia_pct', '0,033', 'Juros por dia de atraso (%)', 'regras', 'percentual', null, 14],
  ['limite_manutencao', '300', 'Limite de manutenção sem autorização (R$)', 'regras', 'dinheiro', null, 15],
  ['dias_alerta_contrato', '90,60,30', 'Avisos de vencimento de contrato (dias, separados por vírgula)', 'alertas', 'texto', null, 20],
  ['dias_alerta_reajuste', '30', 'Aviso de reajuste anual (dias antes)', 'alertas', 'numero', null, 21],
  ['dias_alerta_garantia', '30', 'Aviso de fim de garantia (dias antes)', 'alertas', 'numero', null, 22],
  ['dias_alerta_atraso', '1', 'Aviso de aluguel atrasado (dias após vencimento)', 'alertas', 'numero', null, 23],
  ['mensagem_cobranca', 'Olá, {inquilino}! Identificamos que o aluguel referente a {competencia} do imóvel {imovel} está em aberto. Valor: {valor}. Se já pagou, desconsidere. Obrigado!', 'Modelo de mensagem de cobrança', 'mensagens', 'texto_longo', null, 30],
  ['mensagem_lembrete', 'Olá, {inquilino}! Lembrete: o aluguel do imóvel {imovel} vence em {vencimento}. Valor: {valor}. Qualquer dúvida, estamos à disposição.', 'Modelo de lembrete de vencimento', 'mensagens', 'texto_longo', null, 31],
  ['mensagem_reajuste', 'Olá, {inquilino}! O contrato do imóvel {imovel} completa aniversário em {data} e o reajuste pelo índice {indice} será aplicado. Em breve enviaremos os detalhes.', 'Modelo de aviso de reajuste', 'mensagens', 'texto_longo', null, 32],
  ['email_remetente_nome', '', 'Nome do remetente', 'comunicacao', 'texto', null, 50],
  ['email_remetente', '', 'E-mail de envio (vazio = usa o SMTP_FROM)', 'comunicacao', 'texto', null, 51],
  ['email_assinatura', 'Atenciosamente,\nEquipe da imobiliária', 'Assinatura dos e-mails', 'comunicacao', 'texto_longo', null, 52],
  ['whatsapp_empresa', '', 'WhatsApp da empresa (DDI + DDD + número)', 'comunicacao', 'texto', null, 53],
  ['prorrogar_vencimento', '1', 'Prorrogar vencimento que cai em fim de semana para o próximo dia útil', 'cobranca', 'lista', '1,0', 60],
  ['cobranca_proporcional', '0', 'Cobrar mês proporcional quando o contrato começa no meio do mês', 'cobranca', 'lista', '1,0', 61],
  ['lgpd_encarregado', '', 'Encarregado de dados (DPO)', 'lgpd', 'texto', null, 70],
  ['lgpd_email', '', 'E-mail do encarregado', 'lgpd', 'texto', null, 71],
  ['lgpd_retencao_financeira_anos', '5', 'Retenção de registros financeiros (anos)', 'lgpd', 'numero', null, 72],
  ['lgpd_retencao_logs_dias', '365', 'Retenção de logs de auditoria (dias)', 'lgpd', 'numero', null, 73],
  ['mascarar_cpf_consulta', '1', 'Mascarar CPF/CNPJ para o perfil consulta', 'lgpd', 'lista', '1,0', 74],
  ['email_recuperacao', '', 'E-mail para receber solicitações de redefinição de senha', 'seguranca', 'texto', null, 80],
  ['reset_validade_min', '30', 'Validade do link de redefinição (minutos)', 'seguranca', 'numero', null, 81],
  ['permitir_cadastro', '1', 'Permitir solicitação de acesso pela tela de login', 'seguranca', 'lista', '1,0', 82],
  ['primeiro_acesso', '1', 'Mostrar dica de primeiro acesso na tela de login', 'seguranca', 'lista', '1,0', 83],
  ['url_publica', '', 'URL pública do sistema (usada nos links de e-mail)', 'seguranca', 'texto', null, 84],
  ['backup_aviso_dias', '7', 'Aviso se o último backup tiver mais de (dias)', 'seguranca', 'numero', null, 40],
  ['ultimo_backup', '', 'Último backup registrado', 'seguranca', 'data', null, 41],
];

const insSetting = db.prepare(`INSERT OR IGNORE INTO settings (chave, valor, rotulo, grupo, tipo, opcoes, ordem) VALUES (?,?,?,?,?,?,?)`);
for (const s of SETTINGS_PADRAO) insSetting.run(...s);

const qtdUsuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
if (qtdUsuarios === 0) {
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha) VALUES (?,?,?,?,1)')
    .run('Administrador', 'admin@imobiliaria.local', hashSenha('admin123'), 'admin');
}

const qtdProps = db.prepare('SELECT COUNT(*) AS n FROM proprietarios').get().n;
if (qtdProps === 0) seedDemo();

export function seedDemo() {
  const hoje = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDias = (dias) => { const d = new Date(hoje); d.setDate(d.getDate() + dias); return iso(d); };
  const compAtual = iso(hoje).slice(0, 7);

  const insProp = db.prepare(`INSERT INTO proprietarios (nome, cpf_cnpj, email, telefone, endereco, banco, agencia, conta, pix, taxa_admin_pct, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const p1 = Number(insProp.run('Maria Souza', '123.456.789-00', 'maria@exemplo.com', '(11) 98888-1111', 'Rua das Acácias, 45', 'Banco do Brasil', '1234-5', '67890-1', 'maria@exemplo.com', 6, 'Contrato antigo: taxa diferenciada de 6%.').lastInsertRowid);
  const p2 = Number(insProp.run('João Pereira', '987.654.321-00', 'joao@exemplo.com', '(11) 97777-2222', 'Av. Paulista, 1000', 'Itaú', '4321-0', '12345-6', '', null, 'Parceiro da casa: condição especial combinada.').lastInsertRowid);
  const p3 = Number(insProp.run('Ana Lima', '111.222.333-44', 'ana@exemplo.com', '(11) 96666-3333', 'Rua Verde, 12', 'Caixa', '1111-1', '22222-2', '', null, '').lastInsertRowid);

  const insImovel = db.prepare(`INSERT INTO imoveis (proprietario_id, apelido, endereco, numero, complemento, bairro, cidade, uf, cep, tipo, situacao, taxa_admin_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const i1 = Number(insImovel.run(p1, 'Apto 302', 'Rua das Flores', '120', 'Apto 302', 'Centro', 'São Paulo', 'SP', '01000-000', 'apartamento', 'alugado', null).lastInsertRowid);
  const i2 = Number(insImovel.run(p1, 'Casa do Sol', 'Rua do Sol', '9', '', 'Jardim', 'São Paulo', 'SP', '02000-000', 'casa', 'alugado', null).lastInsertRowid);
  const i3 = Number(insImovel.run(p2, 'Sala Central', 'Av. Central', '45', 'Sala 12', 'Centro', 'São Paulo', 'SP', '03000-000', 'comercial', 'alugado', 5).lastInsertRowid);
  const i4 = Number(insImovel.run(p3, 'Apto Verde', 'Rua Verde', '12', 'Apto 71', 'Vila Nova', 'São Paulo', 'SP', '04000-000', 'apartamento', 'alugado', null).lastInsertRowid);

  const insInq = db.prepare(`INSERT INTO inquilinos (nome, cpf_cnpj, email, telefone) VALUES (?,?,?,?)`);
  const q1 = Number(insInq.run('Carlos Mendes', '222.333.444-55', 'carlos@exemplo.com', '(11) 95555-4444').lastInsertRowid);
  const q2 = Number(insInq.run('Fernanda Alves', '333.444.555-66', 'fernanda@exemplo.com', '(11) 94444-5555').lastInsertRowid);
  const q3 = Number(insInq.run('Studio Design Ltda', '12.345.678/0001-90', 'contato@studio.com', '(11) 93333-6666').lastInsertRowid);
  const q4 = Number(insInq.run('Rafael Costa', '444.555.666-77', 'rafael@exemplo.com', '(11) 92222-7777').lastInsertRowid);

  const insContrato = db.prepare(`INSERT INTO contratos (codigo, imovel_id, inquilino_id, inicio, fim, aluguel_centavos, dia_vencimento, indice_reajuste, ultimo_reajuste, garantia_tipo, garantia_valor_centavos, garantia_fim, taxa_admin_pct, justificativa_taxa, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const c1 = Number(insContrato.run('CT-001', i1, q1, addDias(-700), addDias(28), 180000, 5, 'IGP-M', addDias(-335), 'fiador', 0, null, null, null, 'ativo').lastInsertRowid);
  const c2 = Number(insContrato.run('CT-002', i2, q2, addDias(-400), addDias(57), 220000, 10, 'IPCA', addDias(-35), 'caucao', 220000, addDias(20), null, null, 'ativo').lastInsertRowid);
  const c3 = Number(insContrato.run('CT-003', i3, q3, addDias(-200), addDias(80), 150000, 5, 'IGP-M', addDias(-200), 'nenhuma', 0, null, 4, 'Parceiro da casa: taxa reduzida de 4% aprovada pela direção.', 'ativo').lastInsertRowid);
  const c4 = Number(insContrato.run('CT-004', i4, q4, addDias(-100), addDias(265), 70000, 15, 'IPCA', addDias(-100), 'caucao', 70000, addDias(265), null, null, 'ativo').lastInsertRowid);

  const insLanc = db.prepare(`INSERT INTO lancamentos (data, competencia, tipo, categoria, descricao, valor_centavos, caixa, proprietario_id, imovel_id, contrato_id, criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

  const hojeComp = compAtual;
  const addMeses = (comp, delta) => {
    const [a, m] = comp.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const ultimoDia = (comp) => {
    const [a, m] = comp.split('-').map(Number);
    return `${comp}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
  };

  const contratosSeed = [
    { id: c1, prop: p1, imovel: i1, aluguel: 180000, inicio: addDias(-700), fim: addDias(28) },
    { id: c2, prop: p1, imovel: i2, aluguel: 220000, inicio: addDias(-400), fim: addDias(57) },
    { id: c3, prop: p2, imovel: i3, aluguel: 150000, inicio: addDias(-200), fim: addDias(80) },
    { id: c4, prop: p3, imovel: i4, aluguel: 70000, inicio: addDias(-100), fim: addDias(265) },
  ];

  for (let atras = 11; atras >= 0; atras--) {
    const comp = addMeses(hojeComp, -atras);
    const inicioMes = `${comp}-01`;
    const fimMes = ultimoDia(comp);

    for (const c of contratosSeed) {
      if (c.inicio > fimMes) continue;
      if (c.fim && c.fim < inicioMes) continue;
      // No mês atual, deixa um aluguel em aberto para demonstrar inadimplência/alerta.
      if (atras === 0 && (c.id === c1 || c.id === c4)) continue;
      insLanc.run(`${comp}-08`, comp, 'receita', 'Aluguel', `Aluguel ${c.id === c1 ? 'CT-001' : c.id === c2 ? 'CT-002' : c.id === c3 ? 'CT-003' : 'CT-004'}`,
        c.aluguel, 'proprietarios', c.prop, c.imovel, c.id, 'seed');
    }

    insLanc.run(`${comp}-12`, comp, 'despesa', 'Material de escritório', 'Despesas do escritório', 12000, 'imobiliaria', null, null, null, 'seed');
    insLanc.run(`${comp}-20`, comp, 'despesa', 'Outros', 'Software de gestão', 8000, 'imobiliaria', null, null, null, 'seed');
  }

  insLanc.run(addDias(-5), hojeComp, 'despesa', 'Manutenção', 'Reparo hidráulico', 35000, 'proprietarios', p1, i1, c1, 'seed');
}
