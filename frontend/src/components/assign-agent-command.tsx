import { useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

interface AssignAgentCommandProps {
  agentOptions: string[]
  onAssign: (responsavel: string) => void
  autoFocus?: boolean
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase()
}

export function AssignAgentCommand({ agentOptions, onAssign, autoFocus }: AssignAgentCommandProps) {
  const [search, setSearch] = useState('')
  const customName = search.trim()

  const hasExactOption = useMemo(() => {
    const normalizedCustomName = normalizeName(customName)
    if (!normalizedCustomName) return false

    return agentOptions.some((name) => normalizeName(name) === normalizedCustomName)
  }, [agentOptions, customName])

  const canUseCustomName = customName.length > 0 && !hasExactOption

  return (
    <Command>
      <CommandInput
        placeholder="Buscar ou digitar responsável..."
        value={search}
        onValueChange={setSearch}
        autoFocus={autoFocus}
      />
      <CommandList>
        <CommandEmpty>Nenhum agente encontrado</CommandEmpty>
        {canUseCustomName && (
          <CommandGroup>
            <CommandItem value={customName} onSelect={() => onAssign(customName)}>
              <UserPlus className="mr-2 h-3.5 w-3.5" />
              Usar "{customName}"
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup>
          {agentOptions.map((name) => (
            <CommandItem
              key={name}
              value={name}
              onSelect={(val) => onAssign(val)}
            >
              {name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
