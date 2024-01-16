// TODO: docstrings
// TODO: dispose opened files
// TODO: async processing
// TODO: make context line count configurable
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
  TextEditor,
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
const PEEK_BACKLINKS_FILE_NAME = 'backlinks.md';

let _currentWikiDoc : Uri | undefined = undefined;

interface LinkedDocDetails {
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
  const uri = vscode.Uri.from({
    scheme: PEEK_BACKLINKS_SCHEME,
    path: PEEK_BACKLINKS_FILE_NAME
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

  initializeDecorations(context);
}

// decorations
const _lineNumberDecorationType = vscode.window.createTextEditorDecorationType(
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

function initializeDecorations(context: ExtensionContext) {

  // define update decorations method
  const updateDecorations = (doc: TextDocument, editor: TextEditor) => {
    if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME)
        return;
  
      const lineNumberRegex = /^\s{2}\d+/gm;
      const text = doc.getText();
  
      let match: RegExpExecArray;
      let ranges: vscode.Range[] = [];
  
      while ((match = lineNumberRegex.exec(text))) {
        const startPos = doc.positionAt(match.index);
        const endPos = doc.positionAt(
          match.index + match[0].length
        );
        const range = new vscode.Range(startPos, endPos);
  
        ranges.push(range);
      }
  
      editor.setDecorations(_lineNumberDecorationType, ranges);
  }

  // set decorations when backlinks.md is opened for the first time
  vscode.window.onDidChangeActiveTextEditor(
    editor => {

      const doc = editor.document;

      if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME)
        return;

      updateDecorations(doc, editor);
    },
    // TODO: reason for these options?
    null,
    context.subscriptions
  );

  // update decorations when content of backlinks.md has changed
  vscode.workspace.onDidChangeTextDocument(
    e => {

      const doc = e.document;

      if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME)
        return;

      const editor = vscode.window.visibleTextEditors
        .find(current => current.document === doc);
      
      if (!editor)
        return;
      
      updateDecorations(doc, editor);
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
  // key: the uri of wiki document
  // value: a nested map with
  //   key: linked document
  //   value: linked document details
  private _wikiDocToLinkedDocDetailsMap = new Map<Uri, Map<TextDocument, LinkedDocDetails>>();

  constructor(private graph: FoamGraph) {
    
    // ensure that the peek document content is updated when the user opens another wiki document
    const onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    const onDidChangeFoldingRangesEmitter = new vscode.EventEmitter<void>();

    vscode.window.onDidChangeActiveTextEditor(editor => {

      if (editor.document.uri.scheme == PEEK_BACKLINKS_SCHEME)
        return;

      _currentWikiDoc = editor.document.uri;
      
      let uri = vscode.Uri.from({
        scheme: PEEK_BACKLINKS_SCHEME,
        path: PEEK_BACKLINKS_FILE_NAME
      });
      
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
    return; // there are not lenses to resolve
  }

  // TextDocumentContentProvider
  onDidChange?: vscode.Event<Uri>;

  async provideTextDocumentContent(uri: Uri): Promise<string> {

    if (!_currentWikiDoc)
      return;

    const linkedDocDetailsMap = this.getOrCreateWikiDocEntry(true);
    const foamUri = fromVsCodeUri(_currentWikiDoc);
    const backlinks = this.graph.getBacklinks(foamUri);
    const responseLines: string[] = [];

    // loop over each backlink and build up text response
    let currentLine = 0;

    for (const backlink of backlinks) {

      // TODO: use this instead?
      // const content = await workspace.fs.readFile(toVsCodeUri(uri));
      // return decoder.decode(content);

      const document = await vscode.workspace.openTextDocument(
        Uri.parse(backlink.source.toString())
      );

      // get or create 'linkedDocDetails'
      let linkedDocDetails: LinkedDocDetails;

      if (!linkedDocDetailsMap.has(document)) {

        // append backlink source's URI to the text response
        const workspaceFolder = vscode.workspace
          .getWorkspaceFolder(toVsCodeUri(backlink.source))
          ?.uri.path;

        const relativeUri = backlink.source.path.replace(workspaceFolder, '');

        if (responseLines.length > 0) {
          responseLines.push('');
          currentLine++;
        }

        linkedDocDetails = {
          startLine: currentLine,
          endLine: undefined,
          consumedLine: 0,
        };

        linkedDocDetailsMap.set(document, linkedDocDetails);
        responseLines.push(relativeUri);
        currentLine++;

      } else {
        linkedDocDetails = linkedDocDetailsMap.get(document);
      }

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

    if (responseLines.length == 0)
      responseLines.push("There are no backlinks to peek.");

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
      const range = document.lineAt(linkedDocDetails.startLine).range;
      const documentLink = new DocumentLink(range, wikiDoc.uri);

      documentLinks.push(documentLink);
    }

    return documentLinks;
  }

  resolveDocumentLink?(
    link: DocumentLink,
    token: CancellationToken
  ): vscode.ProviderResult<DocumentLink> {
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

    for (let [_, linkedDocDetails] of wikiDocDetailsMap) {
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
  private getOrCreateWikiDocEntry(reset: boolean = false): Map<TextDocument, LinkedDocDetails> {
    
    if (reset || !this._wikiDocToLinkedDocDetailsMap.has(_currentWikiDoc)) {
      this._wikiDocToLinkedDocDetailsMap
        .set(_currentWikiDoc, new Map<TextDocument, LinkedDocDetails>());
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

    if (fromRequested >= consumedLine && consumedLine != 0) {
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