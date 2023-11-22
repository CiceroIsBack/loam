import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { getGraphStyle, getTitleMaxLength } from '../../settings';
import { isSome } from '../../utils';
import { Loam } from '../../core/model/loam';
import { Logger } from '../../core/utils/log';
import { fromVsCodeUri } from '../../utils/vsc-utils';

export default async function activate(
  context: vscode.ExtensionContext,
  loamPromise: Promise<Loam>
) {
  let panel: vscode.WebviewPanel | undefined = undefined;
  vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('loam.graph.style')) {
      const style = getGraphStyle();
      panel.webview.postMessage({
        type: 'didUpdateStyle',
        payload: style,
      });
    }
  });

  vscode.commands.registerCommand('loam-vscode.show-graph', async () => {
    if (panel) {
      const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;
      panel.reveal(columnToShowIn);
    } else {
      const loam = await loamPromise;
      panel = await createGraphPanel(loam, context);
      const onLoamChanged = _ => {
        updateGraph(panel, loam);
      };

      const noteUpdatedListener = loam.graph.onDidUpdate(onLoamChanged);
      panel.onDidDispose(() => {
        noteUpdatedListener.dispose();
        panel = undefined;
      });

      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e?.document?.uri?.scheme === 'file') {
          const note = loam.workspace.get(fromVsCodeUri(e.document.uri));
          if (isSome(note)) {
            panel.webview.postMessage({
              type: 'didSelectNote',
              payload: note.uri.path,
            });
          }
        }
      });
    }
  });
}

function updateGraph(panel: vscode.WebviewPanel, loam: Loam) {
  const graph = generateGraphData(loam);
  panel.webview.postMessage({
    type: 'didUpdateGraphData',
    payload: graph,
  });
}

function generateGraphData(loam: Loam) {
  const graph = {
    nodeInfo: {},
    edges: new Set(),
  };

  loam.workspace.list().forEach(n => {
    const type = n.type === 'note' ? n.properties.type ?? 'note' : n.type;
    const title = n.type === 'note' ? n.title : n.uri.getBasename();
    graph.nodeInfo[n.uri.path] = {
      id: n.uri.path,
      type: type,
      uri: n.uri,
      title: cutTitle(title),
      properties: n.properties,
      tags: n.tags,
    };
  });
  loam.graph.getAllConnections().forEach(c => {
    graph.edges.add({
      source: c.source.path,
      target: c.target.path,
    });
    if (c.target.isPlaceholder()) {
      graph.nodeInfo[c.target.path] = {
        id: c.target.path,
        type: 'placeholder',
        uri: c.target,
        title: c.target.path,
        properties: {},
      };
    }
  });

  return {
    nodeInfo: graph.nodeInfo,
    links: Array.from(graph.edges),
  };
}

function cutTitle(title: string): string {
  const maxLen = getTitleMaxLength();
  if (maxLen > 0 && title.length > maxLen) {
    return title.substring(0, maxLen).concat('...');
  }
  return title;
}

async function createGraphPanel(loam: Loam, context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'loam-graph',
    'Loam Graph',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = await getWebviewContent(context, panel);

  panel.webview.onDidReceiveMessage(
    async message => {
      switch (message.type) {
        case 'webviewDidLoad': {
          const styles = getGraphStyle();
          panel.webview.postMessage({
            type: 'didUpdateStyle',
            payload: styles,
          });
          updateGraph(panel, loam);
          break;
        }
        case 'webviewDidSelectNode': {
          const noteUri = vscode.Uri.parse(message.payload);
          const selectedNote = loam.workspace.get(fromVsCodeUri(noteUri));

          if (isSome(selectedNote)) {
            vscode.commands.executeCommand(
              'vscode.open',
              noteUri,
              vscode.ViewColumn.One
            );
          }
          break;
        }
        case 'error': {
          Logger.error('An error occurred in the graph view', message.payload);
          break;
        }
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

async function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
) {
  const datavizPath = vscode.Uri.joinPath(
    vscode.Uri.file(context.extensionPath),
    'static',
    'dataviz'
  );

  const getWebviewUri = (fileName: string) =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(datavizPath, fileName));

  const indexHtml = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(datavizPath, 'index.html')
  );

  // Replace the script paths with the appropriate webview URI.
  const filled = new TextDecoder('utf-8')
    .decode(indexHtml)
    .replace(/data-replace (src|href)="[^"]+"/g, match => {
      const i = match.indexOf(' ');
      const j = match.indexOf('=');
      const uri = getWebviewUri(match.slice(j + 2, -1).trim());
      return match.slice(i + 1, j) + '="' + uri.toString() + '"';
    });

  return filled;
}
