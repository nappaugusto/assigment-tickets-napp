import { useMemo } from 'react'
import { type AssignmentPerson } from '@/lib/api'

interface McpAgentSelectorProps {
  people: AssignmentPerson[]
  onSelect: (person: AssignmentPerson, team: string) => void
  className?: string
}

export function McpAgentSelector({ people, onSelect, className }: McpAgentSelectorProps) {
  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) =>
        (a.businessName || a.email || a.id).localeCompare(b.businessName || b.email || b.id),
      ),
    [people],
  )

  if (sortedPeople.length === 0) return null

  return (
    <select
      className={className ?? 'h-9 rounded-md border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring'}
      defaultValue=""
      onChange={(event) => {
        const [id, teamIndex] = event.target.value.split('::')
        const person = sortedPeople.find((candidate) => candidate.id === id)
        if (!person) return
        const team = person.teams[Number(teamIndex)] ?? person.teams[0] ?? ''
        onSelect(person, team)
        event.target.value = ''
      }}
    >
      <option value="">Usar agente cadastrado...</option>
      {sortedPeople.flatMap((person) => {
        const teams = person.teams.length ? person.teams : ['']
        return teams.map((team, index) => (
          <option key={`${person.id}-${team || 'sem-equipe'}-${index}`} value={`${person.id}::${index}`}>
            {(person.businessName || person.email || person.id)}
            {person.email ? ` - ${person.email}` : ''}
            {team ? ` - ${team}` : ''}
          </option>
        ))
      })}
    </select>
  )
}
