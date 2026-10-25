---
atualizado: 2026-10-25
dono: Stênio Lima
status: proposta
---

# LET’S Wiki: navegação completa, coleções restritas e páginas pessoais

Segunda parte da spec da Wiki (`wiki.md`). Escrita em palavras nossas, como referência funcional
(`decisao-clean-room.md`): diz **o que** cada tela faz e **por quê**, nunca como outra ferramenta
desenha. Quem implementa trabalha só a partir daqui, do sistema visual do painel (skill
`design-principles`, `src/styles/tokens.css`, ADR-0006) e do código atual. Decisões técnicas no
ADR-0034.

## Por que mudar

A primeira versão funciona, mas a navegação é rasa: a barra lateral mostra as coleções e só a árvore
da coleção aberta. Para a Wiki ser o lugar onde a LET’S **procura** o que vale, quem chega precisa ver,
sem cliques, onde está o conhecimento, o que usa sempre, o que abriu por último e o que é seu.

## Acesso: coleções abertas, restritas e pessoais

Hoje toda a LET’S lê tudo (ADR-0012). Isso continua sendo o **padrão**, mas uma coleção pode deixar
de ser aberta.

| Acesso | Quem lê | Quem escreve | Exemplo |
|---|---|---|---|
| **Toda a LET’S** (padrão) | Todos | Donos e editores | Empresa, Operação, Clientes |
| **Restrita** | Só quem recebeu papel (pessoa ou grupo): dono, editor ou leitor | Donos e editores | Comercial, Financeiro, Jurídico, Pessoas |
| **Pessoal** | Só o dono, e quem ele convidar | O dono, e quem ele convidar como editor | Rascunhos, notas de 1:1 |

- Os donos de uma coleção mudam o acesso dela. Passar de aberta para restrita avisa quantas pessoas
  vão perder a leitura.
- **Coleção pessoal:** cada pessoa tem uma, criada na primeira vez que ela usa. Lá tudo é rascunho:
  página pessoal não fica oficial. Para virar oficial, usa-se **Publicar numa coleção**, o mesmo
  caminho que já existe para páginas do Draw: uma cópia como rascunho, que os donos tornam oficial.
- Quem não lê uma coleção **não sabe que ela existe**. Ela não aparece em listas, busca, recentes,
  favoritas, e-mails nem menções, e o endereço dela responde "não encontrado".
- Dado comercial confidencial (camada 2 de `wiki.md`) passa a caber numa coleção restrita. Dado
  pessoal continua proibido em qualquer coleção.
- Conceder e tirar papel, e mudar o acesso, ficam na auditoria (ISO 27001 A.5.15 e A.5.18).

## Barra lateral

De cima para baixo:

1. **Nova página**: botão de destaque. Pergunta onde criar (coleção e, se quiser, página-mãe),
   sugerindo a coleção aberta ou, fora de uma coleção, a pessoal.
2. **Início** e **Todas as coleções**.
3. **Coleções**: as coleções abertas e as restritas que a pessoa lê, cada uma com seu ícone e um
   cadeado nas restritas. Cada uma **expande ali mesmo** e mostra a árvore de páginas, com subpáginas
   também expansíveis. A coleção da página aberta já vem expandida até ela. Uma ação no cabeçalho
   da seção cria coleção (admin da organização).
4. **Favoritas**: páginas que a pessoa marcou com estrela, na ordem em que marcou.
5. **Compartilhadas comigo**: páginas das coleções pessoais de outras pessoas em que ela recebeu papel.
6. **Privadas**: as páginas da sua coleção pessoal.
7. **Revisões**: as páginas de que ela é responsável que estão vencidas ou vencendo, com contador.

Regras:
- Cada seção (3 a 6) **recolhe e expande**, e o estado fica guardado por pessoa neste navegador.
- Seção vazia mostra uma linha discreta que diz o que entra ali, por exemplo "Marque páginas com
  estrela para achá-las aqui".
- Seções longas mostram as 8 primeiras e um "Ver todas".
- No celular, a barra vira gaveta, como hoje no painel.

## Todas as coleções

Uma página com a lista de coleções que a pessoa lê, em **tabela**:

| Coluna | O que mostra |
|---|---|
| Coleção | Ícone e nome; a linha inteira abre a coleção |
| Donos | Avatar e nome do primeiro dono, e "+N" se houver mais |
| Páginas | Quantas páginas não excluídas |
| Oficiais | Quantas são oficiais, e quantas estão com revisão vencida, em destaque |
| Pessoas | Quantas pessoas têm papel (direto ou por grupo); "Toda a LET’S" nas abertas |
| Acesso | Toda a LET’S, Restrita ou Pessoal |
| ⋯ | Favoritar, configurações e pessoas (para donos) |

- **Abas** acima da tabela: Coleções, Recentes (páginas que abri, de todas as coleções) e Favoritas.
- Busca por nome no canto da tabela. O botão "Criar coleção" aparece para admins da organização.
- No celular, a tabela vira lista em cartões (nome, acesso, páginas). Nada rola para o lado.

## Coleção

- **Cabeçalho**: ícone grande, nome, selo de acesso (Toda a LET’S, Restrita ou Pessoal), descrição,
  prazo de revisão e, à direita, busca, filtro e o botão **Nova página** com opções: página em
  branco, pasta e, nas coleções de clientes, ficha de cliente.
- **Tabela de páginas** (as do primeiro nível; quem tem subpáginas expande na própria tabela):

| Coluna | O que mostra |
|---|---|
| Página | Ícone (emoji da página, ou o do tipo) e título |
| Estado | Oficial, Rascunho, Revisar até… ou Revisão vencida |
| Responsável | Avatar e nome |
| Subpáginas | Quantas páginas há abaixo |
| Última atividade | "há 2 horas", "ontem", "há 5 dias" (edição, comentário ou mudança de estado) |
| ⋯ | Favoritar, copiar link, trocar responsável, excluir (conforme o papel) |

- **Filtro** por estado e por responsável ("só as minhas").
- Configurações e Pessoas e papéis ficam no menu ⋯ do cabeçalho, para donos.

## Página

- **Topo fixo**: o caminho completo (coleção › página-mãe › página, cada parte clicável). À direita:
  quem está com a página aberta (avatares), copiar link, estrela de favorita, abrir comentários e o
  menu ⋯ (versões, publicar numa coleção, trocar responsável, excluir).
- **Barra de formatação** logo abaixo do topo, fixa ao rolar.
- **Ícone da página**: um emoji opcional acima do título; clicar troca ou remove.
- **Faixa de estado** (já existe): selo, responsável, datas de revisão e ações. Fica acima do título,
  discreta.
- **Subpáginas**: se a página tem filhas, uma lista delas no fim do conteúdo, para navegar sem a
  barra lateral.
- **Comentários num painel lateral** que abre e fecha pelo topo, com duas abas: **Da página** (gerais)
  e **No texto** (presos a um trecho). Cada trecho comentado aparece citado no alto da conversa. Há
  busca dentro dos comentários. Com o painel fechado, o texto ocupa a largura de leitura.
- **Cards do JiraIA** citados na página aparecem como já aparecem hoje.

## Fora desta parte

- Resumo da página com a Laís (fica para depois).
- Compartilhar uma página só, fora da coleção.
- Página pública ou link externo.

## Critérios de pronto

- Uma pessoa sem papel numa coleção restrita não a vê em nenhuma lista, busca, e-mail ou endereço.
- A barra lateral mostra as seis seções, cada uma recolhível, e a árvore de qualquer coleção expande
  sem sair da página.
- Todas as coleções, coleção e página funcionam em 390px e 820px sem rolar para o lado.
- Favoritar uma página faz ela aparecer em Favoritas na hora.
