export type AdapterCapability =
  | 'launch'
  | 'observe'
  | 'input'
  | 'screenshot'
  | 'telemetry'
  | 'instrumentation';

export interface GameAdapter {
  id: string;
  displayName: string;
  capabilities: AdapterCapability[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
