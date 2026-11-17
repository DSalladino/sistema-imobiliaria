import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  somenteDigitos, cpfValido, cnpjValido, documentoValido, normalizarDocumento,
  formatarCpf, formatarCnpj, validarDocumentoObrigatorio,
} from '../src/validacao.js';

test('somenteDigitos remove máscara e preserva o valor', () => {
  assert.equal(somenteDigitos('123.456.789-09'), '12345678909');
  assert.equal(somenteDigitos('12.345.678/0001-95'), '12345678000195');
  assert.equal(somenteDigitos(null), '');
});

test('CPF: aceita documentos com dígito verificador correto', () => {
  for (const doc of ['111.444.777-35', '529.982.247-25', '390.533.447-05', '123.456.789-09']) {
    assert.equal(cpfValido(doc), true, doc);
  }
});

test('CPF: rejeita tamanho errado, sequência repetida e dígito adulterado', () => {
  assert.equal(cpfValido('123'), false);
  assert.equal(cpfValido('000.000.000-00'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('111.444.777-36'), false);
  assert.equal(cpfValido(''), false);
  assert.equal(cpfValido(null), false);
});

test('CNPJ: valida e rejeita com dígito adulterado', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('45.723.174/0001-10'), true);
  assert.equal(cnpjValido('12.345.678/0001-95'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('11.111.111/1111-11'), false);
  assert.equal(cnpjValido('123'), false);
});

test('documentoValido distingue ausente, inválido e válido', () => {
  assert.equal(documentoValido(''), null, 'ausente não é erro');
  assert.equal(documentoValido('123'), false);
  assert.equal(documentoValido('111.444.777-35'), true);
  assert.equal(documentoValido('11.222.333/0001-81'), true);
});

test('normalização formata CPF e CNPJ sem perder dígitos', () => {
  assert.equal(formatarCpf('11144477735'), '111.444.777-35');
  assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(normalizarDocumento('11144477735'), '111.444.777-35');
  assert.equal(normalizarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(normalizarDocumento(''), null);
});

test('validarDocumentoObrigatorio lança 400 para inválido e devolve formatado', () => {
  assert.equal(validarDocumentoObrigatorio('11144477735'), '111.444.777-35');
  assert.equal(validarDocumentoObrigatorio(''), null);
  assert.throws(() => validarDocumentoObrigatorio('111.444.777-36'), (e) => e.status === 400);
  assert.throws(() => validarDocumentoObrigatorio('123'), (e) => e.status === 400);
  assert.throws(() => validarDocumentoObrigatorio('', { obrigatorio: true }), (e) => e.status === 400);
});
