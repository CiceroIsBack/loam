import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  commands,
  ExtensionContext,
  languages,
  Range,
  TextDocument,
  window,
  workspace,
  Position,
} from 'vscode';
import { isMdEditor, mdDocSelector } from '../../utils';
import { Loam } from '../../core/model/loam';
import { LoamWorkspace } from '../../core/model/workspace';
import {
  LINK_REFERENCE_DEFINITION_FOOTER,
  LINK_REFERENCE_DEFINITION_HEADER,
  generateLinkReferences,
} from '../../core/janitor/generate-link-references';
import { fromVsCodeUri, toVsCodeRange } from '../../utils/vsc-utils';
import { getEditorEOL } from '../../services/editor';
import { ResourceParser } from '../../core/model/note';
import { getWikilinkDefinitionSetting } from '../../settings';
import { IMatcher } from '../../core/services/datastore';

export default async function activate(
  context: ExtensionContext,
  loamPromise: Promise<Loam>
) {
  const loam = await loamPromise;

  context.subscriptions.push(
    commands.registerCommand('loam-vscode.update-wikilink-definitions', () => {
      return updateWikilinkDefinitions(
        loam.workspace,
        loam.services.parser,
        loam.services.matcher
      );
    }),
    workspace.onWillSaveTextDocument(e => {
      e.waitUntil(
        updateWikilinkDefinitions(
          loam.workspace,
          loam.services.parser,
          loam.services.matcher
        )
      );
    }),
    languages.registerCodeLensProvider(
      mdDocSelector,
      new WikilinkReferenceCodeLensProvider(
        loam.workspace,
        loam.services.parser
      )
    )
  );
}

async function updateWikilinkDefinitions(
  fWorkspace: LoamWorkspace,
  fParser: ResourceParser,
  fMatcher: IMatcher
) {
  const editor = window.activeTextEditor;
  const doc = editor.document;

  if (!isMdEditor(editor) || !fMatcher.isMatch(fromVsCodeUri(doc.uri))) {
    return;
  }

  const setting = getWikilinkDefinitionSetting();
  const eol = getEditorEOL();
  const text = doc.getText();

  if (setting === 'off') {
    const { range } = detectDocumentWikilinkDefinitions(text, eol);
    if (range) {
      await editor.edit(editBuilder => {
        editBuilder.delete(toVsCodeRange(range));
      });
    }
    return;
  }

  const resource = fParser.parse(fromVsCodeUri(doc.uri), text);
  const update = await generateLinkReferences(
    resource,
    text,
    eol,
    fWorkspace,
    setting === 'withExtensions'
  );

  if (update) {
    await editor.edit(editBuilder => {
      const gap = doc.lineAt(update.range.start.line - 1).isEmptyOrWhitespace
        ? ''
        : eol;
      editBuilder.replace(toVsCodeRange(update.range), gap + update.newText);
    });
  }
}

/**
 * Detects the range of the wikilink definitions in the document.
 */
function detectDocumentWikilinkDefinitions(text: string, eol: string) {
  const lines = text.split(eol);

  const headerLine = lines.findIndex(
    line => line === LINK_REFERENCE_DEFINITION_HEADER
  );
  const footerLine = lines.findIndex(
    line => line === LINK_REFERENCE_DEFINITION_FOOTER
  );

  if (headerLine < 0 || footerLine < 0 || headerLine >= footerLine) {
    return { range: null, definitions: null };
  }

  const range = new Range(
    new Position(headerLine, 0),
    new Position(footerLine, lines[footerLine].length)
  );
  const definitions = lines.slice(headerLine, footerLine).join(eol);

  return { range, definitions };
}

/**
 * Provides a code lens to update the wikilink definitions in the document.
 */
class WikilinkReferenceCodeLensProvider implements CodeLensProvider {
  constructor(
    private fWorkspace: LoamWorkspace,
    private fParser: ResourceParser
  ) {}

  public async provideCodeLenses(
    document: TextDocument,
    _: CancellationToken
  ): Promise<CodeLens[]> {
    const eol = getEditorEOL();
    const text = document.getText();

    const { range } = detectDocumentWikilinkDefinitions(text, eol);
    if (!range) {
      return [];
    }
    const setting = getWikilinkDefinitionSetting();

    const resource = this.fParser.parse(fromVsCodeUri(document.uri), text);
    const update = await generateLinkReferences(
      resource,
      text,
      eol,
      this.fWorkspace,
      setting === 'withExtensions'
    );

    const status = update == null ? 'up to date' : 'out of date';

    return [
      new CodeLens(range, {
        command:
          update == null ? '' : 'loam-vscode.update-wikilink-definitions',
        title: `Wikilink definitions (${status})`,
        arguments: [],
      }),
    ];
  }
}
