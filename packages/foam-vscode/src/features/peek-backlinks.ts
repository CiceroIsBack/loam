// TODO: dispose opened files
// TODO: async processing
// TODO: update when source file changes
// TODO: make context line count configurable
// TODO: print context only once, even if there are multiple backlinks contained
// TODO: text decoration theming
// TODO: make output more markdown render-friendly
// TODO: sort files?
// resources: https://github.com/microsoft/vscode-extension-samples/tree/main/contentprovider-sample

import * as vscode from 'vscode';
import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  Disposable,
  DocumentLink,
  DocumentLinkProvider,
  ExtensionContext,
  FoldingContext,
  FoldingRange,
  FoldingRangeKind,
  FoldingRangeProvider,
  ProviderResult,
  TextDocument,
  TextDocumentContentProvider,
  Uri,
  commands,
  languages,
  window,
  workspace,
} from 'vscode';
import { Foam } from '../core/model/foam';
import { FoamGraph } from '../core/model/graph';
import { fromVsCodeUri, toVsCodeUri } from '../utils/vsc-utils';
import { mdDocSelector } from '../utils';

export const PEEK_BACKLINKS_SCHEME = 'foam-peek-backlinks';
const PEEK_BACKLINKS_COMMAND = 'foam-vscode.peek-backlinks.show';
const CONTEXT_LINE_COUNT = 3;
const BACKLINKS_FILE_NAME = 'backlinks.md';

interface SourceDetails {
  startLine: number;
  endLine: number;
  consumedLine: number;
}

export default async function activate(
  context: ExtensionContext,
  foamPromise: Promise<Foam>
) {
  // wait for foam to become ready
  const foam = await foamPromise;

  // create and register command that
  // - crafts an uri with the scheme PEEK_BACKLINKS_SCHEME
  // - opens the virtual document
  // - shows it in the next editor
  const commandHandler = async editor => {

    const uri = vscode.Uri.from({
      scheme: PEEK_BACKLINKS_SCHEME,
      path: BACKLINKS_FILE_NAME
    });

    const document = await workspace.openTextDocument(uri);

    window.showTextDocument(document, editor.viewColumn! + 1);
  };

  const commandRegistration = commands.registerTextEditorCommand(
    PEEK_BACKLINKS_COMMAND,
    commandHandler
  );

  // instantiate and register providers for the peek backlinks feature
  // - code lens provider: for quick access to the peek backlinks feature
  // - document content provider: compiles the content of the peeked backlinks
  const provider = new PeekBacklinks(foam.graph);

  const providerRegistrations = Disposable.from(
    languages.registerCodeLensProvider(mdDocSelector, provider),
    workspace.registerTextDocumentContentProvider(
      PEEK_BACKLINKS_SCHEME,
      provider
    ),
    languages.registerDocumentLinkProvider(
      { scheme: PEEK_BACKLINKS_SCHEME },
      provider
    ),
    languages.registerFoldingRangeProvider(
      { scheme: PEEK_BACKLINKS_SCHEME },
      provider
    )
  );

  // collect all disposables
  context.subscriptions.push(
    commandRegistration,
    provider,
    providerRegistrations
  );

  // decorations
  initializeDecorations(context);
}

function initializeDecorations(context: ExtensionContext) {

  const lineNumberDecorationType = vscode.window.createTextEditorDecorationType(
    {
      fontWeight: 'bold',
      light: {
        color: '#855f79',
      },
      dark: {
        color: '#855f79',
      },
    }
  );

  vscode.window.onDidChangeActiveTextEditor(
    editor => {
      // TODO: set decoration whenever the virtual document is open and has changed (how to get correct editor?)
      if (editor.document.uri.scheme === PEEK_BACKLINKS_SCHEME) {
        const lineNumberRegex = /^\s{2}\d+/gm;
        const text = editor.document.getText();

        let match: RegExpExecArray;
        let ranges: vscode.Range[] = [];

        while ((match = lineNumberRegex.exec(text))) {
          const startPos = editor.document.positionAt(match.index);
          const endPos = editor.document.positionAt(
            match.index + match[0].length
          );
          const range = new vscode.Range(startPos, endPos);

          ranges.push(range);
        }

        editor.setDecorations(lineNumberDecorationType, ranges);
      }
    },
    null,
    context.subscriptions
  );
}

export class PeekBacklinks
  implements
    CodeLensProvider,
    TextDocumentContentProvider,
    DocumentLinkProvider,
    FoldingRangeProvider
{
  private _currentDocument? : Uri;

  public constructor(private graph: FoamGraph) {
    
    // TextDocumentContentProvider
    const onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    const onDidChangeFoldingRangesEmitter = new vscode.EventEmitter<void>();

    vscode.window.onDidChangeActiveTextEditor(editor => {

      this._currentDocument = editor.document.uri;

      if (this._currentDocument.scheme == PEEK_BACKLINKS_SCHEME)
        return;

      let uri = vscode.Uri.from({
        scheme: PEEK_BACKLINKS_SCHEME,
        path: BACKLINKS_FILE_NAME
      });
      
      // TODO: improve general opened document / context handling
      this._sourceDetailsMap.clear()
      // TODO: only fire when document is .md and scheme matches
      onDidChangeEmitter.fire(uri);
      onDidChangeFoldingRangesEmitter.fire();
    })

    this.onDidChange = onDidChangeEmitter.event;
    this.onDidChangeFoldingRanges = onDidChangeFoldingRangesEmitter.event;
  }

  dispose() {
    //
  }

  // CodeLensProvider
  onDidChangeCodeLenses?: vscode.Event<void>;

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    // prevent circular peeking
    if (document.uri.scheme === PEEK_BACKLINKS_SCHEME) return;

    // ensure there are any backlinks to peek
    const foamUri = fromVsCodeUri(document.uri);
    const backlinks = this.graph.getBacklinks(foamUri);

    if (backlinks.length <= 0) return;

    // create lens
    const range = new vscode.Range(0, 0, 0, 0);

    const command: Command = {
      // alternative symbol: 🕸️
      title: `🔍 Peek ${backlinks.length} backlink${backlinks.length == 1 ? '' : 's'}`,
      command: PEEK_BACKLINKS_COMMAND,
    };

    return [new vscode.CodeLens(range, command)];
  }

  resolveCodeLens?(
    codeLens: CodeLens,
    token: CancellationToken
  ): ProviderResult<CodeLens> {
    // TODO what is this method for?
    return;
  }

  // TextDocumentContentProvider
  private _sourceDetailsMap = new Map<TextDocument, SourceDetails>();

  onDidChange?: vscode.Event<Uri>;

  public async provideTextDocumentContent(uri: Uri): Promise<string> {

    if (!this._currentDocument)
      return;

    const foamUri = fromVsCodeUri(this._currentDocument);
    const backlinks = this.graph.getBacklinks(foamUri);
    const responseLines: string[] = [];

    // loop over each backlink and build up text response
    let currentLine = 0;

    for (const backlink of backlinks) {

      const document = await vscode.workspace.openTextDocument(
        Uri.parse(backlink.source.toString())
      );

      // get or create 'sourceDetails'
      let sourceDetails: SourceDetails;

      if (!this._sourceDetailsMap.has(document)) {

        // append backlink source's URI to the text response
        const workspaceFolder = vscode.workspace
          .getWorkspaceFolder(toVsCodeUri(backlink.source))
          ?.uri.path;

        const relativeUri = backlink.source.path.replace(workspaceFolder, '');

        if (responseLines.length > 0) {
          responseLines.push('');
          currentLine++;
        }

        sourceDetails = {
          startLine: currentLine,
          endLine: undefined,
          consumedLine: 0,
        };

        this._sourceDetailsMap.set(document, sourceDetails);
        responseLines.push(relativeUri);
        currentLine++;

      } else {
        sourceDetails = this._sourceDetailsMap.get(document);
      }

      // append backlink source's content to the text response
      const backlinkLine = backlink.link.range.start.line;
      const content = document.lineAt(backlinkLine).text;
      const prefixedContent = `  ${backlinkLine + 1}: ${content}`;

      currentLine += PeekBacklinks.appendLeading(
        document,
        backlinkLine,
        sourceDetails.consumedLine,
        responseLines
      );

      responseLines.push(prefixedContent);
      currentLine++;

      currentLine += PeekBacklinks.appendTrailing(
        document,
        backlinkLine,
        responseLines
      );

      sourceDetails.endLine = currentLine;
      sourceDetails.consumedLine = backlinkLine + CONTEXT_LINE_COUNT;
    }

    return responseLines.join('\n');
  }

  private static appendLeading(
    document: TextDocument,
    backlinkLine: number,
    consumedLine: number,
    responseLines: string[]
  ): number {
    let fromRequested = Math.max(0, backlinkLine - CONTEXT_LINE_COUNT);
    let fromActual = Math.max(consumedLine, fromRequested);
    let lineCount = 0;

    if (fromRequested >= consumedLine && consumedLine != 0) {
      responseLines.push('  ...');
      lineCount++;
    }

    while (++fromActual < backlinkLine) {
      const text = document.lineAt(fromActual).text;

      responseLines.push(`  ${fromActual + 1}` + (text && `  ${text}`));
      lineCount++;
    }

    return lineCount;
  }

  private static appendTrailing(
    document: TextDocument,
    backlinkLine: number,
    responseLines: string[]
  ): number {
    const to = Math.min(document.lineCount, backlinkLine + CONTEXT_LINE_COUNT);
    let lineCount = 0;

    while (++backlinkLine < to) {
      const text = document.lineAt(backlinkLine).text;
      responseLines.push(`  ${backlinkLine + 1}` + (text && `  ${text}`));
      lineCount++;
    }

    return lineCount;
  }

  // DocumentLinkProvider
  provideDocumentLinks(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<DocumentLink[]> {
    const documentLinks: DocumentLink[] = [];

    for (let [source, sourceDetails] of this._sourceDetailsMap) {
      const range = document.lineAt(sourceDetails.startLine).range;
      const documentLink = new DocumentLink(range, source.uri);

      documentLinks.push(documentLink);
    }

    return documentLinks;
  }

  resolveDocumentLink?(
    link: DocumentLink,
    token: CancellationToken
  ): vscode.ProviderResult<DocumentLink> {
    return;
  }

  // FoldingRangeProvider
  onDidChangeFoldingRanges?: vscode.Event<void>;

  provideFoldingRanges(
    document: TextDocument,
    context: FoldingContext,
    token: CancellationToken
  ): ProviderResult<FoldingRange[]> {
    const foldingRanges: FoldingRange[] = [];

    for (let [_, sourceDetails] of this._sourceDetailsMap) {
      const foldingRange = new FoldingRange(
        sourceDetails.startLine,
        sourceDetails.endLine - 1,
        FoldingRangeKind.Region
      );

      foldingRanges.push(foldingRange);
    }

    return foldingRanges;
  }
}