// TODO:
//   - docstrings
//   - tests
//   - make context line count configurable
//   - text decoration theming
//   - make output more markdown render-friendly
//   - sort peeked files?
//   - should the code-lens + command be moved into features/ folder?
//   - sort backlink groups by title?

// note:
//   No need to close documents opened by workspace.openTextDocument because of:
//   https://github.com/microsoft/vscode/issues/187008#issuecomment-1621138679
//
// resources:
//   https://github.com/microsoft/vscode-extension-samples/tree/main/contentprovider-sample

import * as vscode from 'vscode';
import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  Disposable,
  DocumentLink,
  DocumentLinkProvider,
  EventEmitter,
  ExtensionContext,
  FoldingContext,
  FoldingRange,
  FoldingRangeKind,
  FoldingRangeProvider,
  Position,
  ProviderResult,
  TextDocument,
  TextDocumentContentProvider,
  TextEditor,
  Uri,
  commands,
  languages,
  window,
  workspace,
} from 'vscode';
import { Foam } from '../core/model/foam';
import { Connection, FoamGraph } from '../core/model/graph';
import { fromVsCodeUri, toVsCodeUri } from '../utils/vsc-utils';
import { mdDocSelector } from '../utils';
import { URI } from '../core/model/uri';
import { FoamWorkspace } from '../core/model/workspace';

export const PEEK_BACKLINKS_SCHEME = 'foam-peek-backlinks';
const PEEK_BACKLINKS_COMMAND = 'foam-vscode.peek-backlinks.show';
const CONTEXT_LINE_COUNT = 3;
const PEEK_BACKLINKS_FILE_NAME = 'backlinks.md';

let _currentWikiDoc: Uri | undefined = undefined;

interface LinkedDocDetails {
  titleLength: number;
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
  const uri = Uri.from({
    scheme: PEEK_BACKLINKS_SCHEME,
    path: PEEK_BACKLINKS_FILE_NAME,
  });

  const commandHandler = async editor => {
    _currentWikiDoc = editor.document.uri;

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
  const provider = new PeekBacklinks(foam.workspace, foam.graph);

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

  initializeDecorations(context);
}

// decorations
const _backlinkDecorationType = window.createTextEditorDecorationType({
  light: {
    backgroundColor: '#02adc422',
  },
  dark: {
    backgroundColor: '#02adc422',
  }
});

const _lineNumberDecorationType = window.createTextEditorDecorationType({
  fontWeight: 'bold',
  light: {
    color: '#855f79',
  },
  dark: {
    color: '#855f79',
  },
});

function initializeDecorations(context: ExtensionContext) {

  // define update decorations method for backlink name
  const updateBacklinkNameDecorations = (editor: TextEditor) => {

    if (!_currentWikiDoc)
      return;

    const backlinkName = fromVsCodeUri(_currentWikiDoc).getName();
    const doc = editor.document;
    const nameRegex = /\[{2}(.*?)]{2}/gm;
    const text = doc.getText();

    let match: RegExpExecArray;
    let ranges: vscode.Range[] = [];

    while ((match = nameRegex.exec(text))) {

      if (match[1] !== backlinkName)
        continue;

      const startPos = doc.positionAt(match.index);
      const endPos = doc.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      ranges.push(range);
    }

    editor.setDecorations(_backlinkDecorationType, ranges);
  };

  // define update decorations method for line numbers
  const updateLineNumberDecorations = (editor: TextEditor) => {
   
    const doc = editor.document;
    const lineNumberRegex = /^\s{2}\d+/gm;
    const text = doc.getText();

    let match: RegExpExecArray;
    let ranges: vscode.Range[] = [];

    while ((match = lineNumberRegex.exec(text))) {
      const startPos = doc.positionAt(match.index);
      const endPos = doc.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      ranges.push(range);
    }

    editor.setDecorations(_lineNumberDecorationType, ranges);
  };

  // set decorations when backlinks.md is opened for the first time
  window.onDidChangeActiveTextEditor(
    editor => {

      const doc = editor.document;

      if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME) return;

      updateBacklinkNameDecorations(editor);
      updateLineNumberDecorations(editor);
    },
    // TODO: reason for these options?
    null,
    context.subscriptions
  );

  // update decorations when content of backlinks.md has changed
  workspace.onDidChangeTextDocument(
    e => {

      const doc = e.document;

      if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME) return;

      const editor = window.visibleTextEditors.find(
        current => current.document === doc
      );

      if (!editor) return;
      
      updateBacklinkNameDecorations(editor);
      updateLineNumberDecorations(editor);
    },
    // TODO: reason for these options?
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
  // key: the uri of the wiki document
  // value: a nested map with
  //   key: the uri of the linked document
  //   value: linked document details
  private _wikiDocToLinkedDocDetailsMap = new Map<
    Uri,
    Map<TextDocument, LinkedDocDetails>
  >();

  private _onDidChangeEmitter = new EventEmitter<Uri>();
  private _onDidChangeFoldingRangesEmitter = new EventEmitter<void>();
  private _subscriptions: Disposable;

  private _peekBacklinksUri = Uri.from({
    scheme: PEEK_BACKLINKS_SCHEME,
    path: PEEK_BACKLINKS_FILE_NAME,
  });

  constructor(private workspace: FoamWorkspace, private graph: FoamGraph) {
    this.onDidChange = this._onDidChangeEmitter.event;
    this.onDidChangeFoldingRanges = this._onDidChangeFoldingRangesEmitter.event;

    // ensure that the peek document content is updated when the user opens another wiki document
    this._subscriptions = window.onDidChangeActiveTextEditor(editor => {
      if (editor.document.uri.scheme === PEEK_BACKLINKS_SCHEME) return;

      // only fire when document is of supported scheme and language
      let isMatch = false;

      for (const current of mdDocSelector) {
        if (
          editor.document.languageId === current.language &&
          editor.document.uri.scheme === current.scheme
        ) {
          isMatch = true;
        }
      }

      if (!isMatch) return;

      // capture the current wiki document for later use
      _currentWikiDoc = editor.document.uri;

      // fire change events to trigger re-rendering
      this._onDidChangeEmitter.fire(this._peekBacklinksUri);
      this._onDidChangeFoldingRangesEmitter.fire();
    });
  }

  dispose() {
    this._subscriptions.dispose();
    this._onDidChangeEmitter.dispose();
    this._onDidChangeFoldingRangesEmitter.dispose();
  }

  // CodeLensProvider
  onDidChangeCodeLenses?: vscode.Event<void>;

  provideCodeLenses(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<CodeLens[]> {
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
      title: `🔍 Peek ${backlinks.length} backlink${
        backlinks.length === 1 ? '' : 's'
      }`,
      command: PEEK_BACKLINKS_COMMAND,
    };

    return [new CodeLens(range, command)];
  }

  resolveCodeLens?(
    codeLens: CodeLens,
    token: CancellationToken
  ): ProviderResult<CodeLens> {
    return; // there are no lenses to resolve
  }

  // TextDocumentContentProvider
  onDidChange?: vscode.Event<Uri>;

  async provideTextDocumentContent(uri: Uri): Promise<string> {
    if (!_currentWikiDoc) return;

    const linkedDocDetailsMap = this.getOrCreateWikiDocEntry(/* reset */ true);
    const foamUri = fromVsCodeUri(_currentWikiDoc);
    const backlinks = this.graph.getBacklinks(foamUri);
    const responseLines: string[] = [];

    // group backlinks
    var groupedBacklinks = backlinks.reduce((current, backlink) => {
      let connections: Connection[];

      if (!current.has(backlink.source)) {
        connections = [];
        current.set(backlink.source, connections);
      }
      else {
        connections = current.get(backlink.source);
      }

      connections.push(backlink);
      return current;
    }, new Map<URI, Connection[]>());

    // sort backlinks group by source name
    const sortedBacklinksGroups = Array.from(groupedBacklinks.entries())
      .sort((sourceA, sourceB) => {
        const sourceNameA = sourceA[0].getName();
        const sourceNameB = sourceB[0].getName();

        return sourceNameA.localeCompare(sourceNameB);
      });

    // loop over each backlinks group and build up text response
    let currentLine = 0;

    for (const backlinksGroup of sortedBacklinksGroups) {

      // get or create 'linkedDocDetails'
      let linkedDocDetails: LinkedDocDetails;
      let sourceDoc = backlinksGroup[0];

      const document = await workspace.openTextDocument(
        Uri.parse(sourceDoc.toString())
      );

      if (!linkedDocDetailsMap.has(document)) {
        // append backlink source's URI to the text response
        const workspaceFolder = workspace.getWorkspaceFolder(
          toVsCodeUri(sourceDoc)
        )?.uri.path;

        const title = this.workspace.get(sourceDoc).title;
        const relativeUri = sourceDoc.path.replace(workspaceFolder, '');

        if (responseLines.length > 0) {
          responseLines.push('');
          currentLine++;
        }

        linkedDocDetails = {
          titleLength: title.length,
          startLine: currentLine,
          endLine: undefined,
          consumedLine: 0,
        };

        linkedDocDetailsMap.set(document, linkedDocDetails);
        responseLines.push(`${title} (${relativeUri})`);
        currentLine++;
      } else {
        linkedDocDetails = linkedDocDetailsMap.get(document);
      }

      // loop over each backlink
      let backlinks = backlinksGroup[1];

      for (const backlink of backlinks) {

        // append wiki doc content to the text response
        const backlinkLine = backlink.link.range.start.line;

        currentLine += PeekBacklinks.appendLeading(
          document,
          backlinkLine,
          linkedDocDetails.consumedLine,
          responseLines
        );

        currentLine += PeekBacklinks.appendMatch(
          document,
          backlinkLine,
          responseLines
        );

        currentLine += PeekBacklinks.appendTrailing(
          document,
          backlinkLine,
          responseLines
        );

        linkedDocDetails.endLine = currentLine;
        linkedDocDetails.consumedLine = backlinkLine + CONTEXT_LINE_COUNT;
      }
    }

    if (responseLines.length === 0)
      responseLines.push('There are no backlinks to peek.');

    return responseLines.join('\n');
  }

  // DocumentLinkProvider
  provideDocumentLinks(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<DocumentLink[]> {
    const linkedDocDetailsMap = this.getOrCreateWikiDocEntry();
    const documentLinks: DocumentLink[] = [];

    for (let [wikiDoc, linkedDocDetails] of linkedDocDetailsMap) {

      // create linke only for the file path (and not for the title which comes before)
      const fullRange = document.lineAt(linkedDocDetails.startLine).range;
      const actualStart = new Position(fullRange.start.line, linkedDocDetails.titleLength + 2);
      const actualEnd = new Position(fullRange.end.line, fullRange.end.character - 1);
      const actualRange = new vscode.Range(actualStart, actualEnd);
      const documentLink = new DocumentLink(actualRange, wikiDoc.uri);

      documentLinks.push(documentLink);
    }

    return documentLinks;
  }

  resolveDocumentLink?(
    link: DocumentLink,
    token: CancellationToken
  ): ProviderResult<DocumentLink> {
    return; // do nothing
  }

  // FoldingRangeProvider
  onDidChangeFoldingRanges?: vscode.Event<void>;

  provideFoldingRanges(
    document: TextDocument,
    context: FoldingContext,
    token: CancellationToken
  ): ProviderResult<FoldingRange[]> {
    const wikiDocDetailsMap = this.getOrCreateWikiDocEntry();
    const foldingRanges: FoldingRange[] = [];

    for (let [, linkedDocDetails] of wikiDocDetailsMap) {
      const foldingRange = new FoldingRange(
        linkedDocDetails.startLine,
        linkedDocDetails.endLine - 1,
        FoldingRangeKind.Region
      );

      foldingRanges.push(foldingRange);
    }

    return foldingRanges;
  }

  // helper methods
  private getOrCreateWikiDocEntry(
    reset: boolean = false
  ): Map<TextDocument, LinkedDocDetails> {
    if (reset || !this._wikiDocToLinkedDocDetailsMap.has(_currentWikiDoc)) {
      this._wikiDocToLinkedDocDetailsMap.set(
        _currentWikiDoc,
        new Map<TextDocument, LinkedDocDetails>()
      );
    }

    return this._wikiDocToLinkedDocDetailsMap.get(_currentWikiDoc);
  }

  private static appendLeading(
    doc: TextDocument,
    backlinkLine: number,
    consumedLine: number,
    responseLines: string[]
  ): number {
    let fromRequested = Math.max(0, backlinkLine - CONTEXT_LINE_COUNT);
    let fromActual = Math.max(consumedLine, fromRequested);
    let lineCount = 0;

    if (fromRequested >= consumedLine && consumedLine !== 0) {
      responseLines.push('  ...');
      lineCount++;
    }

    while (++fromActual < backlinkLine) {
      const text = doc.lineAt(fromActual).text;

      responseLines.push(`  ${fromActual + 1}` + (text && `  ${text}`));
      lineCount++;
    }

    return lineCount;
  }

  private static appendMatch(
    doc: TextDocument,
    backlinkLine: number,
    responseLines: string[]
  ) {
    const content = doc.lineAt(backlinkLine).text;
    responseLines.push(`  ${backlinkLine + 1}: ${content}`);

    return 1;
  }

  private static appendTrailing(
    doc: TextDocument,
    backlinkLine: number,
    responseLines: string[]
  ): number {
    const to = Math.min(doc.lineCount, backlinkLine + CONTEXT_LINE_COUNT);
    let lineCount = 0;

    while (++backlinkLine < to) {
      const text = doc.lineAt(backlinkLine).text;
      responseLines.push(`  ${backlinkLine + 1}` + (text && `  ${text}`));
      lineCount++;
    }

    return lineCount;
  }
}
