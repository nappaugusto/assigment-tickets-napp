import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, Box, RefreshCw, Server, Terminal } from 'lucide-react'
import { Header } from '@/components/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { opsApi, type OpsK8sPod } from '@/lib/api'

function formatTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusClass(ok: boolean) {
  return ok
    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-200'
    : 'border-amber-500/35 bg-amber-500/12 text-amber-200'
}

function getPodKey(pod: OpsK8sPod) {
  return `${pod.namespace}/${pod.name}`
}

export function OpsPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [selectedPodKey, setSelectedPodKey] = useState('')
  const [selectedContainer, setSelectedContainer] = useState('')
  const [tail, setTail] = useState(200)
  const [previousLogs, setPreviousLogs] = useState(false)

  const overview = useQuery({
    queryKey: ['ops', 'k8s', 'overview'],
    queryFn: opsApi.k8sOverview,
    refetchInterval: 30_000,
  })

  const pods = useMemo(() => overview.data?.pods ?? [], [overview.data?.pods])
  const currentPod = pods.find((pod) => getPodKey(pod) === selectedPodKey) ?? null
  const containerOptions = currentPod?.containers ?? []

  const logs = useQuery({
    queryKey: ['ops', 'k8s', 'logs', currentPod?.namespace, currentPod?.name, selectedContainer, tail, previousLogs],
    queryFn: () =>
      opsApi.k8sLogs(
        currentPod?.name ?? '',
        currentPod?.namespace ?? '',
        selectedContainer || undefined,
        tail,
        previousLogs,
      ),
    enabled: !!currentPod,
    staleTime: 0,
  })

  const unhealthyPods = useMemo(
    () => pods.filter((pod) => !pod.ready || pod.restarts > 0),
    [pods],
  )

  useEffect(() => {
    if (!selectedPodKey && pods[0]) setSelectedPodKey(getPodKey(pods[0]))
  }, [pods, selectedPodKey])

  useEffect(() => {
    setSelectedContainer('')
  }, [selectedPodKey])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.08))]">
      <Header onLogout={handleLogout} />

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <section className="flex flex-col gap-3 border-b border-border/45 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">
                Kubernetes
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">
                Operacao do cluster
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Namespace {overview.data?.allNamespaces ? 'todos' : overview.data?.namespace ?? 'K8S_NAMESPACE/default'}
                {overview.data?.context ? ` · ${overview.data.context}` : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => overview.refetch()}
              disabled={overview.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${overview.isFetching ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </section>

          {overview.error && (
            <section className="rounded-md border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
              <p className="font-medium">
                {overview.error instanceof Error
                  ? overview.error.message
                  : 'Nao foi possivel consultar o cluster.'}
              </p>
              <div className="mt-3 rounded-md border border-red-200/15 bg-background/35 p-3 text-xs leading-relaxed text-red-50/85">
                <p>Para listar pods e logs, o backend precisa executar kubectl com acesso ao cluster.</p>
                <p className="mt-2 font-mono">
                  KUBECONFIG=/caminho/para/config K8S_CONTEXT=seu-contexto K8S_ALL_NAMESPACES=true
                </p>
              </div>
            </section>
          )}

          <section className="grid gap-3 md:grid-cols-4">
            <Metric icon={<Box className="h-4 w-4" />} label="Pods prontos" value={`${overview.data?.summary.readyPods ?? 0}/${overview.data?.summary.pods ?? 0}`} />
            <Metric icon={<Server className="h-4 w-4" />} label="Workloads" value={String(overview.data?.summary.workloads ?? 0)} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Avisos" value={String(overview.data?.summary.warnings ?? 0)} />
            <Metric icon={<Terminal className="h-4 w-4" />} label="kubectl" value={overview.data?.kubectl ?? 'kubectl'} />
          </section>

          {unhealthyPods.length > 0 && (
            <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                Pods que merecem atencao
              </div>
              <div className="flex flex-wrap gap-2">
                {unhealthyPods.map((pod) => (
                  <button
                    key={getPodKey(pod)}
                    type="button"
                    onClick={() => setSelectedPodKey(getPodKey(pod))}
                    className="rounded-md border border-amber-500/30 px-3 py-2 text-left text-xs text-amber-50 hover:bg-amber-500/10"
                  >
                    <strong>{pod.name}</strong>
                    <span className="ml-2 text-amber-100/75">
                      {pod.namespace} · {pod.phase} · {pod.restarts} restarts
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="min-w-0 rounded-md border border-border/45 bg-card/45 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-lg font-semibold">Workloads</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    <tr>
                      <th className="pb-3">Tipo</th>
                      <th className="pb-3">Namespace</th>
                      <th className="pb-3">Nome</th>
                      <th className="pb-3">Ready</th>
                      <th className="pb-3">Disponivel</th>
                      <th className="pb-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/45">
                    {(overview.data?.workloads ?? []).map((workload) => (
                      <tr key={`${workload.kind}-${workload.namespace}-${workload.name}`}>
                        <td className="py-3 text-muted-foreground">{workload.kind}</td>
                        <td className="py-3 text-muted-foreground">{workload.namespace}</td>
                        <td className="py-3 font-medium">{workload.name}</td>
                        <td className="py-3">{workload.ready}/{workload.desired}</td>
                        <td className="py-3">{workload.available}</td>
                        <td className="py-3">
                          <Badge className={statusClass(workload.healthy)}>
                            {workload.healthy ? 'Saudavel' : 'Atencao'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="min-w-0 rounded-md border border-border/45 bg-card/45 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Box className="h-4 w-4 text-primary" />
                <h3 className="text-lg font-semibold">Pods</h3>
              </div>
              <div className="flex max-h-[24rem] flex-col gap-2 overflow-auto pr-1">
                {pods.map((pod) => (
                  <PodButton
                    key={getPodKey(pod)}
                    pod={pod}
                    active={selectedPodKey === getPodKey(pod)}
                    onClick={() => setSelectedPodKey(getPodKey(pod))}
                  />
                ))}
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="min-w-0 rounded-md border border-border/45 bg-card/45 p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-primary" />
                    <h3 className="text-lg font-semibold">Logs</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {currentPod ? `${currentPod.namespace}/${currentPod.name}` : 'Selecione um pod'}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[180px_100px_110px_auto]">
                  <Field label="Container">
                    <select
                      value={selectedContainer}
                      onChange={(event) => setSelectedContainer(event.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background/30 px-3 text-sm"
                      disabled={!containerOptions.length}
                    >
                      <option value="">Auto</option>
                      {containerOptions.map((container) => (
                        <option key={container.name} value={container.name}>
                          {container.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Linhas">
                    <select
                      value={tail}
                      onChange={(event) => setTail(Number(event.target.value))}
                      className="h-9 w-full rounded-md border border-input bg-background/30 px-3 text-sm"
                    >
                      {[100, 200, 500, 1000].map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex h-9 items-center gap-2 self-end rounded-md border border-border/45 px-3 text-xs text-muted-foreground">
                    <Checkbox
                      checked={previousLogs}
                      onCheckedChange={(checked) => setPreviousLogs(checked === true)}
                    />
                    Anterior
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => logs.refetch()}
                    disabled={!currentPod || logs.isFetching}
                  >
                    <RefreshCw className={`h-4 w-4 ${logs.isFetching ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/45 bg-background/65 p-3 text-xs leading-relaxed text-muted-foreground">
                {logs.error instanceof Error
                  ? logs.error.message
                  : logs.data?.logs || 'Os logs do pod selecionado aparecem aqui.'}
              </pre>
            </section>

            <section className="min-w-0 rounded-md border border-border/45 bg-card/45 p-4">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" />
                <h3 className="text-lg font-semibold">Eventos recentes</h3>
              </div>
              <div className="flex max-h-[32rem] flex-col gap-3 overflow-auto pr-1">
                {(overview.data?.events ?? []).map((event, index) => (
                  <div key={`${event.object}-${event.reason}-${index}`} className="rounded-md border border-border/45 bg-background/35 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge className={event.type === 'Warning' ? statusClass(false) : statusClass(true)}>
                        {event.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatTime(event.at)}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{event.reason || event.object}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <section className="rounded-md border border-border/45 bg-card/45 p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
        {icon}
      </div>
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </section>
  )
}

function PodButton({
  pod,
  active,
  onClick,
}: {
  pod: OpsK8sPod
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${
        active
          ? 'border-primary/70 bg-primary/15'
          : 'border-border/45 bg-background/35 hover:bg-muted/45'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{pod.name}</span>
        <Badge className={statusClass(pod.ready)}>{pod.phase}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{pod.namespace}</span>
        <span>{pod.containers.filter((container) => container.ready).length}/{pod.containers.length} containers</span>
        <span>{pod.restarts} restarts</span>
        <span>{formatTime(pod.age)}</span>
      </div>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0">
      <Label className="mb-2 block text-xs">{label}</Label>
      {children}
    </label>
  )
}
