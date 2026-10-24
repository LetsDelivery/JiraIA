---
atualizado: 2026-10-24
dono: Stênio Lima
status: proposta
---

# LET’S Wiki: a fonte da verdade da LET’S

Spec em palavras nossas (clean room, `decisao-clean-room.md`). Nenhuma tela, texto ou componente de
outra ferramenta serve de referência. Decisão técnica: ADR-0033.

## Problema

A LET’S não tem um lugar onde o que vale está escrito. O conhecimento sobre a empresa e sobre cada
cliente fica na cabeça de quem atende, em conversas do Slack e em páginas do Confluence que ninguém
sabe se ainda valem. Quando a pessoa sai ou entra de férias, o conhecimento vai junto.

O LET’S Draw AI resolve **onde escrever**, mas não **em que confiar**: lá, a política oficial e o
rascunho de alguém sobre o mesmo assunto têm o mesmo peso.

## Os três produtos

| Produto | Para quê | Quem escreve | Em que confiar |
|---|---|---|---|
| **JiraIA** | Trabalho: cards, boards, sprints | Times | No estado do card |
| **LET’S Draw AI** | Rascunho, análise, planejamento, quadros | Qualquer membro | Em nada por padrão: é área de trabalho |
| **LET’S Wiki** | Conhecimento oficial da empresa e dos clientes | Donos das coleções | No selo **Oficial**, com dono e data de revisão |

O caminho natural: rascunhar no Draw, publicar na Wiki.

## Conceitos

- **Coleção:** um assunto da empresa (Empresa, Operação, Produto, Pessoas, Clientes…), com um ou mais
  **donos**, que respondem pelo que está nela, e editores. Toda a LET’S lê.
- **Página da wiki:** uma página como as do Draw (editor, versões, comentários, tempo real), dentro de
  uma coleção, com um **responsável** e um estado: **Rascunho** ou **Oficial**.
- **Revisão:** toda página oficial tem uma data até quando vale. O responsável confirma que ela
  continua certa (ou a corrige) e a data anda. Passou da data, a página continua oficial, mas mostra
  **Revisão vencida** para quem lê.
- **Cliente:** uma empresa que contrata a LET’S. Só a empresa contratante; o consumidor final não
  entra na wiki.

## Dados de clientes

| Camada | Exemplos | Na wiki |
|---|---|---|
| Conhecimento sobre o cliente | Como opera conosco, janelas e regras especiais, combinados e SLA em texto, o que sempre dá problema, histórico de decisões | **Sim, primeira versão**, na coleção Clientes |
| Comercial confidencial | Tabela de preço, contrato, faturamento, volume | **Não.** Fica no Google Drive; a página só leva o link. Coleção restrita é onda posterior |
| Dados pessoais | CPF, endereço, telefone ou e-mail pessoal | **Nunca.** Contato aparece por cargo e canal corporativo |

Regra: **a wiki guarda conhecimento, não registros.** O que tem sistema dono (contrato e preço no
Drive) não é copiado; copiar cria duas verdades que divergem.

**Ficha do cliente:** a coleção Clientes cria páginas com estas seções:

1. Resumo: o que é, segmento, desde quando é cliente
2. Operação: como opera conosco, janelas, regras especiais
3. Combinados: SLA e acordos em texto, cada um com data e quem decidiu
4. Atenção: o que costuma dar problema e como resolver
5. Contatos: cargo e canal corporativo, sem dado pessoal
6. Links: pasta do cliente no Drive (contrato, preço), cards no JiraIA, páginas no Draw
7. Histórico: decisões importantes, datadas

## Telas

| Tela | Endereço | O que mostra |
|---|---|---|
| Início | `/wiki` | Caixa "Pergunte ou busque" no centro; as coleções; páginas atualizadas recentemente; para donos e responsáveis, quantas páginas pedem revisão |
| Coleção | `/wiki/{coleção}` | Árvore de páginas, donos, descrição |
| Página | `/wiki/{coleção}/{página}` | Conteúdo com o selo: *Oficial · responsável · revisada em · vale até*. Para quem pode: Confirmar revisão, Tornar oficial |
| Revisões | `/wiki/revisoes` | Páginas de que a pessoa é responsável, vencidas ou vencendo em 14 dias |

Coleções e páginas nascem na própria Wiki; ninguém passa pelo Draw. Por baixo, Wiki e Draw usam o
mesmo motor de páginas (editor, versões, tempo real), como dois produtos sobre o mesmo editor, mas um
não mostra o conteúdo do outro.

A Wiki é a terceira área do painel (ADR-0010): mesmo login, mesma busca, mesmo deploy. O JiraIA e o
Draw ganham o link "LET’S Wiki" na barra lateral, como já têm um para o outro. Celular primeiro
(ADR-0023): a Wiki é muito lida no celular.

## Primeira versão

| # | Funcionalidade |
|---|---|
| W1 | Área `/wiki` com as quatro telas e o link nas barras laterais |
| W2 | Coleções: admin da organização cria e nomeia donos; donos nomeiam editores. Toda a LET’S lê |
| W3 | Página com responsável e estado Rascunho ou Oficial. Donos tornam oficial; editores e responsável editam |
| W4 | Revisão: prazo por coleção (90 dias por padrão); Confirmar revisão; selo de vencida |
| W5 | Aviso: o resumo semanal (segunda, 8h, ADR-0028) lista ao responsável as páginas vencidas ou vencendo |
| W6 | Busca: na Wiki, só a Wiki; na busca geral, páginas oficiais primeiro e com o selo |
| W7 | Coleção Clientes com a ficha do cliente |
| W8 | Atalho "Publicar na Wiki" numa página do Draw, para quem rascunhou lá: copia para uma coleção como Rascunho, com link de volta. O caminho normal é criar direto na Wiki |
| W9 | Toda mudança de estado, responsável, revisão e dono é auditada |

Estado em 2026-10-24: W1 a W9 implementados na branch `feat/lets-wiki`. Na busca geral, os resultados
da Wiki vêm antes dos do Draw; ainda não há ordem entre oficial e rascunho dentro da Wiki.

## Depois

- **Sugerir mudança** em página oficial, aprovada pelo responsável (modelo de propostas, ADR-0019).
- **Laís responde pela Wiki:** pergunta em linguagem natural, resposta citando páginas oficiais,
  responsável e data; avisa quando só achou rascunho ou conteúdo do Draw.
- **Coleção restrita** (Comercial, Financeiro, Jurídico, Pessoas), o que quebra o "todos leem"
  (ADR-0012) e pede ADR próprio.
- **Alerta de dado pessoal:** a Laís avisa ao salvar quando a página parece ter CPF ou telefone.
- Importar do Confluence direto para coleções (hoje a Etapa 8 leva tudo ao Draw).

## Fora

- Dados pessoais de qualquer pessoa, e o consumidor final.
- Cópia de contrato, preço ou faturamento: ficam no Drive.
- Página pública ou acesso de clientes.

## Em aberto

1. **Prazo:** a primeira versão entra no corte de 30/11 ou na onda 2? Ela usa o motor de páginas que
   já existe, mas disputa S5–S6 com a migração.
2. **Coleções iniciais** e seus donos.
3. **Confluence:** quais espaços do Confluence viram coleções, e não espaços do Draw?
