declare module 'vscode' {
  export type Thenable<T> = PromiseLike<T>;

  export interface OutputChannel {
    appendLine(value: string): void;
  }

  export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
  }
}
