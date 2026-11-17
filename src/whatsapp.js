import { getSetting } from './regras.js';

/**
 * WhatsApp: link `wa.me` por padrão (sem custo e sem API) e API oficial
 * (WhatsApp Cloud API / Meta) quando as credenciais existem no ambiente.
 * As credenciais ficam fora do banco: WHATSAPP_TOKEN e WHATSAPP_PHONE_ID.
 */

const VERSAO_PADRAO = 'v21.0';

export function credenciaisApi() {
  return {
    token: String(process.env.WHATSAPP_TOKEN || '').trim(),
    phoneId: String(process.env.WHATSAPP_PHONE_ID || '').trim(),
    versao: String(process.env.WHATSAPP_API_VERSION || VERSAO_PADRAO).trim(),
  };
}

export function modoWhatsapp() {
  const modo = String(getSetting('whatsapp_modo', 'link') || 'link').toLowerCase();
  if (modo === 'api' && credenciaisApi().token && credenciaisApi().phoneId) return 'api';
  return 'link';
}

export function apiConfigurada() {
  const c = credenciaisApi();
  return !!(c.token && c.phoneId);
}

/** Normaliza para o formato internacional do WhatsApp (55 + DDD + número). */
export function normalizarTelefone(telefone) {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  const semZero = digitos.replace(/^0+/, '');
  if (semZero.length >= 12 && semZero.length <= 15) return semZero;
  if (semZero.length === 10 || semZero.length === 11) return '55' + semZero;
  if (semZero.length === 8 || semZero.length === 9) return '55' + semZero;
  return semZero;
}

export function linkWhatsapp(telefone, mensagem) {
  const numero = normalizarTelefone(telefone);
  const base = numero ? `https://wa.me/${numero}` : 'https://wa.me/';
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}

export function statusWhatsapp() {
  return {
    modo: modoWhatsapp(),
    api_configurada: apiConfigurada(),
    numero_empresa: String(getSetting('whatsapp_numero', '') || ''),
  };
}

async function enviarPelaApi({ telefone, mensagem, fetchImpl }) {
  const c = credenciaisApi();
  const url = `https://graph.facebook.com/${c.versao}/${c.phoneId}/messages`;
  const corpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefone(telefone),
    type: 'text',
    text: { preview_url: false, body: String(mensagem || '').slice(0, 4096) },
  };
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw Object.assign(new Error('fetch indisponível neste runtime.'), { status: 500 });
  }
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const texto = await resp.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
  if (!resp.ok) {
    const detalhe = dados?.error?.message || texto.slice(0, 200) || `HTTP ${resp.status}`;
    throw Object.assign(new Error(`WhatsApp recusou o envio: ${detalhe}`), { status: 502 });
  }
  return { ok: true, modo: 'api', id: dados?.messages?.[0]?.id || null };
}

/**
 * Envia pelo modo configurado. No modo link não há envio server-side: devolve o
 * link wa.me para o operador abrir, mantendo o registro em `comunicacoes`.
 */
export async function enviarWhatsapp({ telefone, mensagem, fetchImpl } = {}) {
  const numero = normalizarTelefone(telefone);
  if (!numero) throw Object.assign(new Error('Telefone não informado.'), { status: 400 });
  const texto = String(mensagem || '').trim();
  if (!texto) throw Object.assign(new Error('Mensagem vazia.'), { status: 400 });
  if (modoWhatsapp() === 'api') {
    return enviarPelaApi({ telefone: numero, mensagem: texto, fetchImpl });
  }
  return { ok: true, modo: 'link', link: linkWhatsapp(numero, texto) };
}
