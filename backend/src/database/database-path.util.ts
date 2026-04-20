import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';

const DEFAULT_DATABASE_FILENAME = 'tickets.db';
const DEFAULT_RELATIVE_DATABASE_PATH = './data/tickets.db';
const DEFAULT_CONTAINER_DATA_DIR = '/data';

function normalizeDirPath(dirPath: string): string {
  const trimmed = dirPath.trim();
  if (!trimmed) return DEFAULT_CONTAINER_DATA_DIR;
  return trimmed;
}

export function resolveDatabasePath(env: NodeJS.ProcessEnv): string {
  const explicitPath = env.DATABASE_PATH?.trim();
  if (explicitPath) return explicitPath;

  const railwayVolumeMountPath = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayVolumeMountPath) {
    return join(
      normalizeDirPath(railwayVolumeMountPath),
      env.DATABASE_FILENAME?.trim() || DEFAULT_DATABASE_FILENAME,
    );
  }

  const configuredDataDir = env.PERSISTENT_DATA_DIR?.trim();
  if (configuredDataDir) {
    return join(
      normalizeDirPath(configuredDataDir),
      env.DATABASE_FILENAME?.trim() || DEFAULT_DATABASE_FILENAME,
    );
  }

  if (existsSync(DEFAULT_CONTAINER_DATA_DIR)) {
    return join(DEFAULT_CONTAINER_DATA_DIR, DEFAULT_DATABASE_FILENAME);
  }

  const filename = env.DATABASE_FILENAME?.trim();
  if (filename) {
    return isAbsolute(filename) ? filename : join('./data', filename);
  }

  return DEFAULT_RELATIVE_DATABASE_PATH;
}
