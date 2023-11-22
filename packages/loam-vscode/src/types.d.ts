import { ExtensionContext } from 'vscode';
import { Loam } from './core/model/loam';

export type LoamFeature = (
  context: ExtensionContext,
  loamPromise: Promise<Loam>
) => Promise<any> | void;
