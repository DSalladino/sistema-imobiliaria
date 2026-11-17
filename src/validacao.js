/**
 * Validação de documentos brasileiros (CPF/CNPJ) e normalização de dados
 * cadastrais.
 *
 * O objetivo é impedir que um erro de digitação crie um cadastro duplicado ou
 * que um documento claramente inválido entre na base. A validação é aplicada
 * quando o cadastro é criado/editado pela API; importações legadas continuam
 * possíveis porque a checagem é opt-in pela configuração `validar_documento`.
 */

export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

export function formatarCpf(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length !== 11) return String(digitos ?? '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatarCnpj(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length !== 14) return String(digitos ?? '');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function digitosVerificadores(base, pesos) {
  const soma = base.reduce((acc, n, i) => acc + n * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(valor) {
  const d = somenteDigitos(valor);
  if (d.length !== 11) return false;
  // Sequências repetidas passam no cálculo, mas não são documentos reais.
  if (/^(\d)\1{10}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv1 = digitosVerificadores(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== n[9]) return false;
  const dv2 = digitosVerificadores(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === n[10];
}

export function cnpjValido(valor) {
  const d = somenteDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv1 = digitosVerificadores(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== n[12]) return false;
  const dv2 = digitosVerificadores(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === n[13];
}

export function documentoValido(valor) {
  const d = somenteDigitos(valor);
  if (!d) return null; // ausente não é inválido
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

/** Devolve o documento formatado (CPF ou CNPJ) preservando valores vazios. */
export function normalizarDocumento(valor) {
  const d = somenteDigitos(valor);
  if (!d) return null;
  if (d.length === 11) return formatarCpf(d);
  if (d.length === 14) return formatarCnpj(d);
  return String(valor).trim();
}

export function descreverDocumento(valor) {
  const d = somenteDigitos(valor);
  if (d.length === 11) return 'CPF';
  if (d.length === 14) return 'CNPJ';
  return 'CPF/CNPJ';
}

/**
 * Valida e normaliza o documento. Lança erro 400 com mensagem explicativa
 * quando inválido, para a API devolver ao usuário.
 */
export function validarDocumentoObrigatorio(valor, { obrigatorio = false } = {}) {
  const d = somenteDigitos(valor);
  if (!d) {
    if (obrigatorio) {
      throw Object.assign(new Error('Informe o CPF ou CNPJ.'), { status: 400 });
    }
    return null;
  }
  if (![11, 14].includes(d.length)) {
    throw Object.assign(new Error('CPF deve ter 11 dígitos e CNPJ deve ter 14 dígitos.'), { status: 400 });
  }
  if (!documentoValido(d)) {
    throw Object.assign(new Error('O CPF/CNPJ informado não é válido (dígito verificador não confere).'), { status: 400 });
  }
  return normalizarDocumento(d);
}
