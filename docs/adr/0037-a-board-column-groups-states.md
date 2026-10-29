# 37. A board column groups states, and a state can stay off the board

Date: 2026-10-28

## Status

Accepted. Amends escopo-mvp 3.1 (the kanban was one column per state) and ADR-0036 (the migration
brings each project's board as Jira draws it).

## Context

After the migration, TEC's board in JiraIA showed sixteen columns where Jira shows four. A Jira board
is configured apart from the workflow: its "quadro TDV3" puts REVISAR in the EM PROGRESSO column and
CANCELADO in CONCLUÍDO, and leaves BACKLOG, DOWNSTREAM, Design, REFINAMENTO and an old CONCLUIDO off the
board. The workflow keeps every status — ADR-0036 imports them all, merging none — but the people
looking at the board expect the board they know. SDDEC's board groups two statuses too; ORQ's shows one
per status.

## Decision

- **A space may have board columns** (`board_columns`: name and position). Each state names the column
  it shows in (`workflow_states.column_id`). In a space with columns, a state in none stays **off the
  board**: cards can be in it, the backlog, list, search and reports see them, the kanban does not.
- **A space without columns draws one column per state**, as before. Nothing changes for the spaces that
  never had a Jira board.
- **A column lists its states' cards together**, grouped by state in workflow order, and each card shows
  its state when the column holds more than one. **A card dropped on a column** lands in its first state,
  unless it is already in one of the column's states, which it keeps.
- **A state added from the screen in a space with columns gets a column of its own**, at the end, so a
  new state never disappears from the board by surprise.
- **A sub-task is not drawn on the board.** A card type has Jira's sub-task level (`is_subtask`); such a
  card belongs under its parent and stays in the sprint, list and search, as on a Jira board. TEC's
  sprint 18 lists 230 cards in Jira's sprint field, 82 of them sub-tasks that Jira's board does not show.
- **The migration makes the workflow and the board Jira's, exactly.** A space is created with no JiraIA
  template; every status of every issue type of the project becomes a state, in Jira's categories, and
  every issue type a card type. In a space that already existed, a state or type Jira lacks is removed
  when nothing names it, and otherwise kept off the board and reported. Jira's API gives statuses in no
  useful order: they go from not started to done, within a group in the order LET'S wrote for REQ, PRD
  and TEC, then as Jira lists them.
- **The migration brings each board** as Jira configures it: a project with a Jira board gets that
  board's columns; a project without one (a business project) gets one column per status of the issue
  types its board draws (not sub-tasks), in the order above; a column Jira's board lacks is removed. The board
  configuration comes from Jira's agile API, which refuses the importer's scoped token, so it is read
  once by hand into the raw copy (`boards.json`).

## Consequences

- TEC's board shows Jira's four columns, and its current sprint the 146 cards Jira shows — 35, 19, 62
  and 30 per column; the two in BACKLOG are in the sprint but off the board, as in Jira.
- A business project's column order is LET'S's, not read from Jira; PRD's was confirmed equal to
  Jira's on 2026-10-29.
- Editing columns on the screen ("Configurar fluxo") is not built yet: until then, columns come from
  the migration, and a new state gets its own.
- A column's cards are ordered by state, then by rank within the state; Jira orders a column by one
  rank across its statuses.
