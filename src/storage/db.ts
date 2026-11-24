import type { ImportedGame } from '../types';

const DB_NAME = 'flash-rewind';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY = 'state-v1';

export type KeyboardMode = 'numbers' | 'full';

export interface PersistState {
  schemaVersion: number;
  favorites: string[];
  recent: string[];
  settings: { muted: boolean; volume: number; fullscreenHintSeen: boolean };
  /** 每款游戏偏好的虚拟键盘模式（玩家可切换） */
  keyboardModes: Record<string, KeyboardMode>;
  /** 最后一次成功云同步的时间戳（用于比较本地/云端谁更新） */
  cloudSyncedAt?: number;
  imports: ImportedGame[];
  // 仅存元数据；SWF 二进制单独放 importsBlob store
}

const DEFAULT_STATE: PersistState = {
  schemaVersion: 1,
  favorites: [],
  recent: [],
  settings: { muted: false, volume: 1, fullscreenHintSeen: false },
  keyboardModes: {},
  cloudSyncedAt: 0,
  imports: [],
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function loadState(): Promise<PersistState> {
  try {
    const raw = await tx<PersistState | undefined>(STORE, 'readonly', (s) => s.get(KEY));
    if (!raw || raw.schemaVersion !== 1) return { ...DEFAULT_STATE };
    // 兼容老数据：keyboardModes 为后加字段
    return { ...DEFAULT_STATE, ...raw, keyboardModes: raw.keyboardModes ?? {} };
  } catch {
    // IndexedDB 不可用（隐私模式/配额），降级为内存态
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: PersistState): Promise<void> {
  try {
    await tx(STORE, 'readwrite', (s) => s.put(state, KEY));
  } catch (e) {
    console.warn('[storage] save failed (degraded to memory):', e);
  }
}

export async function saveImportBlob(id: string, data: ArrayBuffer): Promise<void> {
  await tx('blobs', 'readwrite', (s) => s.put(data, id));
}

export async function loadImportBlob(id: string): Promise<ArrayBuffer | undefined> {
  return tx<ArrayBuffer | undefined>('blobs', 'readonly', (s) => s.get(id));
}

export async function deleteImportBlob(id: string): Promise<void> {
  await tx('blobs', 'readwrite', (s) => s.delete(id));
}

export function newImportedId(): string {
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function sha256Of(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 元数据导出（只含用户自己导入的原SWF索引与收藏，不含内置游戏二进制） */
export function exportMetadata(state: PersistState): string {
  return JSON.stringify(
    {
      app: 'Flash Rewind',
      exportedAt: new Date().toISOString(),
      schemaVersion: state.schemaVersion,
      favorites: state.favorites,
      imports: state.imports.map(({ id, name, size, sha256, addedAt, plays }) => ({
        id, name, size, sha256, addedAt, plays,
      })),
    },
    null,
    2
  );
}
