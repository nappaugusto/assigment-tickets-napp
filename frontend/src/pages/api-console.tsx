import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Braces,
  Check,
  Copy,
  FolderKanban,
  Globe2,
  Import,
  KeyRound,
  Plus,
  Play,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Header } from '@/components/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  apiIntegrationsApi,
  type ApiAuthType,
  type ApiChannel,
  type ApiHttpMethod,
  type ApiRequestConfig,
  type ApiRunResponse,
  type SaveApiRequestPayload,
} from '@/lib/api'

interface DraftRequest {
  id: number | null
  name: string
  description: string
  method: ApiHttpMethod
  url: string
  authType: ApiAuthType
  authConfig: Record<string, string>
  queryParams: string
  headersText: string
  variablesText: string
  body: string
}

interface ResponseState {
  result: ApiRunResponse | null
  error: string | null
}

const emptyDraft = (): DraftRequest => ({
  id: null,
  name: 'Nova consulta',
  description: '',
  method: 'GET',
  url: '',
  authType: 'none',
  authConfig: { headerName: 'x-api-key' },
  queryParams: '',
  headersText: '{\n  "Content-Type": "application/json"\n}',
  variablesText: 'externalId=\norderId=\nstoreId=',
  body: '{\n  \n}',
})

const requestToDraft = (request: ApiRequestConfig): DraftRequest => ({
  id: request.id,
  name: request.name,
  description: request.description,
  method: request.method,
  url: request.url,
  authType: request.authType,
  authConfig: request.authConfig ?? {},
  queryParams: request.queryParams,
  headersText: JSON.stringify(request.headers ?? {}, null, 2),
  variablesText: Object.entries(request.variables ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n'),
  body: request.body,
})

const methodBadgeClass: Record<ApiHttpMethod, string> = {
  GET: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-200',
  POST: 'border-sky-500/30 bg-sky-500/12 text-sky-200',
  PUT: 'border-amber-500/30 bg-amber-500/12 text-amber-200',
  PATCH: 'border-violet-500/30 bg-violet-500/12 text-violet-200',
  DELETE: 'border-red-500/30 bg-red-500/12 text-red-200',
}

function parseHeaders(value: string) {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Headers precisa ser um objeto JSON')
  }
  return parsed as Record<string, string>
}

function parseVariables(value: string) {
  const variables: Record<string, string> = {}
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [key, ...valueParts] = line.split('=')
      if (!key.trim()) return
      variables[key.trim()] = valueParts.join('=').trim()
    })
  return variables
}

function tokenizeCurl(input: string) {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input.replace(/\\\r?\n/g, ' ')) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaping = true
      continue
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char
      continue
    }

    if (char === quote) {
      quote = null
      continue
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

function splitHeader(header: string) {
  const index = header.indexOf(':')
  if (index < 0) return null

  return {
    key: header.slice(0, index).trim(),
    value: header.slice(index + 1).trim(),
  }
}

function inferAuth(headers: Record<string, string>): Pick<DraftRequest, 'authType' | 'authConfig'> {
  const authEntry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')
  if (authEntry) {
    const value = authEntry[1]
    if (/^bearer\s+/i.test(value)) {
      delete headers[authEntry[0]]
      return { authType: 'bearer', authConfig: { token: value.replace(/^bearer\s+/i, '') } }
    }
    if (/^basic\s+/i.test(value)) {
      const encoded = value.replace(/^basic\s+/i, '')
      delete headers[authEntry[0]]
      try {
        const [username, ...passwordParts] = atob(encoded).split(':')
        return { authType: 'basic', authConfig: { username, password: passwordParts.join(':') } }
      } catch {
        return { authType: 'basic', authConfig: { username: '', password: '' } }
      }
    }
  }

  const apiKeyEntry = Object.entries(headers).find(([key]) =>
    ['x-api-key', 'apikey', 'api-key'].includes(key.toLowerCase()),
  )
  if (apiKeyEntry) {
    delete headers[apiKeyEntry[0]]
    return {
      authType: 'apiKey',
      authConfig: { headerName: apiKeyEntry[0], value: apiKeyEntry[1] },
    }
  }

  return { authType: 'none', authConfig: { headerName: 'x-api-key' } }
}

function parseCurlToDraft(input: string, currentDraft: DraftRequest): DraftRequest {
  const tokens = tokenizeCurl(input)
  if (tokens[0]?.toLowerCase() === 'curl') tokens.shift()
  if (tokens.length === 0) throw new Error('Cole um comando cURL válido')

  let method: ApiHttpMethod | null = null
  let url = ''
  let body = ''
  let basicAuth = ''
  const headers: Record<string, string> = {}
  const queryParams: string[] = []

  const readValue = (tokensList: string[], index: number, flag: string) => {
    const value = tokensList[index + 1]
    if (!value) throw new Error(`Valor ausente para ${flag}`)
    return value
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]

    if (token === '-X' || token === '--request') {
      const value = readValue(tokens, i, token).toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value)) {
        throw new Error(`Método não suportado: ${value}`)
      }
      method = value as ApiHttpMethod
      i += 1
      continue
    }

    if (token === '-H' || token === '--header') {
      const header = splitHeader(readValue(tokens, i, token))
      if (header?.key) headers[header.key] = header.value
      i += 1
      continue
    }

    if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--form'].includes(token)) {
      body = readValue(tokens, i, token)
      if (!method) method = 'POST'
      i += 1
      continue
    }

    if (token === '-u' || token === '--user') {
      basicAuth = readValue(tokens, i, token)
      i += 1
      continue
    }

    if (token === '-G' || token === '--get') {
      method = 'GET'
      continue
    }

    if (token === '--url') {
      url = readValue(tokens, i, token)
      i += 1
      continue
    }

    if (token === '--compressed' || token === '-s' || token === '-i' || token === '-L') {
      continue
    }

    if (!token.startsWith('-') && /^https?:\/\//i.test(token)) {
      url = token
    }
  }

  if (!url) throw new Error('Não encontrei a URL no cURL')

  const parsedUrl = new URL(url)
  parsedUrl.searchParams.forEach((value, key) => {
    queryParams.push(`${key}=${value}`)
  })
  parsedUrl.search = ''

  let auth = inferAuth(headers)
  if (basicAuth) {
    const [username, ...passwordParts] = basicAuth.split(':')
    auth = {
      authType: 'basic',
      authConfig: { username, password: passwordParts.join(':') },
    }
  }

  return {
    ...currentDraft,
    name: currentDraft.name === 'Nova consulta' ? parsedUrl.pathname.split('/').filter(Boolean).at(-1) ?? 'Nova consulta' : currentDraft.name,
    method: method ?? currentDraft.method,
    url: parsedUrl.toString(),
    authType: auth.authType,
    authConfig: auth.authConfig,
    queryParams: queryParams.join('\n'),
    headersText: JSON.stringify(headers, null, 2),
    variablesText: currentDraft.variablesText,
    body: body || currentDraft.body,
  }
}

export function ApiConsolePage() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [channels, setChannels] = useState<ApiChannel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftRequest>(emptyDraft)
  const [channelName, setChannelName] = useState('')
  const [channelDescription, setChannelDescription] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [curlImportOpen, setCurlImportOpen] = useState(false)
  const [curlImportValue, setCurlImportValue] = useState('')
  const [copied, setCopied] = useState(false)
  const [response, setResponse] = useState<ResponseState>({ result: null, error: null })

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null
  const selectedRequest = selectedChannel?.requests.find((request) => request.id === selectedRequestId) ?? null

  const filteredChannels = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return channels
    return channels.filter((channel) =>
      [channel.name, channel.description, ...channel.requests.map((request) => request.name)].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  }, [channels, search])

  const loadChannels = async (preferredChannelId?: number, preferredRequestId?: number | null) => {
    const data = await apiIntegrationsApi.list()
    setChannels(data.channels)

    const nextChannel =
      data.channels.find((channel) => channel.id === preferredChannelId) ??
      data.channels.find((channel) => channel.id === selectedChannelId) ??
      data.channels[0] ??
      null

    setSelectedChannelId(nextChannel?.id ?? null)
    setChannelName(nextChannel?.name ?? '')
    setChannelDescription(nextChannel?.description ?? '')

    const nextRequest =
      nextChannel?.requests.find((request) => request.id === preferredRequestId) ??
      nextChannel?.requests.find((request) => request.id === selectedRequestId) ??
      nextChannel?.requests[0] ??
      null

    setSelectedRequestId(nextRequest?.id ?? null)
    setDraft(nextRequest ? requestToDraft(nextRequest) : emptyDraft())
  }

  useEffect(() => {
    loadChannels()
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Erro ao carregar APIs'))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const handleSelectChannel = (channel: ApiChannel) => {
    setSelectedChannelId(channel.id)
    setChannelName(channel.name)
    setChannelDescription(channel.description)
    const firstRequest = channel.requests[0] ?? null
    setSelectedRequestId(firstRequest?.id ?? null)
    setDraft(firstRequest ? requestToDraft(firstRequest) : emptyDraft())
    setResponse({ result: null, error: null })
  }

  const handleSelectRequest = (request: ApiRequestConfig) => {
    setSelectedRequestId(request.id)
    setDraft(requestToDraft(request))
    setResponse({ result: null, error: null })
  }

  const handleCreateChannel = async () => {
    try {
      const channel = await apiIntegrationsApi.createChannel('Novo canal', 'Exemplo: iFood, Mercado Livre, Shopify')
      await loadChannels(channel.id, null)
      toast.success('Canal criado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar canal')
    }
  }

  const handleSaveChannel = async () => {
    if (!selectedChannel) return
    try {
      const channel = await apiIntegrationsApi.updateChannel(selectedChannel.id, channelName, channelDescription)
      await loadChannels(channel.id, selectedRequestId)
      toast.success('Canal salvo')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar canal')
    }
  }

  const handleDeleteChannel = async () => {
    if (!selectedChannel) return
    try {
      await apiIntegrationsApi.deleteChannel(selectedChannel.id)
      await loadChannels()
      toast.success('Canal excluído')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao excluir canal')
    }
  }

  const handleNewRequest = () => {
    setSelectedRequestId(null)
    setDraft(emptyDraft())
    setResponse({ result: null, error: null })
  }

  const toPayload = (): SaveApiRequestPayload => ({
    name: draft.name,
    description: draft.description,
    method: draft.method,
    url: draft.url,
    authType: draft.authType,
    authConfig: draft.authConfig,
    queryParams: draft.queryParams,
    headers: parseHeaders(draft.headersText),
    variables: parseVariables(draft.variablesText),
    body: draft.body,
  })

  const handleSaveRequest = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!selectedChannel) {
      toast.error('Crie ou selecione um canal antes de salvar a API')
      return null
    }

    setIsSaving(true)
    try {
      const payload = toPayload()
      const saved = draft.id
        ? await apiIntegrationsApi.updateRequest(draft.id, payload)
        : await apiIntegrationsApi.createRequest(selectedChannel.id, payload)
      await loadChannels(selectedChannel.id, saved.id)
      toast.success('API salva')
      return saved
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar API')
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRequest = async () => {
    if (!draft.id || !selectedChannel) return
    try {
      await apiIntegrationsApi.deleteRequest(draft.id)
      await loadChannels(selectedChannel.id, null)
      toast.success('API excluída')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao excluir API')
    }
  }

  const handleRun = async () => {
    setIsRunning(true)
    setCopied(false)
    setResponse({ result: null, error: null })

    try {
      const saved = draft.id ? null : await handleSaveRequest()
      const requestId = draft.id ?? saved?.id
      if (!requestId) return
      const result = await apiIntegrationsApi.runRequest(requestId)
      setResponse({ result, error: result.ok ? null : 'A API retornou erro HTTP' })
    } catch (error) {
      setResponse({ result: null, error: error instanceof Error ? error.message : 'Erro ao consultar API' })
    } finally {
      setIsRunning(false)
    }
  }

  const handleCopyResponse = async () => {
    await navigator.clipboard.writeText(response.result?.body || response.error || '')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const updateAuthConfig = (key: string, value: string) => {
    setDraft((current) => ({
      ...current,
      authConfig: { ...current.authConfig, [key]: value },
    }))
  }

  const handleImportCurl = () => {
    try {
      setDraft((current) => parseCurlToDraft(curlImportValue, current))
      setCurlImportOpen(false)
      setCurlImportValue('')
      setSelectedRequestId(null)
      setResponse({ result: null, error: null })
      toast.success('cURL importado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao importar cURL')
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.08))]">
      <Header onLogout={handleLogout} />

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid w-full max-w-7xl gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="flex min-h-[calc(100vh-8.5rem)] flex-col rounded-md border border-border/45 bg-card/45 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">
                  Central de APIs
                </p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">Canais</h2>
              </div>
              <Button size="icon" onClick={handleCreateChannel} aria-label="Adicionar canal">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar canal ou API"
                className="pl-9"
              />
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {isLoading ? (
                <span className="text-sm text-muted-foreground">Carregando APIs...</span>
              ) : filteredChannels.length === 0 ? (
                <EmptyState onCreate={handleCreateChannel} />
              ) : (
                filteredChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`rounded-md border ${
                      channel.id === selectedChannelId
                        ? 'border-primary/70 bg-primary/10'
                        : 'border-border/45 bg-background/30'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectChannel(channel)}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{channel.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {channel.requests.length} APIs salvas
                        </span>
                      </span>
                    </button>

                    {channel.id === selectedChannelId && channel.requests.length > 0 && (
                      <div className="border-t border-border/35 p-2">
                        {channel.requests.map((request) => (
                          <button
                            key={request.id}
                            type="button"
                            onClick={() => handleSelectRequest(request)}
                            className={`mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors last:mb-0 ${
                              request.id === selectedRequestId
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                          >
                            <span className="min-w-0 truncate">{request.name}</span>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                                request.id === selectedRequestId
                                  ? 'border-primary-foreground/30'
                                  : methodBadgeClass[request.method]
                              }`}
                            >
                              {request.method}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <form onSubmit={handleSaveRequest} className="flex flex-col gap-4 rounded-md border border-border/45 bg-card/45 p-4">
              <div className="flex flex-col gap-3 border-b border-border/40 pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <Field label="Canal">
                      <Input
                        value={channelName}
                        onChange={(event) => setChannelName(event.target.value)}
                        placeholder="iFood"
                        disabled={!selectedChannel}
                      />
                    </Field>
                    <Field label="Descrição do canal">
                      <Input
                        value={channelDescription}
                        onChange={(event) => setChannelDescription(event.target.value)}
                        placeholder="APIs para pedidos, lojas e entregas"
                        disabled={!selectedChannel}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={handleSaveChannel} disabled={!selectedChannel}>
                      <Save className="h-4 w-4" />
                      Salvar canal
                    </Button>
                    <Button type="button" variant="outline" onClick={handleDeleteChannel} disabled={!selectedChannel}>
                      <Trash2 className="h-4 w-4" />
                      Excluir canal
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-b border-border/40 pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">
                    API do canal
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-foreground">
                    {selectedRequest ? selectedRequest.name : 'Nova consulta'}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={handleNewRequest} disabled={!selectedChannel}>
                    <Plus className="h-4 w-4" />
                    Nova API
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurlImportOpen((open) => !open)}
                    disabled={!selectedChannel}
                  >
                    <Import className="h-4 w-4" />
                    Importar cURL
                  </Button>
                  <Button type="button" variant="outline" onClick={handleDeleteRequest} disabled={!draft.id}>
                    <Trash2 className="h-4 w-4" />
                    Excluir API
                  </Button>
                  <Button type="submit" variant="secondary" disabled={isSaving || !selectedChannel}>
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Salvando' : 'Salvar API'}
                  </Button>
                  <Button type="button" onClick={handleRun} disabled={isRunning || !selectedChannel}>
                    <Play className="h-4 w-4" />
                    {isRunning ? 'Consultando' : 'Consultar'}
                  </Button>
                </div>
              </div>

              {curlImportOpen && (
                <div className="rounded-md border border-border/45 bg-background/30 p-3">
                  <TextAreaField
                    label="cURL"
                    value={curlImportValue}
                    onChange={setCurlImportValue}
                    placeholder={'curl -X POST "https://api.exemplo.com/orders?status=open" \\\n  -H "Authorization: Bearer token" \\\n  -H "Content-Type: application/json" \\\n  --data-raw \'{"page":1}\''}
                    rows={7}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setCurlImportOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleImportCurl}>
                      <Import className="h-4 w-4" />
                      Adaptar
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                <Field label="Nome">
                  <Input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="Listar pedidos"
                  />
                </Field>
                <Field label="Método">
                  <select
                    value={draft.method}
                    onChange={(event) => setDraft({ ...draft, method: event.target.value as ApiHttpMethod })}
                    className="h-9 w-full rounded-md border border-input bg-background/30 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as ApiHttpMethod[]).map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Descrição">
                <Input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Consulta pedidos pendentes do canal"
                />
              </Field>

              <Field label="URL">
                <div className="relative">
                  <Globe2 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                    placeholder="https://api.exemplo.com/v1/orders"
                    className="pl-9"
                  />
                </div>
              </Field>

              <TextAreaField
                label="Variáveis"
                value={draft.variablesText}
                onChange={(value) => setDraft({ ...draft, variablesText: value })}
                placeholder={'externalId=123456\norderId=987654\nstoreId=loja-01'}
                rows={5}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Autenticação">
                  <select
                    value={draft.authType}
                    onChange={(event) => setDraft({ ...draft, authType: event.target.value as ApiAuthType })}
                    className="h-9 w-full rounded-md border border-input bg-background/30 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="none">Nenhuma</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic auth</option>
                    <option value="apiKey">API key no header</option>
                  </select>
                </Field>

                {draft.authType === 'bearer' && (
                  <Field label="Bearer token">
                    <SecretInput value={draft.authConfig.token ?? ''} onChange={(value) => updateAuthConfig('token', value)} />
                  </Field>
                )}

                {draft.authType === 'apiKey' && (
                  <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)] lg:col-span-2">
                    <Field label="Header">
                      <Input
                        value={draft.authConfig.headerName ?? 'x-api-key'}
                        onChange={(event) => updateAuthConfig('headerName', event.target.value)}
                      />
                    </Field>
                    <Field label="API key">
                      <SecretInput value={draft.authConfig.value ?? ''} onChange={(value) => updateAuthConfig('value', value)} />
                    </Field>
                  </div>
                )}

                {draft.authType === 'basic' && (
                  <div className="grid gap-3 md:grid-cols-2 lg:col-span-2">
                    <Field label="Usuário">
                      <Input
                        value={draft.authConfig.username ?? ''}
                        onChange={(event) => updateAuthConfig('username', event.target.value)}
                      />
                    </Field>
                    <Field label="Senha">
                      <SecretInput
                        value={draft.authConfig.password ?? ''}
                        onChange={(value) => updateAuthConfig('password', value)}
                      />
                    </Field>
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <TextAreaField
                  label="Query params"
                  value={draft.queryParams}
                  onChange={(value) => setDraft({ ...draft, queryParams: value })}
                  placeholder={'page=1\nlimit=20'}
                  rows={7}
                />
                <TextAreaField
                  label="Headers"
                  value={draft.headersText}
                  onChange={(value) => setDraft({ ...draft, headersText: value })}
                  placeholder={'{\n  "Accept": "application/json"\n}'}
                  rows={7}
                />
              </div>

              <TextAreaField
                label="Body"
                value={draft.body}
                onChange={(value) => setDraft({ ...draft, body: value })}
                placeholder={'{\n  "campo": "valor"\n}'}
                rows={10}
              />
            </form>

            <ResponsePanel
              response={response}
              copied={copied}
              onCopy={handleCopyResponse}
            />
          </section>
        </div>
      </main>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
      Nenhum canal cadastrado.
      <Button size="sm" className="mt-3 w-full" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Criar canal
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SecretInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-9"
      />
    </div>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  rows: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-input bg-background/30 px-3 py-2 font-mono text-xs leading-relaxed text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

function ResponsePanel({
  response,
  copied,
  onCopy,
}: {
  response: ResponseState
  copied: boolean
  onCopy: () => void
}) {
  return (
    <aside className="flex min-h-[520px] flex-col rounded-md border border-border/45 bg-card/45 p-4">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-primary/85">Resposta</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {response.result ? (
              <Badge variant={response.result.status >= 400 ? 'destructive' : 'success'}>
                {response.result.status} {response.result.statusText}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem consulta</Badge>
            )}
            {response.result && <Badge variant="outline">{response.result.durationMs} ms</Badge>}
          </div>
        </div>
        <Button size="icon" variant="outline" onClick={onCopy} aria-label="Copiar resposta">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      {response.error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-100">
          {response.error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Braces className="h-4 w-4" />
        Body
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border/45 bg-background/55 p-3 text-xs leading-relaxed text-foreground">
        {response.result?.body || 'A resposta da consulta aparecerá aqui.'}
      </pre>

      {response.result?.headers && (
        <>
          <div className="mb-3 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Headers
          </div>
          <pre className="max-h-44 overflow-auto rounded-md border border-border/45 bg-background/55 p-3 text-xs leading-relaxed text-muted-foreground">
            {JSON.stringify(response.result.headers, null, 2)}
          </pre>
        </>
      )}
    </aside>
  )
}
