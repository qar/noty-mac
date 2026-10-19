import { safeStorage } from 'electron';
import type { LocalAiProgram } from './local-ai-types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('./store') as {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

const ENCRYPTED_PREFIX = 'safe:v1:';
const PLAINTEXT_PREFIX = 'plain:v1:';

export function loadLocalAiPrograms(): unknown[] {
  const stored = store.get('localAiPrograms');
  if (!Array.isArray(stored)) return [];
  return stored.map(revealProgramSecrets);
}

export function saveLocalAiPrograms(programs: readonly LocalAiProgram[]): void {
  store.set('localAiPrograms', programs.map(protectProgramSecrets));
}

function protectProgramSecrets(program: LocalAiProgram): LocalAiProgram {
  return {
    ...program,
    environment: program.environment.map((entry) => ({
      ...entry,
      value: entry.secret ? protectSecret(entry.value) : entry.value,
    })),
    proxy: {
      ...program.proxy,
      httpProxy: protectSecret(program.proxy.httpProxy),
      httpsProxy: protectSecret(program.proxy.httpsProxy),
      allProxy: protectSecret(program.proxy.allProxy),
    },
  };
}

function revealProgramSecrets(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const environment = Array.isArray(value.environment)
    ? value.environment.map((entry) => {
        if (!isRecord(entry)) return entry;
        return {
          ...entry,
          value:
            entry.secret === true && typeof entry.value === 'string'
              ? revealSecret(entry.value)
              : entry.value,
        };
      })
    : value.environment;
  const proxy = isRecord(value.proxy)
    ? {
        ...value.proxy,
        httpProxy: revealPossibleSecret(value.proxy.httpProxy),
        httpsProxy: revealPossibleSecret(value.proxy.httpsProxy),
        allProxy: revealPossibleSecret(value.proxy.allProxy),
      }
    : value.proxy;
  return { ...value, environment, proxy };
}

function protectSecret(value: string): string {
  if (!value) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch (error) {
    console.warn('[local-ai] secure storage unavailable:', error);
  }
  return PLAINTEXT_PREFIX + value;
}

function revealPossibleSecret(value: unknown): unknown {
  return typeof value === 'string' ? revealSecret(value) : value;
}

function revealSecret(value: string): string {
  if (value.startsWith(PLAINTEXT_PREFIX)) {
    return value.slice(PLAINTEXT_PREFIX.length);
  }
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    return safeStorage.decryptString(
      Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64')
    );
  } catch (error) {
    console.warn('[local-ai] failed to decrypt a saved secret:', error);
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
