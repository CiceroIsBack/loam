import * as vscode from 'vscode';
import { Loam } from '../../core/model/loam';
import { LoamWorkspace } from '../../core/model/workspace';
import {
  ResourceRangeTreeItem,
  ResourceTreeItem,
  createBacklinkItemsForResource as createBacklinkTreeItemsForResource,
  expandAll,
} from './utils/tree-view-utils';
import { Resource } from '../../core/model/note';
import { LoamGraph } from '../../core/model/graph';
import { ContextMemento } from '../../utils/vsc-utils';
import {
  FolderTreeItem,
  FolderTreeProvider,
} from './utils/folder-tree-provider';

export default async function activate(
  context: vscode.ExtensionContext,
  loamPromise: Promise<Loam>
) {
  const loam = await loamPromise;
  const provider = new NotesProvider(
    loam.workspace,
    loam.graph,
    context.globalState
  );
  provider.refresh();
  const treeView = vscode.window.createTreeView<NotesTreeItems>(
    'loam-vscode.notes-explorer',
    {
      treeDataProvider: provider,
      showCollapseAll: true,
      canSelectMany: true,
    }
  );
  const revealTextEditorItem = async () => {
    const target = vscode.window.activeTextEditor?.document.uri;
    if (treeView.visible) {
      if (target) {
        const item = await findTreeItemByUri(provider, target);
        // Check if the item is already selected.
        // This check is needed because always calling reveal() will
        // cause the tree view to take the focus from the item when
        // browsing the notes explorer
        if (
          item &&
          !treeView.selection.find(
            i => i.resourceUri?.path === item.resourceUri.path
          )
        ) {
          treeView.reveal(item);
        }
      }
    }
  };

  context.subscriptions.push(
    treeView,
    provider,
    loam.graph.onDidUpdate(() => {
      provider.refresh();
    }),
    vscode.commands.registerCommand(
      `loam-vscode.views.notes-explorer.expand-all`,
      (...args) =>
        expandAll(treeView, provider, node => node.contextValue === 'folder')
    ),
    vscode.window.onDidChangeActiveTextEditor(revealTextEditorItem),
    treeView.onDidChangeVisibility(revealTextEditorItem)
  );
}

export function findTreeItemByUri<I, T>(
  provider: FolderTreeProvider<I, T>,
  target: vscode.Uri
) {
  const path = vscode.workspace.asRelativePath(
    target,
    vscode.workspace.workspaceFolders.length > 1
  );
  return provider.findTreeItemByPath(path.split('/'));
}

export type NotesTreeItems =
  | ResourceTreeItem
  | FolderTreeItem<Resource>
  | ResourceRangeTreeItem;

export class NotesProvider extends FolderTreeProvider<
  NotesTreeItems,
  Resource
> {
  public show = new ContextMemento<'all' | 'notes-only'>(
    this.state,
    `loam-vscode.views.notes-explorer.show`,
    'all'
  );

  constructor(
    private workspace: LoamWorkspace,
    private graph: LoamGraph,
    private state: vscode.Memento
  ) {
    super();
    this.disposables.push(
      vscode.commands.registerCommand(
        `loam-vscode.views.notes-explorer.show:all`,
        () => {
          this.show.update('all');
          this.refresh();
        }
      ),
      vscode.commands.registerCommand(
        `loam-vscode.views.notes-explorer.show:notes`,
        () => {
          this.show.update('notes-only');
          this.refresh();
        }
      )
    );
  }

  getValues() {
    return this.workspace.list();
  }

  getFilterFn() {
    return this.show.get() === 'notes-only'
      ? res => res.type !== 'image' && res.type !== 'attachment'
      : () => true;
  }

  valueToPath(value: Resource) {
    const path = vscode.workspace.asRelativePath(
      value.uri.path,
      vscode.workspace.workspaceFolders.length > 1
    );
    const parts = path.split('/');
    return parts;
  }

  createValueTreeItem(
    value: Resource,
    parent: FolderTreeItem<Resource>
  ): NotesTreeItems {
    const item = new ResourceTreeItem(value, this.workspace, {
      parent,
      collapsibleState:
        this.graph.getBacklinks(value.uri).length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
    });
    item.id = value.uri.toString();
    item.getChildren = async () => {
      const backlinks = await createBacklinkTreeItemsForResource(
        this.workspace,
        this.graph,
        item.uri
      );
      backlinks.forEach(item => {
        item.description = item.label;
        item.label = item.resource.title;
      });
      return backlinks;
    };
    item.description =
      value.uri.getName().toLocaleLowerCase() ===
      value.title.toLocaleLowerCase()
        ? undefined
        : value.uri.getBasename();
    return item;
  }
}
