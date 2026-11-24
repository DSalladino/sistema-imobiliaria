import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashSenha } from './auth.js';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// Protege o banco e os arquivos auxiliares contra leitura por outros usuários do
// sistema operacional. Em Windows o chmod é inofensivo (sem efeito prático).
function proteger(caminho) {
  try { if (fs.existsSync(caminho)) fs.chmodSync(caminho, 0o600); } catch {}
}
try { fs.chmodSync(DATA_DIR, 0o700); } catch {}

export const db = new DatabaseSync(path.join(DATA_DIR, 'imobiliaria.db'));
proteger(path.join(DATA_DIR, 'imobiliaria.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// Sobrescreve o conteúdo de páginas removidas, reduzindo resíduos de dados
// pessoais em arquivos de banco e backups.
db.exec('PRAGMA secure_delete = ON;');
proteger(path.join(DATA_DIR, 'imobiliaria.db'));
proteger(path.join(DATA_DIR, 'imobiliaria.db-wal'));
proteger(path.join(DATA_DIR, 'imobiliaria.db-shm'));

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

-- Âncora externa da trilha: guarda o último hash e o tamanho esperado. Sem
-- isso, apagar os últimos registros não quebra a cadeia restante e passaria
-- despercebido. A verificação compara a trilha real com esta âncora.
CREATE TABLE IF NOT EXISTS auditoria_estado (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_hash TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'pagar',
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outros',
  fornecedor TEXT,
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  vencimento TEXT NOT NULL,
  competencia TEXT NOT NULL,
  recorrencia TEXT NOT NULL DEFAULT 'unica',
  recorrencia_fim TEXT,
  recorrencia_origem_id INTEGER,
  caixa TEXT NOT NULL DEFAULT 'imobiliaria',
  proprietario_id INTEGER REFERENCES proprietarios(id),
  imovel_id INTEGER REFERENCES imoveis(id),
  contrato_id INTEGER REFERENCES contratos(id),
  status TEXT NOT NULL DEFAULT 'aberta',
  pago_em TEXT,
  pago_centavos INTEGER,
  lancamento_id INTEGER,
  observacoes TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT,
  cancelado_em TEXT,
  motivo_cancelamento TEXT
);

CREATE TABLE IF NOT EXISTS comissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id),
  corretor TEXT NOT NULL,
  base_centavos INTEGER NOT NULL DEFAULT 0,
  pct REAL NOT NULL DEFAULT 0,
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  competencia TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prevista',
  prevista_em TEXT,
  paga_em TEXT,
  lancamento_id INTEGER,
  observacoes TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (contrato_id, competencia, corretor)
);

CREATE TABLE IF NOT EXISTS parceiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'fornecedor',
  nome TEXT NOT NULL,
  nome_fantasia TEXT,
  cpf_cnpj TEXT,
  creci TEXT,
  email TEXT,
  telefone TEXT,
  whatsapp TEXT,
  tipo_servico TEXT,
  especialidades TEXT,
  pix TEXT,
  endereco TEXT,
  site TEXT,
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  tipo_conta TEXT DEFAULT 'corrente',
  forma_pagamento TEXT,
  prazo_pagamento_dias INTEGER,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contexto TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT,
  caixa TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (contexto, nome)
);

CREATE TABLE IF NOT EXISTS reajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id),
  competencia TEXT NOT NULL,
  indice TEXT,
  percentual REAL NOT NULL DEFAULT 0,
  aluguel_anterior_centavos INTEGER NOT NULL DEFAULT 0,
  aluguel_novo_centavos INTEGER NOT NULL DEFAULT 0,
  aplicado_em TEXT NOT NULL,
  aplicado_por TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rescisoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL UNIQUE REFERENCES contratos(id),
  data TEXT NOT NULL,
  motivo TEXT NOT NULL,
  multa_centavos INTEGER NOT NULL DEFAULT 0,
  caucao_devolucao_centavos INTEGER NOT NULL DEFAULT 0,
  cobrancas_canceladas INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_contas_venc ON contas(vencimento, status);
CREATE INDEX IF NOT EXISTS idx_contas_tipo ON contas(tipo, status);
CREATE INDEX IF NOT EXISTS idx_comissoes_status ON comissoes(status, competencia);
CREATE INDEX IF NOT EXISTS idx_parceiros_tipo ON parceiros(tipo, ativo);
CREATE INDEX IF NOT EXISTS idx_categorias_contexto ON categorias(contexto, ativo, ordem);
CREATE INDEX IF NOT EXISTS idx_reajustes_contrato ON reajustes(contrato_id);
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
garantirColuna('contratos', 'corretor', 'TEXT');
garantirColuna('contratos', 'corretor_id', 'INTEGER REFERENCES parceiros(id)');
garantirColuna('contratos', 'comissao_pct', 'REAL');
garantirColuna('comissoes', 'corretor_id', 'INTEGER REFERENCES parceiros(id)');
garantirColuna('contas', 'parceiro_id', 'INTEGER REFERENCES parceiros(id)');
// Dados comerciais e de pagamento dos parceiros (fornecedores, empresas de
// manutenção e prestadores de serviço). Ficam em colunas próprias para que a
// seleção em contas e lançamentos traga telefone, Pix e condição de pagamento.
garantirColuna('parceiros', 'nome_fantasia', 'TEXT');
garantirColuna('parceiros', 'tipo_servico', 'TEXT');
garantirColuna('parceiros', 'especialidades', 'TEXT');
garantirColuna('parceiros', 'whatsapp', 'TEXT');
garantirColuna('parceiros', 'site', 'TEXT');
garantirColuna('parceiros', 'banco', 'TEXT');
garantirColuna('parceiros', 'agencia', 'TEXT');
garantirColuna('parceiros', 'conta', 'TEXT');
garantirColuna('parceiros', 'tipo_conta', "TEXT DEFAULT 'corrente'");
garantirColuna('parceiros', 'forma_pagamento', 'TEXT');
garantirColuna('parceiros', 'prazo_pagamento_dias', 'INTEGER');
garantirColuna('auditoria', 'hash_anterior', 'TEXT');
garantirColuna('auditoria', 'hash', 'TEXT');
garantirColuna('sessoes', 'ultimo_uso', 'TEXT');
db.prepare("UPDATE sessoes SET ultimo_uso = criado_em WHERE ultimo_uso IS NULL").run();

// Índices criados depois das migrações para não falharem em bancos antigos que
// ainda não tinham as colunas novas. São operações idempotentes e não alteram
// dados existentes.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_parceiros_servico ON parceiros(tipo_servico, ativo);
  CREATE INDEX IF NOT EXISTS idx_contas_parceiro ON contas(parceiro_id);
  CREATE INDEX IF NOT EXISTS idx_cobrancas_venc ON cobrancas(vencimento, status);
  CREATE INDEX IF NOT EXISTS idx_lanc_categoria ON lancamentos(categoria, competencia);
`);

// Cadeia de auditoria: bancos criados antes desta versão recebem a cadeia
// retroativa uma única vez. A partir daí cada novo registro é encadeado ao
// anterior, permitindo provar que a trilha não foi editada.
function hashLegado(anterior, r) {
  const partes = [anterior || '', r.usuario_id ?? '', r.usuario_nome ?? '', r.acao ?? '', r.entidade ?? '',
    r.entidade_id ?? '', r.detalhe ?? '', r.ip ?? '', r.criado_em ?? ''];
  return crypto.createHash('sha256').update(partes.join('|')).digest('hex');
}
const semHash = db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE hash IS NULL').get().n;
if (semHash > 0) {
  const pendentes = db.prepare(`SELECT id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip, criado_em
    FROM auditoria ORDER BY id`).all();
  const atualizar = db.prepare('UPDATE auditoria SET hash_anterior = ?, hash = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    let anterior = '';
    for (const linha of pendentes) {
      const hash = hashLegado(anterior, linha);
      atualizar.run(anterior || null, hash, linha.id);
      anterior = hash;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Inicializa a âncora em bases que já tinham auditoria antes desta versão. A
// partir daqui, qualquer remoção das últimas linhas é detectável.
const ancoraExistente = db.prepare('SELECT id FROM auditoria_estado WHERE id = 1').get();
if (!ancoraExistente) {
  const ultima = db.prepare('SELECT hash FROM auditoria WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  const totalAuditoria = db.prepare('SELECT COUNT(*) AS n FROM auditoria').get().n;
  db.prepare('INSERT INTO auditoria_estado (id, ultimo_hash, total) VALUES (1, ?, ?)').run(ultima?.hash || null, totalAuditoria);
}

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
  ['comissao_padrao_pct', '0', 'Comissão padrão de corretagem (%)', 'regras', 'percentual', null, 16],
  ['previsao_caixa_meses', '6', 'Meses de previsão de caixa', 'financeiro', 'numero', null, 62],
  ['previsao_analise_meses', '12', 'Meses de histórico usados nas análises futuras', 'financeiro', 'numero', null, 63],
  ['previsao_horizonte_meses', '3', 'Horizonte padrão das projeções (meses)', 'financeiro', 'numero', null, 64],
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
  ['validar_documento', '1', 'Validar CPF/CNPJ por dígito verificador e impedir duplicidade', 'lgpd', 'lista', '1,0', 75],
  ['lgpd_retencao_comunicacoes_dias', '730', 'Retenção de mensagens e comunicações (dias)', 'lgpd', 'numero', null, 76],
  ['email_recuperacao', '', 'E-mail para receber solicitações de redefinição de senha', 'seguranca', 'texto', null, 80],
  ['reset_validade_min', '30', 'Validade do link de redefinição (minutos)', 'seguranca', 'numero', null, 81],
  ['permitir_cadastro', '0', 'Permitir solicitação de acesso pela tela de login', 'seguranca', 'lista', '1,0', 82],
  ['primeiro_acesso', '0', 'Mostrar dica de primeiro acesso na tela de login', 'seguranca', 'lista', '1,0', 83],
  ['url_publica', '', 'URL pública do sistema (usada nos links de e-mail)', 'seguranca', 'texto', null, 84],
  ['pix_chave', '', 'Chave Pix para recebimento (CPF/CNPJ, e-mail, telefone ou aleatória)', 'integracao', 'texto', null, 90],
  ['pix_recebedor', '', 'Nome do recebedor no Pix (máx. 25 caracteres)', 'integracao', 'texto', null, 91],
  ['pix_cidade', '', 'Cidade do recebedor no Pix (máx. 15 caracteres)', 'integracao', 'texto', null, 92],
  ['whatsapp_modo', 'link', 'Modo de envio do WhatsApp', 'integracao', 'lista', 'link,api', 93],
  ['whatsapp_numero', '', 'WhatsApp da empresa no formato wa.me (DDI + DDD + número)', 'integracao', 'texto', null, 94],
  ['backup_aviso_dias', '7', 'Aviso se o último backup tiver mais de (dias)', 'seguranca', 'numero', null, 40],
  ['backup_automatico_horas', '24', 'Criar snapshot automático ao iniciar após (horas)', 'seguranca', 'numero', null, 44],
  ['backup_retencao_dias', '30', 'Retenção dos snapshots automáticos de segurança (dias)', 'seguranca', 'numero', null, 42],
  ['sessao_horas', '12', 'Encerrar sessão após inatividade (horas)', 'seguranca', 'numero', null, 43],
  ['ultimo_backup', '', 'Último backup registrado', 'seguranca', 'data', null, 41],
];

const insSetting = db.prepare(`INSERT OR IGNORE INTO settings (chave, valor, rotulo, grupo, tipo, opcoes, ordem) VALUES (?,?,?,?,?,?,?)`);
for (const s of SETTINGS_PADRAO) insSetting.run(...s);

// Dicionário inicial de categorias. O usuário pode acrescentar ou desativar
// itens na tela Cadastros › Categorias; categorias novas usadas em lançamentos
// ou contas também entram automaticamente, sem obrigar ninguém a configurar
// tudo antes do primeiro uso.
export const CATEGORIAS_PADRAO = [
  ['lancamento', 'Aluguel', 'receita', 'proprietarios', 10],
  ['lancamento', 'Taxa de administração', 'receita', 'imobiliaria', 20],
  ['lancamento', 'Multa e juros', 'receita', 'proprietarios', 30],
  ['lancamento', 'Comissão recebida', 'receita', 'imobiliaria', 40],
  ['lancamento', 'Reembolso', 'receita', 'imobiliaria', 50],
  ['lancamento', 'Outras receitas', 'receita', 'imobiliaria', 90],
  ['lancamento', 'Repasse ao proprietário', 'despesa', 'proprietarios', 10],
  ['lancamento', 'Manutenção', 'despesa', 'proprietarios', 20],
  ['lancamento', 'Condomínio', 'despesa', 'proprietarios', 30],
  ['lancamento', 'IPTU', 'despesa', 'proprietarios', 40],
  ['lancamento', 'Comissão de corretagem', 'despesa', 'imobiliaria', 50],
  ['lancamento', 'Pessoal', 'despesa', 'imobiliaria', 60],
  ['lancamento', 'Impostos', 'despesa', 'imobiliaria', 70],
  ['lancamento', 'Marketing', 'despesa', 'imobiliaria', 80],
  ['lancamento', 'Material de escritório', 'despesa', 'imobiliaria', 85],
  ['lancamento', 'Serviços', 'despesa', 'imobiliaria', 86],
  ['lancamento', 'Serviços de terceiros', 'despesa', 'imobiliaria', 87],
  ['lancamento', 'Manutenção de imóvel', 'despesa', 'proprietarios', 21],
  ['lancamento', 'Outras despesas', 'despesa', 'imobiliaria', 90],
  ['conta_pagar', 'Ocupação', 'despesa', 'imobiliaria', 10],
  ['conta_pagar', 'Condomínio', 'despesa', 'proprietarios', 20],
  ['conta_pagar', 'IPTU', 'despesa', 'proprietarios', 30],
  ['conta_pagar', 'Manutenção', 'despesa', 'proprietarios', 40],
  ['conta_pagar', 'Impostos', 'despesa', 'imobiliaria', 50],
  ['conta_pagar', 'Pessoal', 'despesa', 'imobiliaria', 60],
  ['conta_pagar', 'Comissão de corretagem', 'despesa', 'imobiliaria', 70],
  ['conta_pagar', 'Marketing', 'despesa', 'imobiliaria', 80],
  ['conta_pagar', 'Serviços', 'despesa', 'imobiliaria', 85],
  ['conta_pagar', 'Manutenção de imóvel', 'despesa', 'proprietarios', 42],
  ['conta_pagar', 'Serviços de terceiros', 'despesa', 'imobiliaria', 86],
  ['conta_pagar', 'Outros', 'despesa', 'imobiliaria', 90],
  ['conta_receber', 'Aluguel', 'receita', 'proprietarios', 10],
  ['conta_receber', 'Taxa de administração', 'receita', 'imobiliaria', 20],
  ['conta_receber', 'Multa e juros', 'receita', 'proprietarios', 30],
  ['conta_receber', 'Comissão recebida', 'receita', 'imobiliaria', 40],
  ['conta_receber', 'Reembolso', 'receita', 'imobiliaria', 50],
  ['conta_receber', 'Outros', 'receita', 'imobiliaria', 90],
];
const insCategoria = db.prepare(`INSERT OR IGNORE INTO categorias (contexto, nome, tipo, caixa, ordem) VALUES (?,?,?,?,?)`);
for (const c of CATEGORIAS_PADRAO) insCategoria.run(...c);

const qtdUsuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
if (qtdUsuarios === 0) {
  // Não existe senha padrão conhecida. A senha inicial vem de ADMIN_SENHA ou é
  // aleatória e exibida uma única vez no terminal da primeira execução.
  const senhaInformada = String(process.env.ADMIN_SENHA || '').trim();
  const senhaInicial = senhaInformada.length >= 8
    ? senhaInformada
    : `Imob-${crypto.randomBytes(9).toString('base64url')}#26`;
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha) VALUES (?,?,?,?,1)')
    .run('Administrador', 'admin@imobiliaria.local', hashSenha(senhaInicial), 'admin');
  if (!senhaInformada) {
    console.log(`\n  Primeiro acesso: admin@imobiliaria.local`);
    console.log(`  Senha inicial gerada: ${senhaInicial}`);
    console.log('  Guarde-a e troque no primeiro login.\n');
  } else {
    console.log('\n  Usuário inicial admin@imobiliaria.local criado com a senha de ADMIN_SENHA.');
  }
}

const qtdProps = db.prepare('SELECT COUNT(*) AS n FROM proprietarios').get().n;
// A base começa vazia sempre: dados de demonstração exigem opt-in explícito.
// Antes o seed acontecia quando NODE_ENV != 'production', o que injetava dados
// fictícios em qualquer deploy que esquecesse de definir as variáveis de
// ambiente. Para demonstrar use `npm run demo*` ou SEED_DEMO=1.
const podeSemearDemo = process.env.SEED_DEMO === '1';
if (qtdProps === 0 && podeSemearDemo) seedDemo();

export function seedDemo() {
  const hoje = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDias = (dias) => { const d = new Date(hoje); d.setDate(d.getDate() + dias); return iso(d); };
  const compAtual = iso(hoje).slice(0, 7);

  const insProp = db.prepare(`INSERT INTO proprietarios (nome, cpf_cnpj, email, telefone, endereco, banco, agencia, conta, pix, taxa_admin_pct, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const p1 = Number(insProp.run('Maria Souza', '123.456.789-09', 'maria@exemplo.com', '(11) 98888-1111', 'Rua das Acácias, 45', 'Banco do Brasil', '1234-5', '67890-1', 'maria@exemplo.com', 6, 'Contrato antigo: taxa diferenciada de 6%.').lastInsertRowid);
  const p2 = Number(insProp.run('João Pereira', '987.654.321-00', 'joao@exemplo.com', '(11) 97777-2222', 'Av. Paulista, 1000', 'Itaú', '4321-0', '12345-6', '', null, 'Parceiro da casa: condição especial combinada.').lastInsertRowid);
  const p3 = Number(insProp.run('Ana Lima', '111.222.333-96', 'ana@exemplo.com', '(11) 96666-3333', 'Rua Verde, 12', 'Caixa', '1111-1', '22222-2', '', null, '').lastInsertRowid);

  const insImovel = db.prepare(`INSERT INTO imoveis (proprietario_id, apelido, endereco, numero, complemento, bairro, cidade, uf, cep, tipo, situacao, taxa_admin_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const i1 = Number(insImovel.run(p1, 'Apto 302', 'Rua das Flores', '120', 'Apto 302', 'Centro', 'São Paulo', 'SP', '01000-000', 'apartamento', 'alugado', null).lastInsertRowid);
  const i2 = Number(insImovel.run(p1, 'Casa do Sol', 'Rua do Sol', '9', '', 'Jardim', 'São Paulo', 'SP', '02000-000', 'casa', 'alugado', null).lastInsertRowid);
  const i3 = Number(insImovel.run(p2, 'Sala Central', 'Av. Central', '45', 'Sala 12', 'Centro', 'São Paulo', 'SP', '03000-000', 'comercial', 'alugado', 5).lastInsertRowid);
  const i4 = Number(insImovel.run(p3, 'Apto Verde', 'Rua Verde', '12', 'Apto 71', 'Vila Nova', 'São Paulo', 'SP', '04000-000', 'apartamento', 'alugado', null).lastInsertRowid);

  const insParceiro = db.prepare(`INSERT INTO parceiros (tipo, nome, cpf_cnpj, creci, email, telefone, pix, observacoes) VALUES (?,?,?,?,?,?,?,?)`);
  insParceiro.run('corretor', 'Corretora Horizonte', '11.222.333/0001-81', 'CRECI-SP 12345-J', 'contato@horizonte.com', '(11) 97777-1010', 'contato@horizonte.com', 'Parceira para indicações da zona sul.');
  insParceiro.run('corretor', 'Bruno Almeida', '222.333.444-05', 'CRECI-SP 98765-F', 'bruno@exemplo.com', '(11) 96666-2020', '222.333.444-05', 'Corretor autônomo.');
  insParceiro.run('fornecedor', 'Oficina Hidráulica Silva', '33.444.555/0001-81', null, 'contato@hidraulicasilva.com', '(11) 95555-3030', '33444555000181', 'Manutenção hidráulica e elétrica.');
  insParceiro.run('fornecedor', 'Condomínio Edifício Central', null, null, 'sindico@central.com', '(11) 94444-4040', null, 'Cobrança mensal de condomínio.');
  insParceiro.run('cliente', 'Studio Design Ltda', '12.345.678/0001-95', null, 'contato@studio.com', '(11) 93333-6666', 'contato@studio.com', 'Inquilino comercial, também compra serviços.');

  const insInq = db.prepare(`INSERT INTO inquilinos (nome, cpf_cnpj, email, telefone) VALUES (?,?,?,?)`);
  const q1 = Number(insInq.run('Carlos Mendes', '222.333.444-05', 'carlos@exemplo.com', '(11) 95555-4444').lastInsertRowid);
  const q2 = Number(insInq.run('Fernanda Alves', '333.444.555-08', 'fernanda@exemplo.com', '(11) 94444-5555').lastInsertRowid);
  const q3 = Number(insInq.run('Studio Design Ltda', '12.345.678/0001-95', 'contato@studio.com', '(11) 93333-6666').lastInsertRowid);
  const q4 = Number(insInq.run('Rafael Costa', '444.555.666-19', 'rafael@exemplo.com', '(11) 92222-7777').lastInsertRowid);

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
    insLanc.run(`${comp}-20`, comp, 'despesa', 'Outras despesas', 'Software de gestão', 8000, 'imobiliaria', null, null, null, 'seed');
  }

  insLanc.run(addDias(-5), hojeComp, 'despesa', 'Manutenção', 'Reparo hidráulico', 35000, 'proprietarios', p1, i1, c1, 'seed');
}
