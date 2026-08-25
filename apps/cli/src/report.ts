import type { AnalyzeResult, CharacterReport, TeamReport } from './commands/analyze.js';

const MARK: Readonly<Record<string, string>> = {
  'on-target': '[ok]',
  acceptable: '[~]',
  'off-target': '[!]',
  blocking: '[X]',
};

function renderTeam(team: TeamReport): string[] {
  const lines: string[] = [];
  lines.push(`  ${team.archetypeLabel} (${team.strength}) — ordenado por: ${team.rankedBy}`);
  lines.push(`    time: ${team.members.map((m) => m ?? '(vazio)').join(' + ')}`);
  lines.push(`    ${team.explanation}`);

  // Quem foi para cada slot, por quê, e contra qual variante está sendo
  // julgado (spec §7.3). O motor já escrevia estas linhas; até agora elas
  // morriam antes da tela.
  for (const reason of team.reasons) lines.push(`      · ${reason}`);

  for (const energy of team.energy) {
    const ok = energy.actual >= energy.required ? 'ok' : 'CURTO';
    lines.push(`    energia ${energy.of}: ER ${energy.actual.toFixed(1)} / ${energy.required} (${ok})`);
  }

  for (const finding of team.findings) {
    lines.push(`    ${MARK[finding.status] ?? '[?]'} ${finding.summary}`);
    if (finding.why) lines.push(`         por quê: ${finding.why}`);
    if (finding.caveat) lines.push(`         ressalva: ${finding.caveat}`);
  }
  return lines;
}

function renderCharacter(entry: CharacterReport): string[] {
  const lines: string[] = [];
  lines.push(`${entry.slug} — nível ${entry.level}, C${entry.constellation}`);

  const stats = ['atk', 'critRate_', 'critDMG_', 'enerRech_', 'eleMas']
    .map((k) => (entry.observed[k] === undefined ? null : `${k} ${entry.observed[k]!.toFixed(1)}`))
    .filter((x): x is string => x !== null);
  if (stats.length > 0) lines.push(`  stats: ${stats.join(' · ')}`);

  if (entry.note) lines.push(`  ${entry.note}`);

  if (entry.playableTeams.length > 0) {
    lines.push('  TIMES QUE VOCÊ JOGA HOJE:');
    for (const team of entry.playableTeams) lines.push(...renderTeam(team));
  }
  if (entry.blockedTeams.length > 0) {
    lines.push('  A UM SLOT DE DISTÂNCIA:');
    for (const team of entry.blockedTeams) lines.push(...renderTeam(team));
  }
  // Mesma pergunta ("o que adquirir"), duas respostas possíveis: um
  // candidato NOMEADO (invista nesta pessoa/arma que você já tem ou pode
  // pegar) ou uma LACUNA de papel/elemento (falta alguém desse tipo — o
  // banco não sabe dizer quem, só o que). O rótulo entre colchetes diz qual
  // dos dois está na linha, senão as duas listas se confundem na tela.
  if (entry.acquisitions.length > 0 || entry.coverageGaps.length > 0) {
    lines.push('  O QUE ADQUIRIR:');
    for (const a of entry.acquisitions) lines.push(`    [investir em alguém] ${a.axis} — ${a.summary}`);
    for (const g of entry.coverageGaps) {
      lines.push(
        `    [lacuna sem candidato nomeado, severidade ${g.severity}] ${g.description} ` +
          `(bloqueia: ${g.blockedArchetypes.join(', ')})`,
      );
    }
  }
  return lines;
}

export function renderReport(result: AnalyzeResult): string {
  const header = [
    `Buer — análise ${result.scope === 'account' ? 'da conta' : 'de personagem'}`,
    `dado curado: ${result.datasetSha}`,
    'Isto é COMPARAÇÃO contra alvos curados, não previsão de dano.',
    '',
  ];
  const body = result.characters.flatMap((entry) => [...renderCharacter(entry), '']);
  return [...header, ...body].join('\n');
}
