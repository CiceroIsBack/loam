import { IDisposable } from '../common/lifecycle';
import { IDataStore, IMatcher, IWatcher } from '../services/datastore';
import { LoamWorkspace } from './workspace';
import { LoamGraph } from './graph';
import { ResourceParser } from './note';
import { ResourceProvider } from './provider';
import { LoamTags } from './tags';
import { Logger } from '../utils/log';

export interface Services {
  dataStore: IDataStore;
  parser: ResourceParser;
  matcher: IMatcher;
}

export interface Loam extends IDisposable {
  services: Services;
  workspace: LoamWorkspace;
  graph: LoamGraph;
  tags: LoamTags;
}

export const bootstrap = async (
  matcher: IMatcher,
  watcher: IWatcher | undefined,
  dataStore: IDataStore,
  parser: ResourceParser,
  initialProviders: ResourceProvider[],
  defaultExtension: string = '.md'
) => {
  const tsStart = Date.now();

  const workspace = await LoamWorkspace.fromProviders(
    initialProviders,
    dataStore,
    defaultExtension
  );

  const tsWsDone = Date.now();
  Logger.info(`Workspace loaded in ${tsWsDone - tsStart}ms`);

  const graph = LoamGraph.fromWorkspace(workspace, true);
  const tsGraphDone = Date.now();
  Logger.info(`Graph loaded in ${tsGraphDone - tsWsDone}ms`);

  const tags = LoamTags.fromWorkspace(workspace, true);
  const tsTagsEnd = Date.now();
  Logger.info(`Tags loaded in ${tsTagsEnd - tsGraphDone}ms`);

  watcher?.onDidChange(async uri => {
    if (matcher.isMatch(uri)) {
      await workspace.fetchAndSet(uri);
    }
  });
  watcher?.onDidCreate(async uri => {
    await matcher.refresh();
    if (matcher.isMatch(uri)) {
      await workspace.fetchAndSet(uri);
    }
  });
  watcher?.onDidDelete(uri => {
    workspace.delete(uri);
  });

  const loam: Loam = {
    workspace,
    graph,
    tags,
    services: {
      parser,
      dataStore,
      matcher,
    },
    dispose: () => {
      workspace.dispose();
      graph.dispose();
    },
  };

  return loam;
};
