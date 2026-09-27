/** Base error with a stable code so logs and metrics can group failures. */
export class ExtensionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MessagingError extends ExtensionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('MESSAGING', message, options);
  }
}

export class StorageError extends ExtensionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('STORAGE', message, options);
  }
}

export class ConfigurationError extends ExtensionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('CONFIGURATION', message, options);
  }
}
