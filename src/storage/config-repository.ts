import { ConfigurationError, StorageError } from '@/shared/errors';

/** The subset of chrome.storage.StorageArea used by config repositories (injectable for tests). */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LoadedConfig<T> {
  readonly config: T;
  /** true when nothing valid was stored and the defaults are in use. */
  readonly fromDefaults: boolean;
}

export interface ConfigRepository<T> {
  readonly key: string;
  /** `legacy`: explicit legacy area for tests (production uses options.legacyArea). */
  load(area?: KeyValueArea, legacy?: KeyValueArea | null): Promise<LoadedConfig<T>>;
  save(config: T, area?: KeyValueArea): Promise<T>;
  reset(area?: KeyValueArea): Promise<void>;
  watch(onChange: (loaded: LoadedConfig<T>) => void): () => void;
}

/**
 * A versioned, validated config stored in chrome.storage.sync under one key.
 * Reads never throw (invalid or unreadable → defaults); writes validate first,
 * so an invalid config is never stored.
 */
export function createConfigRepository<T>(options: {
  key: string;
  label: string;
  parse: (input: unknown) => T | null;
  defaults: T;
  /**
   * Where another build may have stored this key. Read only when nothing is
   * stored here; a valid value is moved here once.
   */
  legacyArea?: () => KeyValueArea;
}): ConfigRepository<T> {
  const { key, label, parse, defaults } = options;
  const syncArea = (): KeyValueArea => chrome.storage.sync;
  const orDefault = (input: unknown): LoadedConfig<T> => {
    const parsed = parse(input);
    return parsed === null
      ? { config: defaults, fromDefaults: true }
      : { config: parsed, fromDefaults: false };
  };

  return {
    key,
    async load(area, legacy) {
      const target = area ?? syncArea();
      const from =
        legacy !== undefined
          ? legacy
          : area === undefined
            ? (options.legacyArea?.() ?? null)
            : null;
      try {
        const stored = await target.get(key);
        if (key in stored || from === null) return orDefault(stored[key]);
        const old = await from.get(key);
        const parsed = parse(old[key]);
        if (parsed === null) return orDefault(undefined);
        await target.set({ [key]: parsed });
        await from.remove(key);
        return { config: parsed, fromDefaults: false };
      } catch {
        return orDefault(undefined);
      }
    },
    async save(config, area = syncArea()) {
      const valid = parse(config);
      if (valid === null) throw new ConfigurationError(`${label} configuration is invalid`);
      try {
        await area.set({ [key]: valid });
      } catch (cause) {
        throw new StorageError(`Could not save ${label.toLowerCase()} configuration`, { cause });
      }
      return valid;
    },
    async reset(area = syncArea()) {
      try {
        await area.remove(key);
      } catch (cause) {
        throw new StorageError(`Could not reset ${label.toLowerCase()} configuration`, { cause });
      }
    },
    watch(onChange) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName !== 'sync' || !(key in changes)) return;
        onChange(orDefault(changes[key]?.newValue));
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}
