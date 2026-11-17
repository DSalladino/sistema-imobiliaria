import { db } from './db.js';
import { getSetting, brl, hojeISO } from './regras.js';
import { obter as obterCobranca } from './cobrancas.js';

/**
 * Pix estático (BR Code / EMV-QRCPS-MPM), sem dependência de PSP.
 * Gera o "copia e cola" a partir da chave cadastrada em Configurações.
 */

const TAMANHO_NOME = 25;
const TAMANHO_CIDADE = 15;
const TAMANHO_TXID = 25;

/** CRC16/CCITT-FALSE, polinômio 0x1021, valor inicial 0xFFFF. */
export function crc16(texto) {
  let crc = 0xffff;
  const bytes = Buffer.from(String(texto), 'utf8');
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function campo(id, valor) {
  const texto = String(valor ?? '');
  return `${id}${String(texto.length).padStart(2, '0')}${texto}`;
}

/** Nome e cidade no BR Code não aceitam acentos e têm limite de caracteres. */
export function textoPix(valor, limite) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,-]/g, '')
    .trim()
    .slice(0, limite)
    .toUpperCase();
}

/** O txid aceita apenas letras e números, até 25 caracteres. */
export function normalizarTxid(valor, padrao = '***') {
  const limpo = String(valor ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, TAMANHO_TXID);
  return limpo || padrao;
}

export function valorPix(centavos) {
  const n = Math.max(Number(centavos) || 0, 0);
  return (n / 100).toFixed(2);
}

export function pixPayload({ chave, nome, cidade, valorCentavos = 0, txid = '***', descricao = '' }) {
  if (!chave || !String(chave).trim()) {
    throw Object.assign(new Error('Cadastre a chave Pix em Configurações → Integrações.'), { status: 409 });
  }
  const conta =
    campo('00', 'br.gov.bcb.pix') +
    campo('01', String(chave).trim()) +
    (descricao ? campo('02', textoPix(descricao, 40)) : '');
  let payload =
    campo('00', '01') +
    campo('01', '12') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (valorCentavos > 0 ? campo('54', valorPix(valorCentavos)) : '') +
    campo('58', 'BR') +
    campo('59', textoPix(nome || 'RECEBEDOR', TAMANHO_NOME) || 'RECEBEDOR') +
    campo('60', textoPix(cidade || 'SAO PAULO', TAMANHO_CIDADE) || 'SAO PAULO') +
    campo('62', campo('05', normalizarTxid(txid)));
  payload += '6304';
  return payload + crc16(payload);
}

export function configuracaoPix() {
  return {
    chave: String(getSetting('pix_chave', '') || '').trim(),
    recebedor: String(getSetting('pix_recebedor', '') || '').trim(),
    cidade: String(getSetting('pix_cidade', '') || '').trim(),
  };
}

export function pixConfigurado() {
  return !!configuracaoPix().chave;
}

/** Txid determinístico: permite conciliar o Pix recebido com a cobrança. */
export function txidDaCobranca(cobranca) {
  const competencia = String(cobranca.competencia || '').replace('-', '');
  return normalizarTxid(`IMOB${cobranca.id}${competencia}`, `IMOB${cobranca.id}`);
}

export function pixDaCobranca(id) {
  const cobranca = obterCobranca(Number(id));
  if (!cobranca) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if (cobranca.status === 'cancelado') throw Object.assign(new Error('Cobrança cancelada não gera Pix.'), { status: 409 });
  if (cobranca.status === 'pago' || cobranca.saldo_centavos <= 0) {
    throw Object.assign(new Error('Esta cobrança já está quitada.'), { status: 409 });
  }
  const cfg = configuracaoPix();
  const txid = txidDaCobranca(cobranca);
  const payload = pixPayload({
    chave: cfg.chave,
    nome: cfg.recebedor || getSetting('imob_nome', 'Imobiliaria'),
    cidade: cfg.cidade,
    valorCentavos: cobranca.saldo_centavos,
    txid,
    descricao: cobranca.contrato_codigo ? `ALUGUEL ${cobranca.contrato_codigo}` : 'ALUGUEL',
  });
  return {
    cobranca_id: cobranca.id,
    competencia: cobranca.competencia,
    vencimento: cobranca.vencimento,
    inquilino: cobranca.inquilino_nome,
    imovel: `${cobranca.endereco || ''}${cobranca.numero ? ', ' + cobranca.numero : ''}`,
    valor_centavos: cobranca.saldo_centavos,
    valor_formatado: brl(cobranca.saldo_centavos),
    txid,
    chave: cfg.chave,
    recebedor: cfg.recebedor || getSetting('imob_nome', 'Imobiliaria'),
    cidade: cfg.cidade,
    payload,
    gerado_em: hojeISO(),
    mensagem: `Olá, ${cobranca.inquilino_nome}! Segue o Pix de ${brl(cobranca.saldo_centavos)} referente a ${cobranca.competencia} (${cobranca.endereco || 'imóvel'}). Vencimento ${cobranca.vencimento}.\n\nPix copia e cola:\n${payload}`,
  };
}

/** Lista de Pix pendentes da competência — útil para cobrança em lote. */
export function pixDoMes(competencia) {
  const cobrancas = db.prepare(`SELECT id FROM cobrancas
    WHERE competencia = ? AND status IN ('em_aberto','pago_parcial') ORDER BY vencimento`).all(competencia);
  return cobrancas.map(c => pixDaCobranca(c.id));
}
