import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

interface HeaderProps {
  onLogout: () => void
}

export function Header({ onLogout }: HeaderProps) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex min-h-18 items-center justify-between px-4 py-3 md:px-6">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/90">Napp Solutions</span>
          <h1 className="text-xl font-semibold text-foreground">Atribuição de Tickets</h1>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card/80 px-4 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
          <span className="text-sm text-muted-foreground">
            Usuário: <strong className="text-foreground">{user?.name}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5 rounded-full">
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
