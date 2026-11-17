import { db } from './db.js';
import { verificarIntegridadeAuditoria } from './auditoria.js';

/**
 * Diagnóstico da base: procura inconsistências que a interface sozinha não
 * consegue impedir (dados legados, importações, edição direta no SQLite e
 * operações antigas). A saída é somente leitura e inclui amostras para o
 * administrador investigar sem expor a base inteira na tela.
 */

const LIMITE_AMOSTRAS = 12;

function rodar(id, titulo, descricao, severidade, sql, args = []) {
  let linhas = [];
  let erro = null;
  try {
    linhas = db.prepare(sql).all(...args);
  } catch (e) {
    erro = e.message;
  }
  return {
    id,
    titulo,
    descricao,
    severidade,
    total: linhas.length,
    amostras: linhas.slice(0, LIMITE_AMOSTRAS),
    erro,
  };
}

function integridadeSqlite() {
  try {
    const pronto = db.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]);
    const fks = db.prepare('PRAGMA foreign_key_check').all();
    return {
      ok: pronto.every(v => v === 'ok') && fks.length === 0,
      integrity_check: pronto,
      foreign_keys: fks.slice(0, LIMITE_AMOSTRAS),
      total_fk: fks.length,
    };
  } catch (e) {
    return { ok: false, erro: e.message, integrity_check: [], foreign_keys: [], total_fk: 0 };
  }
}

export function diagnosticoBase() {
  const auditoria = verificarIntegridadeAuditoria();
  const banco = integridadeSqlite();

  const checagens = [
    rodar('parceiros_documento', 'Documentos de parceiros duplicados',
      'O mesmo CPF/CNPJ aparece em mais de um cadastro de parceiro.',
      'critico',
      `SELECT replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','') AS documento,
              COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(nome) AS nomes
       FROM parceiros
       WHERE cpf_cnpj IS NOT NULL AND trim(cpf_cnpj) <> ''
       GROUP BY replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','')
       HAVING COUNT(*) > 1`),
    rodar('parceiros_nome', 'Nomes de parceiros ativos repetidos',
      'Dois cadastros ativos com o mesmo nome podem gerar seleção ambígua.',
      'atencao',
      `SELECT lower(trim(nome)) AS nome, COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM parceiros WHERE ativo = 1
       GROUP BY lower(trim(nome)) HAVING COUNT(*) > 1`),
    rodar('pessoas_documento', 'CPF/CNPJ repetido em proprietários ou inquilinos',
      'Documento igual em cadastros diferentes da mesma entidade.',
      'critico',
      `SELECT 'proprietarios' AS entidade, replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','') AS documento,
              COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(nome) AS nomes
       FROM proprietarios
       WHERE cpf_cnpj IS NOT NULL AND trim(cpf_cnpj) <> ''
       GROUP BY replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','')
       HAVING COUNT(*) > 1
       UNION ALL
       SELECT 'inquilinos', replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/',''),
              COUNT(*), GROUP_CONCAT(id), GROUP_CONCAT(nome)
       FROM inquilinos
       WHERE cpf_cnpj IS NOT NULL AND trim(cpf_cnpj) <> ''
       GROUP BY replace(replace(replace(cpf_cnpj,'.',''),'-',''),'/','')
       HAVING COUNT(*) > 1`),
    rodar('categorias_duplicadas', 'Categorias duplicadas (ignorando maiúsculas)',
      'A mesma categoria aparece duas vezes no mesmo contexto.',
      'atencao',
      `SELECT contexto, lower(trim(nome)) AS nome, COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM categorias GROUP BY contexto, lower(trim(nome)) HAVING COUNT(*) > 1`),
    rodar('categorias_invalidas', 'Categorias com tipo, caixa ou contexto inválidos',
      'Valores fora da lista podem sumir das seleções e distorcer relatórios.',
      'atencao',
      `SELECT id, contexto, nome, tipo, caixa FROM categorias
       WHERE contexto NOT IN ('lancamento','conta_pagar','conta_receber')
          OR (tipo IS NOT NULL AND tipo NOT IN ('receita','despesa'))
          OR (caixa IS NOT NULL AND caixa NOT IN ('imobiliaria','proprietarios'))`),
    rodar('contratos_ativos_imovel', 'Imóvel com mais de um contrato ativo',
      'Pode duplicar cobranças, repasses e ocupação da carteira.',
      'critico',
      `SELECT imovel_id, COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(codigo) AS codigos
       FROM contratos WHERE status = 'ativo' GROUP BY imovel_id HAVING COUNT(*) > 1`),
    rodar('contratos_datas', 'Contratos com datas ou valores inválidos',
      'Fim anterior ao início, aluguel negativo ou dia de vencimento fora de 1–31.',
      'critico',
      `SELECT id, codigo, inicio, fim, aluguel_centavos, dia_vencimento FROM contratos
       WHERE (fim IS NOT NULL AND fim < inicio)
          OR aluguel_centavos < 0
          OR dia_vencimento < 1 OR dia_vencimento > 31`),
    rodar('lancamentos_invalidos', 'Lançamentos com tipo, caixa ou valor inválido',
      'Registros assim não entram nos saldos ou entram no caixa errado.',
      'critico',
      `SELECT id, data, competencia, tipo, caixa, categoria, valor_centavos FROM lancamentos
       WHERE status = 'ativo'
         AND (tipo NOT IN ('receita','despesa')
           OR caixa NOT IN ('imobiliaria','proprietarios')
           OR valor_centavos <= 0)`),
    rodar('lancamentos_categoria', 'Lançamentos com categoria fora do dicionário',
      'A categoria digitada não existe no cadastro correspondente e pode não aparecer nas listas.',
      'info',
      `SELECT l.id, l.categoria, l.competencia, l.tipo
       FROM lancamentos l
       WHERE l.status = 'ativo'
         AND NOT EXISTS (
           SELECT 1 FROM categorias c
           WHERE c.contexto = 'lancamento' AND lower(trim(c.nome)) = lower(trim(l.categoria))
         )
       ORDER BY l.competencia DESC, l.id DESC`),
    rodar('contas_orfas', 'Contas com vínculo inexistente',
      'Conta aponta para proprietário, imóvel, contrato ou parceiro que não existe.',
      'critico',
      `SELECT c.id, c.descricao, c.status FROM contas c
       WHERE (c.proprietario_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM proprietarios p WHERE p.id = c.proprietario_id))
          OR (c.imovel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM imoveis i WHERE i.id = c.imovel_id))
          OR (c.contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contratos ct WHERE ct.id = c.contrato_id))
          OR (c.parceiro_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parceiros pc WHERE pc.id = c.parceiro_id))`),
    rodar('lancamentos_orfaos', 'Lançamentos com vínculo inexistente',
      'Lançamento aponta para proprietário, imóvel ou contrato que não existe.',
      'critico',
      `SELECT l.id, l.descricao, l.competencia FROM lancamentos l
       WHERE (l.proprietario_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM proprietarios p WHERE p.id = l.proprietario_id))
          OR (l.imovel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM imoveis i WHERE i.id = l.imovel_id))
          OR (l.contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contratos c WHERE c.id = l.contrato_id))`),
    rodar('contas_pagas_sem_lancamento', 'Contas baixadas sem lançamento financeiro',
      'A baixa foi registrada, mas o lançamento correspondente não existe ou foi removido.',
      'critico',
      `SELECT c.id, c.descricao, c.pago_em, c.lancamento_id FROM contas c
       WHERE c.status = 'paga'
         AND (c.lancamento_id IS NULL OR NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.id = c.lancamento_id))`),
    rodar('contas_duplicadas', 'Contas em aberto duplicadas',
      'Mesmo tipo, descrição, vencimento e valor: provável duplicidade de lançamento.',
      'atencao',
      `SELECT tipo, lower(trim(descricao)) AS descricao, vencimento, valor_centavos,
              COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM contas WHERE status = 'aberta'
       GROUP BY tipo, lower(trim(descricao)), vencimento, valor_centavos
       HAVING COUNT(*) > 1`),
    rodar('contas_competencia', 'Competência da conta diferente do vencimento',
      'Pode deslocar a conta para o mês errado na previsão e nos relatórios.',
      'info',
      `SELECT id, descricao, vencimento, competencia FROM contas
       WHERE competencia <> substr(vencimento, 1, 7)`),
    rodar('lancamentos_duplicados', 'Lançamentos idênticos no mesmo dia',
      'Mesma data, competência, tipo, categoria, valor e vínculo: possível duplicidade.',
      'atencao',
      `SELECT data, competencia, tipo, categoria, valor_centavos, COALESCE(descricao,'') AS descricao,
              COALESCE(proprietario_id,0) AS proprietario_id, COALESCE(contrato_id,0) AS contrato_id,
              COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM lancamentos WHERE status = 'ativo'
       GROUP BY data, competencia, tipo, lower(trim(categoria)), valor_centavos,
                COALESCE(descricao,''), COALESCE(proprietario_id,0), COALESCE(contrato_id,0)
       HAVING COUNT(*) > 1`),
    rodar('cobrancas_duplicadas', 'Cobranças duplicadas por contrato e competência',
      'Deveria ser impedido pela chave única; ocorrências indicam base legada ou edição direta.',
      'critico',
      `SELECT contrato_id, competencia, COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM cobrancas GROUP BY contrato_id, competencia HAVING COUNT(*) > 1`),
    rodar('comissoes_duplicadas', 'Comissões duplicadas',
      'Mesmo contrato, competência e corretor em mais de um registro.',
      'atencao',
      `SELECT contrato_id, competencia, lower(trim(corretor)) AS corretor,
              COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM comissoes GROUP BY contrato_id, competencia, lower(trim(corretor)) HAVING COUNT(*) > 1`),
    rodar('repasses_duplicados', 'Repasses duplicados',
      'Mesmo proprietário e competência em mais de um repasse.',
      'critico',
      `SELECT proprietario_id, competencia, COUNT(*) AS ocorrencias, GROUP_CONCAT(id) AS ids
       FROM repasses GROUP BY proprietario_id, competencia HAVING COUNT(*) > 1`),
    rodar('valores_baixa', 'Baixas com valor inconsistente',
      'Valor baixado maior que o valor da conta ou baixa sem valor.',
      'atencao',
      `SELECT id, descricao, valor_centavos, pago_centavos FROM contas
       WHERE status = 'paga' AND (pago_centavos IS NULL OR pago_centavos <= 0 OR pago_centavos > valor_centavos)`),
  ];

  const porSeveridade = (s) => checagens.filter(c => c.severidade === s && c.total > 0).length;
  const criticas = porSeveridade('critico');
  const atencoes = porSeveridade('atencao');
  const informativas = porSeveridade('info');
  const totalOcorrencias = checagens.reduce((s, c) => s + c.total, 0);

  return {
    gerado_em: new Date().toISOString(),
    ok: banco.ok && auditoria.ok && criticas === 0,
    resumo: {
      checagens: checagens.length,
      criticas,
      atencoes,
      informativas,
      total_ocorrencias: totalOcorrencias,
    },
    banco,
    auditoria,
    checagens,
  };
}
