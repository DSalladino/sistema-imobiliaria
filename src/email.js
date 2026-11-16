import nodemailer from 'nodemailer';
import { getSetting } from './regras.js';

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: process.env.SMTP_HOST || '',
    port,
    secure: process.env.SMTP_SECURE === '1' || port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || getSetting('email_remetente', '') || '',
  };
}

let transporte = null;

export function emailConfigurado() {
  const c = smtpConfig();
  return !!(c.host && c.from);
}

function transporteAtual() {
  const c = smtpConfig();
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
  }
  return transporte;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailValido(email) {
  const s = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && !/[\r\n]/.test(s);
}

export function montarHtml({ empresa, mensagem, assinatura }) {
  const paragrafos = String(mensagem || '')
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;line-height:1.6;color:#2C3634">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#FAF7F2;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #EFE9E0;border-radius:16px;overflow:hidden">
        <tr><td style="background:#5C8571;padding:22px 26px">
          <div style="color:#ffffff;font-size:17px;font-weight:bold">${esc(empresa)}</div>
          <div style="color:#DCEAE2;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:3px">Mensagem</div>
        </td></tr>
        <tr><td style="padding:26px">
          ${paragrafos}
          ${assinatura ? `<div style="margin-top:22px;padding-top:16px;border-top:1px solid #EFE9E0;color:#6D7A76;font-size:13px;white-space:pre-line">${esc(assinatura)}</div>` : ''}
        </td></tr>
        <tr><td style="background:#FBF8F3;padding:14px 26px;color:#98A29E;font-size:11px">
          Enviado por ${esc(empresa)}. Em caso de dúvida, responda este e-mail.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function enviarEmail({ para, assunto, mensagem }) {
  if (!emailConfigurado()) {
    throw Object.assign(new Error('Envio de e-mail não configurado. Defina SMTP_HOST, SMTP_FROM e, se necessário, SMTP_USER/SMTP_PASS no ambiente.'), { status: 400 });
  }
  if (!emailValido(para)) {
    throw Object.assign(new Error('E-mail do destinatário inválido.'), { status: 400 });
  }
  const assuntoLimpo = String(assunto || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  if (!assuntoLimpo) throw Object.assign(new Error('Informe o assunto do e-mail.'), { status: 400 });
  if (!String(mensagem || '').trim()) throw Object.assign(new Error('Informe a mensagem.'), { status: 400 });

  const empresa = getSetting('imob_nome', 'Imobiliária');
  const nomeRemetente = getSetting('email_remetente_nome', '') || empresa;
  const remetenteSetting = getSetting('email_remetente', '');
  const c = smtpConfig();
  const de = remetenteSetting || c.from;
  const assinatura = getSetting('email_assinatura', '');

  const info = await transporteAtual().sendMail({
    from: `"${nomeRemetente.replace(/["\r\n]/g, '')}" <${de}>`,
    to: para,
    replyTo: de,
    subject: assuntoLimpo,
    text: `${mensagem}\n\n${assinatura}\n\n--\n${empresa}`,
    html: montarHtml({ empresa, mensagem, assinatura }),
  });
  return { messageId: info.messageId, remetente: de };
}
