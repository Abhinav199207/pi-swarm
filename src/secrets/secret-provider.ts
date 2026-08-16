export interface SecretProvider {
  resolve(secretRef: string): Promise<string>;
}
