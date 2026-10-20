---
atualizado: 2026-10-15
dono: Vinicius André
status: proposta
---

# JiraIA: ferramentas abertas só como referência funcional (clean room)

## Contexto
A diretoria lançou o desafio de construir até o fim de novembro de 2026 as versões internas do
Jira e do Confluence com IA. A proposta é o projeto **JiraIA** (`projetos/jiraia/`).

O Plane é uma ferramenta aberta de gestão de projetos e cobre boa parte do que o Jira e o
Confluence fazem hoje. A licença dele, AGPL-3.0, exige três coisas de quem reaproveita o
código:
- manter os avisos de copyright;
- disponibilizar o código-fonte a quem usa o sistema pela rede;
- licenciar como AGPL tudo o que for construído por cima.

Queremos um produto **da Let's**, com a identidade do Max, sem referência a terceiros e sem
amarras de licença, inclusive se um dia ele virar produto para ECs ou OLs.

## Decisão
O JiraIA é construído **do zero**. O Plane, o Jira, o Confluence e outras ferramentas entram só
como **referência funcional**: funcionalidades, fluxos e conceitos de modelagem. Nenhuma linha de
código, componente, ícone, ilustração ou texto de interface é copiado ou adaptado.

Na prática, o trabalho segue um processo de **clean room**:
1. **Quem estuda** as referências escreve só especificação funcional em
   `projetos/jiraia/`, nunca código.
2. **Quem implementa** trabalha a partir dessas specs e não abre o código do Plane.
3. **Ferramentas de IA** recebem as nossas specs, nunca código do Plane. Pedir a uma IA para
   "reescrever" um arquivo do Plane gera trabalho derivado.
4. Só usamos bibliotecas de terceiros com licença permissiva (MIT, BSD, Apache-2.0). Toda
   dependência nova passa por checagem de licença no CI.

## Alternativas consideradas
- **Fork do Plane com a interface trocada:** é o caminho mais rápido, mas mantém a AGPL e os
  avisos da Plane Software no código. Também obriga a abrir o código se a ferramenta for
  oferecida para fora. Fere o objetivo de ter algo nosso.
- **Híbrido (fork agora, reescrita depois):** dívida dupla. Primeiro operamos um código que não
  conhecemos, depois o reescrevemos sob prazo.
- **Continuar no Jira e no Confluence:** não atende ao desafio nem à economia de longo prazo.

## Consequências
- O prazo do fim de novembro só fecha com um **MVP enxuto**: paridade com o que usamos hoje, não
  com tudo o que Jira, Confluence ou Plane oferecem. O escopo está em
  `projetos/jiraia/escopo-mvp.md`.
- A equipe precisa de disciplina na separação entre quem estuda e quem implementa. O clone do
  Plane fica fora dos repositórios de código do JiraIA.
- O código é 100% da Let's: sem obrigação de abrir fonte e livre para virar produto.
- > TODO: validar o entendimento sobre a licença com o Jurídico (Mariana Benjamin) antes do
  > início da construção.

## Links
- Projeto: `projetos/jiraia/`
- Licença do Plane: AGPL-3.0, arquivo `LICENSE.txt` em github.com/makeplane/plane
