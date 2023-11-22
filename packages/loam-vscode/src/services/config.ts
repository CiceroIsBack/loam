import { Disposable, workspace } from 'vscode';

export interface ConfigurationMonitor<T> extends Disposable {
  (): T;
}

export const getLoamVsCodeConfig = <T>(key: string, defaultValue?: T): T =>
  workspace.getConfiguration('loam').get(key, defaultValue);

export const updateLoamVsCodeConfig = <T>(key: string, value: T) =>
  workspace.getConfiguration().update('loam.' + key, value);

export const monitorLoamVsCodeConfig = <T>(
  key: string
): ConfigurationMonitor<T> => {
  let value: T = getLoamVsCodeConfig(key);
  const listener = workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('loam.' + key)) {
      value = getLoamVsCodeConfig(key);
    }
  });
  const ret = () => {
    return value;
  };
  ret.dispose = () => listener.dispose();
  return ret;
};
