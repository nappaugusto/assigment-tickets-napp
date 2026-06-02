import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Header } from '@/components/header'
import { InternalCasesPanel } from '@/components/internal-cases-panel'

export function InternalTicketsPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.08))]">
      <Header onLogout={handleLogout} />

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <section className="border-b border-border/40 pb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">Tickets internos</p>
            <h2 className="mt-1 text-2xl font-semibold text-foreground">CMC da Napp</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Abra chamados internos, acompanhe prints e organize o atendimento separado da fila do Movidesk.
            </p>
          </section>

          <InternalCasesPanel />
        </div>
      </main>
    </div>
  )
}
