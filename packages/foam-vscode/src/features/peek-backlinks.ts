// TODO:
//   - docstrings
//   - tests
//   - make context line count configurable
//   - decorations theming
//   - make output more markdown render-friendly
//   - sort peeked files?
//   - should the code-lens + command be moved into features/ folder?
//   - sort backlink groups by title?
//   - remove line numbers to prettify output?
//   - also add some indication that not all relevant lines might have been shown
//   - skip empty lines
//   - focus should stay in original editor

// note:
//   No need to close documents opened by workspace.openTextDocument because of:
//   https://github.com/microsoft/vscode/issues/187008#issuecomment-1621138679
//
// resources:
//   https://github.com/microsoft/vscode-extension-samples/tree/main/contentprovider-sample

import * as vscode from 'vscode';
import {
  CancellationToken,
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
import { Loam } from '../core/model/loam';
import { Connection, LoamGraph } from '../core/model/graph';
import { fromVsCodeUri, toVsCodeUri } from '../utils/vsc-utils';
import { mdDocSelector } from '../utils';
import { URI } from '../core/model/uri';
import { LoamWorkspace } from '../core/model/workspace';

export const PEEK_BACKLINKS_SCHEME = 'loam-peek-backlinks';
const PEEK_BACKLINKS_COMMAND = 'loam-vscode.peek-backlinks.show';
const CONTEXT_LINE_COUNT = 3;
const PEEK_BACKLINKS_FILE_NAME = 'backlinks.md';

let _currentWikiDoc: Uri | undefined = undefined;

interface LinkedDocDetails {
  titleLength: number;
  startLine: number;
  endLine: number;
  minLine: number;
}

export default async function activate(
  context: ExtensionContext,
  loamPromise: Promise<Loam>
) {
  // wait for loam to become ready
  const loam = await loamPromise;

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
    window.showTextDocument(document, {
      viewColumn: editor.viewColumn! + 1,
      preview: true,
    });
  };

  const commandRegistration = commands.registerTextEditorCommand(
    PEEK_BACKLINKS_COMMAND,
    commandHandler
  );

  // instantiate and register providers for the peek backlinks feature
  // - code lens provider: for quick access to the peek backlinks feature (REMOVED)
  // - document content provider: compiles the content of the peeked backlinks
  const provider = new PeekBacklinks(loam.workspace, loam.graph);

  const providerRegistrations = Disposable.from(
    // languages.registerCodeLensProvider(mdDocSelector, provider),
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
  },
});

const _linkedDocHeaderDecorationType = window.createTextEditorDecorationType({
  light: {
    color: 'darkorange',
  },
  dark: {
    color: 'darkorange',
  },
  isWholeLine: true,
});

function initializeDecorations(context: ExtensionContext) {
  // define update decorations method for backlink name
  const updateBacklinkNameDecorations = (editor: TextEditor) => {
    if (!_currentWikiDoc) return;

    const backlinkName = fromVsCodeUri(_currentWikiDoc).getName().toLowerCase();
    const nameRegex = /\[{2}(.*?)]{2}/gm;
    const doc = editor.document;
    const text = doc.getText();

    let match: RegExpExecArray;
    let ranges: vscode.Range[] = [];

    while ((match = nameRegex.exec(text))) {
      if (match[1].toLocaleLowerCase() !== backlinkName) continue;

      const startPos = doc.positionAt(match.index);
      const endPos = doc.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      ranges.push(range);
    }

    editor.setDecorations(_backlinkDecorationType, ranges);
  };

  // define update decorations method for backlink name
  const updateLinkedDocHeaderDecorations = (editor: TextEditor) => {
    const headerRegex = /^.*\s\(.*.md\)$/gm;
    const doc = editor.document;
    const text = doc.getText();

    let match: RegExpExecArray;
    let ranges: vscode.Range[] = [];

    while ((match = headerRegex.exec(text))) {
      const position = doc.positionAt(match.index);
      const range = doc.lineAt(position.line).range;

      ranges.push(range);
    }

    editor.setDecorations(_linkedDocHeaderDecorationType, ranges);
  };

  // set decorations when backlinks.md is opened for the first time
  window.onDidChangeActiveTextEditor(
    editor => {
      const doc = editor.document;

      if (doc.uri.scheme !== PEEK_BACKLINKS_SCHEME) return;

      updateBacklinkNameDecorations(editor);
      updateLinkedDocHeaderDecorations(editor);
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
      updateLinkedDocHeaderDecorations(editor);
    },
    // TODO: reason for these options?
    null,
    context.subscriptions
  );
}

export class PeekBacklinks
  // CodeLensProvider,
  implements
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

  constructor(private workspace: LoamWorkspace, private graph: LoamGraph) {
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

  // TextDocumentContentProvider
  onDidChange?: vscode.Event<Uri>;

  async provideTextDocumentContent(uri: Uri): Promise<string> {
    if (!_currentWikiDoc) return;

    const linkedDocDetailsMap = this.getOrCreateWikiDocEntry(/* reset */ true);
    const loamUri = fromVsCodeUri(_currentWikiDoc);
    const backlinks = this.graph.getBacklinks(loamUri);
    const responseLines: string[] = [];

    // group backlinks
    var groupedBacklinks = backlinks.reduce((current, backlink) => {
      let connections: Connection[];

      if (!current.has(backlink.source)) {
        connections = [];
        current.set(backlink.source, connections);
      } else {
        connections = current.get(backlink.source);
      }

      connections.push(backlink);
      return current;
    }, new Map<URI, Connection[]>());

    // sort backlinks group by source name
    const sortedBacklinksGroups = Array.from(groupedBacklinks.entries()).sort(
      (sourceA, sourceB) => {
        const sourceNameA = sourceA[0].getName();
        const sourceNameB = sourceB[0].getName();

        return sourceNameA.localeCompare(sourceNameB);
      }
    );

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
          minLine: 0,
        };

        linkedDocDetailsMap.set(document, linkedDocDetails);
        responseLines.push(`${title} (${relativeUri})`);
        responseLines.push('');
        currentLine += 2;
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
          linkedDocDetails,
          responseLines
        );

        currentLine += PeekBacklinks.appendMatch(
          document,
          backlinkLine,
          linkedDocDetails,
          responseLines
        );

        currentLine += PeekBacklinks.appendTrailing(
          document,
          backlinkLine,
          linkedDocDetails,
          responseLines
        );

        linkedDocDetails.endLine = currentLine;
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
      // create link only for the file path (and not for the title which comes before)
      const fullRange = document.lineAt(linkedDocDetails.startLine).range;
      const actualStart = new Position(
        fullRange.start.line,
        linkedDocDetails.titleLength + 2
      );
      const actualEnd = new Position(
        fullRange.end.line,
        fullRange.end.character - 1
      );
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
    linkDocDetails: LinkedDocDetails,
    responseLines: string[]
  ): number {
    const minLine = linkDocDetails.minLine;
    const fromRequested = Math.max(0, backlinkLine - CONTEXT_LINE_COUNT);
    const from = Math.max(minLine, fromRequested);
    const to = backlinkLine;
    let lineCount = 0;

    if (fromRequested >= minLine && minLine !== 0) {
      responseLines.push('...');
      lineCount++;
    }

    for (let i = from; i < to; i++) {
      const text = doc.lineAt(i).text;

      responseLines.push(text);
      lineCount++;
      linkDocDetails.minLine = i + 1;
    }

    return lineCount;
  }

  private static appendMatch(
    doc: TextDocument,
    backlinkLine: number,
    linkDocDetails: LinkedDocDetails,
    responseLines: string[]
  ) {
    if (backlinkLine < linkDocDetails.minLine) return 0;

    const text = doc.lineAt(backlinkLine).text;
    responseLines.push(text);
    linkDocDetails.minLine = backlinkLine + 1;

    return 1;
  }

  private static appendTrailing(
    doc: TextDocument,
    backlinkLine: number,
    linkDocDetails: LinkedDocDetails,
    responseLines: string[]
  ): number {
    const minLine = linkDocDetails.minLine;
    const from = Math.max(minLine, backlinkLine);
    const to = Math.min(doc.lineCount, backlinkLine + CONTEXT_LINE_COUNT);
    let lineCount = 0;

    for (let i = from; i < to; i++) {
      const text = doc.lineAt(i).text;

      responseLines.push(text);
      lineCount++;
      linkDocDetails.minLine = i + 1;
    }

    return lineCount;
  }
}
