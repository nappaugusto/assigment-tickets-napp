import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

interface HeaderProps {
  onLogout: () => void
}

export function Header({ onLogout }: HeaderProps) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <h1 className="text-lg font-semibold text-primary">Atribuição de Tickets</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Usuário: <strong className="text-foreground">{user?.name}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5">
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
