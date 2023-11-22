import * as vscode from 'vscode';
import { Loam } from '../../core/model/loam';
import { createMatcherAndDataStore } from '../../services/editor';
import { getAttachmentsExtensions, getOrphansConfig } from '../../settings';
import { GroupedResourcesTreeDataProvider } from './utils/grouped-resources-tree-data-provider';
import { ResourceTreeItem, UriTreeItem } from './utils/tree-view-utils';
import { IMatcher } from '../../core/services/datastore';
import { LoamWorkspace } from '../../core/model/workspace';
import { LoamGraph } from '../../core/model/graph';
import { URI } from '../../core/model/uri';
import { imageExtensions } from '../../core/services/attachment-provider';

const EXCLUDE_TYPES = ['image', 'attachment'];
export default async function activate(
  context: vscode.ExtensionContext,
  loamPromise: Promise<Loam>
) {
  const loam = await loamPromise;

  const { matcher } = await createMatcherAndDataStore(
    getOrphansConfig().exclude
  );
  const provider = new OrphanTreeView(
    context.globalState,
    loam.workspace,
    loam.graph,
    matcher
  );

  const treeView = vscode.window.createTreeView('loam-vscode.orphans', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  provider.refresh();
  const baseTitle = treeView.title;
  treeView.title = baseTitle + ` (${provider.nValues})`;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('loam-vscode.orphans', provider),
    provider,
    treeView,
    loam.graph.onDidUpdate(() => {
      provider.refresh();
      treeView.title = baseTitle + ` (${provider.nValues})`;
    })
  );
}

export class OrphanTreeView extends GroupedResourcesTreeDataProvider {
  constructor(
    state: vscode.Memento,
    private workspace: LoamWorkspace,
    private graph: LoamGraph,
    matcher: IMatcher
  ) {
    super('orphans', state, matcher);
  }

  createValueTreeItem = uri => {
    return uri.isPlaceholder()
      ? new UriTreeItem(uri)
      : new ResourceTreeItem(this.workspace.find(uri), this.workspace);
  };

  getUris = () =>
    this.graph
      .getAllNodes()
      .filter(
        uri =>
          !EXCLUDE_TYPES.includes(this.workspace.find(uri)?.type) &&
          this.graph.getBacklinks(uri).length === 0 &&
          this.graph.getLinks(uri).filter(c => !isAttachment(c.target))
            .length === 0
      );
}

function isAttachment(uri: URI) {
  const ext = [...getAttachmentsExtensions(), ...imageExtensions];
  return ext.includes(uri.getExtension());
}
