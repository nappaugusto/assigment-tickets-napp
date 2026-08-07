import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/;

interface K8sMetadata {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
}

interface K8sContainerStatus {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: Record<string, unknown>;
}

interface K8sPod {
  metadata?: K8sMetadata & {
    labels?: Record<string, string>;
  };
  spec?: {
    nodeName?: string;
    containers?: Array<{ name?: string }>;
  };
  status?: {
    phase?: string;
    podIP?: string;
    containerStatuses?: K8sContainerStatus[];
    startTime?: string;
  };
}

interface K8sWorkload {
  kind?: string;
  metadata?: K8sMetadata;
  spec?: {
    replicas?: number;
    desiredNumberScheduled?: number;
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
    numberReady?: number;
    desiredNumberScheduled?: number;
  };
}

interface K8sEvent {
  metadata?: K8sMetadata;
  type?: string;
  reason?: string;
  message?: string;
  lastTimestamp?: string;
  eventTime?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
  };
}

interface KubectlList<T> {
  items?: T[];
}

interface ExecFailure extends Error {
  code?: string | number;
  stderr?: string;
}

@Injectable()
export class OpsService {
  async getOverview() {
    const namespace = this.getNamespace();
    const namespaceScope = this.getNamespaceScopeArgs();
    const [client, workloads, pods, events] = await Promise.all([
      this.runJson<Record<string, unknown>>(['version', '--client', '--output=json']),
      this.runJson<KubectlList<K8sWorkload>>([
        'get',
        'deployments,statefulsets,daemonsets',
        ...namespaceScope,
        '-o',
        'json',
      ]),
      this.runJson<KubectlList<K8sPod>>([
        'get',
        'pods',
        ...namespaceScope,
        '-o',
        'json',
      ]),
      this.runJson<KubectlList<K8sEvent>>([
        'get',
        'events',
        ...namespaceScope,
        '--sort-by=.lastTimestamp',
        '-o',
        'json',
      ]),
    ]);

    const mappedPods = (pods.items ?? []).map((pod) => this.mapPod(pod));
    const mappedWorkloads = (workloads.items ?? []).map((workload) =>
      this.mapWorkload(workload),
    );

    return {
      namespace,
      allNamespaces: this.shouldUseAllNamespaces(),
      context: process.env.K8S_CONTEXT?.trim() || null,
      kubectl: this.getKubectlBin(),
      clientVersion: client.clientVersion ?? client,
      summary: {
        pods: mappedPods.length,
        readyPods: mappedPods.filter((pod) => pod.ready).length,
        workloads: mappedWorkloads.length,
        warnings: (events.items ?? []).filter((event) => event.type === 'Warning')
          .length,
      },
      workloads: mappedWorkloads,
      pods: mappedPods,
      events: (events.items ?? []).slice(-25).reverse().map((event) => ({
        type: event.type ?? 'Normal',
        reason: event.reason ?? '',
        message: event.message ?? '',
        object: [event.involvedObject?.kind, event.involvedObject?.name]
          .filter(Boolean)
          .join('/'),
        at:
          event.lastTimestamp ??
          event.eventTime ??
          event.metadata?.creationTimestamp ??
          null,
      })),
    };
  }

  async getLogs(query: {
    pod?: string;
    namespace?: string;
    container?: string;
    tail?: string;
    previous?: string;
  }) {
    const namespace = query.namespace?.trim() || this.getNamespace();
    const pod = query.pod?.trim();
    const container = query.container?.trim();
    const tail = Number(query.tail ?? 200);
    const previous = query.previous === 'true' || query.previous === '1';

    if (!pod || !NAME_PATTERN.test(pod)) {
      throw new BadRequestException('Pod inválido.');
    }
    if (!namespace || !NAME_PATTERN.test(namespace)) {
      throw new BadRequestException('Namespace inválido.');
    }
    if (container && !NAME_PATTERN.test(container)) {
      throw new BadRequestException('Container inválido.');
    }
    if (!Number.isInteger(tail) || tail < 20 || tail > 1000) {
      throw new BadRequestException('Tail precisa ficar entre 20 e 1000 linhas.');
    }

    const args = ['logs', pod, '-n', namespace, '--tail', String(tail)];
    if (container) args.push('-c', container);
    if (previous) args.push('--previous');
    const logs = await this.runText(args);
    return { namespace, pod, container: container || null, tail, previous, logs };
  }

  private mapPod(pod: K8sPod) {
    const statuses = pod.status?.containerStatuses ?? [];
    const containers =
      statuses.length > 0
        ? statuses.map((status) => ({
            name: status.name ?? '',
            ready: !!status.ready,
            restarts: status.restartCount ?? 0,
            state: Object.keys(status.state ?? {})[0] ?? 'unknown',
          }))
        : (pod.spec?.containers ?? []).map((container) => ({
            name: container.name ?? '',
            ready: false,
            restarts: 0,
            state: 'unknown',
          }));

    return {
      namespace: pod.metadata?.namespace ?? '',
      name: pod.metadata?.name ?? '',
      phase: pod.status?.phase ?? 'Unknown',
      ready:
        containers.length > 0 &&
        containers.every((container) => container.ready) &&
        pod.status?.phase === 'Running',
      restarts: containers.reduce((sum, container) => sum + container.restarts, 0),
      node: pod.spec?.nodeName ?? '',
      ip: pod.status?.podIP ?? '',
      age: pod.status?.startTime ?? pod.metadata?.creationTimestamp ?? null,
      containers,
    };
  }

  private mapWorkload(workload: K8sWorkload) {
    const desired =
      workload.spec?.replicas ??
      workload.spec?.desiredNumberScheduled ??
      workload.status?.desiredNumberScheduled ??
      0;
    const ready =
      workload.status?.readyReplicas ??
      workload.status?.numberReady ??
      workload.status?.availableReplicas ??
      0;

    return {
      kind: workload.kind ?? '',
      namespace: workload.metadata?.namespace ?? '',
      name: workload.metadata?.name ?? '',
      desired,
      ready,
      updated: workload.status?.updatedReplicas ?? null,
      available: workload.status?.availableReplicas ?? ready,
      age: workload.metadata?.creationTimestamp ?? null,
      healthy: desired === ready,
    };
  }

  private getNamespace() {
    return process.env.K8S_NAMESPACE?.trim() || 'default';
  }

  private shouldUseAllNamespaces() {
    return ['1', 'true', 'yes', 'sim'].includes(
      (process.env.K8S_ALL_NAMESPACES ?? '').trim().toLowerCase(),
    );
  }

  private getNamespaceScopeArgs() {
    if (this.shouldUseAllNamespaces()) return ['-A'];
    return ['-n', this.getNamespace()];
  }

  private getKubectlBin() {
    return process.env.KUBECTL_BIN?.trim() || 'kubectl';
  }

  private getBaseArgs() {
    const args: string[] = [];
    const context = process.env.K8S_CONTEXT?.trim();
    if (context) args.push('--context', context);
    return args;
  }

  private async runJson<T>(args: string[]) {
    const output = await this.runText(args);
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new BadRequestException('kubectl retornou JSON inválido.');
    }
  }

  private async runText(args: string[]) {
    try {
      const { stdout } = await execFileAsync(
        this.getKubectlBin(),
        [...this.getBaseArgs(), ...args],
        {
          timeout: 15_000,
          maxBuffer: 1024 * 1024 * 5,
          env: process.env,
        },
      );
      return stdout;
    } catch (error) {
      throw new BadRequestException(this.formatKubectlError(error));
    }
  }

  private formatKubectlError(error: unknown) {
    const failure = error as ExecFailure;
    const stderr = failure?.stderr?.trim();
    const message =
      stderr || (error instanceof Error ? error.message : 'Erro ao executar kubectl.');

    if (failure?.code === 'ENOENT') {
      return [
        `Não encontrei o binário "${this.getKubectlBin()}" no servidor do backend.`,
        'Instale o kubectl ou configure KUBECTL_BIN apontando para o caminho correto.',
      ].join(' ');
    }

    if (/Unauthorized|forbidden|Forbidden|RBAC/i.test(message)) {
      return [
        'O backend conseguiu chamar o cluster, mas não tem permissão para ler esse recurso.',
        'Revise o RBAC para permitir get/list/watch em pods, pods/log, workloads e events no namespace configurado.',
        `Detalhe: ${message}`,
      ].join(' ');
    }

    if (
      /context .* does not exist|no context exists|current-context|KUBECONFIG|config/i.test(
        message,
      )
    ) {
      return [
        'O backend não encontrou um kubeconfig/contexto Kubernetes válido.',
        'Configure KUBECONFIG e, se necessário, K8S_CONTEXT no ambiente do backend.',
        `Detalhe: ${message}`,
      ].join(' ');
    }

    return message;
  }
}
