# Documentação

Esta pasta reúne a documentação do **Sistema de Gestão Imobiliária**. O objetivo
é permitir que uma pessoa entenda o produto, rode o projeto, avalie as decisões
técnicas, opere em produção e evolua o código sem depender de conhecimento tácito.

> **Versão documentada:** 0.8.0 · **Última revisão:** novembro de 2026

## Comece por aqui

| Se você é… | Leia nesta ordem |
|---|---|
| **Recrutador, cliente ou visitante do portfólio** | [README principal](../README.md) → [Demonstração](DEMONSTRACAO.md) → [Estudo de caso](ESTUDO-DE-CASO.md) → [Funcionalidades](FUNCIONALIDADES.md) → [Arquitetura](ARQUITETURA.md) |
| **Desenvolvedor que vai rodar o projeto** | [README principal](../README.md) → [Arquitetura](ARQUITETURA.md) → [Modelo de dados](MODELO-DE-DADOS.md) → [API](API.md) → [Qualidade](QUALIDADE.md) |
| **Pessoa que vai publicar e operar** | [Publicação](../deploy/README.md) → [Operação](OPERACAO.md) → [Checklist de segurança](checklist-seguranca.md) |
| **Revisor de segurança ou LGPD** | [Checklist de segurança](checklist-seguranca.md) → [Política de segurança](../SECURITY.md) → [Arquitetura](ARQUITETURA.md) → [Operação](OPERACAO.md) |
| **Produto / negócio** | [Produto](PRODUTO.md) → [Funcionalidades](FUNCIONALIDADES.md) → [Roadmap](roadmap.md) |

## Mapa dos documentos

| Documento | Para que serve |
|---|---|
| [PRODUTO.md](PRODUTO.md) | Contexto, personas, escopo, jornadas, regras de negócio e glossário |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | Cada funcionalidade explicada: problema, regras e onde encontrar |
| [ARQUITETURA.md](ARQUITETURA.md) | Visão de camadas, fluxos, segurança e limites da arquitetura |
| [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md) | Diagrama ER, dicionário de tabelas e invariantes do banco |
| [API.md](API.md) | Rotas HTTP, autenticação, permissões e exemplos de uso |
| [QUALIDADE.md](QUALIDADE.md) | Estratégia de testes, CI, checklist manual e lacunas conhecidas |
| [OPERACAO.md](OPERACAO.md) | Rotina de produção, backup, restauração e runbooks de incidente |
| [DECISOES.md](DECISOES.md) | Registro de decisões de arquitetura (ADRs) e trade-offs |
| [ESTUDO-DE-CASO.md](ESTUDO-DE-CASO.md) | Narrativa do problema, solução, resultados e aprendizados |
| [DEMONSTRACAO.md](DEMONSTRACAO.md) | Como rodar a demonstração, credenciais, capturas e roteiro do vídeo |
| [ESTADO-ATUAL.md](ESTADO-ATUAL.md) | Fotografia técnica da versão atual, dívidas e próximos passos |
| [roadmap.md](roadmap.md) | Prioridades de evolução em fases |
| [checklist-seguranca.md](checklist-seguranca.md) | Auditoria de 21 pontos com evidências e pendências |
| [AUDITORIA.md](AUDITORIA.md) | Achados da revisão técnica, correções e riscos residuais |
| [Publicação](../deploy/README.md) | Guia prático de VPS, domínio, HTTPS, systemd, backup e go-live |
| [Contribuição](../CONTRIBUTING.md) | Ambiente, padrões, testes e fluxo de pull request |
| [Segurança](../SECURITY.md) | Política de reporte e práticas adotadas |
| [Changelog](../CHANGELOG.md) | Evolução por versão (SemVer) |

## Convenções da documentação

- **Idioma:** português do Brasil, com termos técnicos em inglês quando são o
  nome canônico (ex.: *snapshot*, *rate limit*).
- **Dinheiro:** sempre em centavos no código (`180000` = R$ 1.800,00) e em reais
  na interface.
- **Datas:** `YYYY-MM-DD` no banco e na API; `DD/MM/AAAA` na interface.
- **Competência:** `YYYY-MM` (mês de referência financeira).
- **Status:** documentos descrevem o que existe na versão indicada; itens futuros
  ficam no [roadmap](roadmap.md) e no [changelog](../CHANGELOG.md).
- **Links:** use caminhos relativos para funcionar no GitHub e em forks.

## Como manter

Ao concluir uma alteração que mude comportamento, contrato de API, regra de
negócio, banco ou operação:

1. atualize o documento afetado;
2. registre a mudança no [CHANGELOG](../CHANGELOG.md);
3. se for uma decisão estrutural, adicione um ADR em [DECISOES.md](DECISOES.md);
4. rode `npm run check` e `npm test`.
