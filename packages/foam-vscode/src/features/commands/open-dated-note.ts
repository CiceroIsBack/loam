import { ExtensionContext, commands } from 'vscode';
import { getLoamVsCodeConfig } from '../../services/config';
import {
  createDailyNoteIfNotExists,
  openDailyNoteFor,
} from '../../dated-notes';

export default async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('loam-vscode.open-dated-note', date => {
      switch (getLoamVsCodeConfig('dateSnippets.afterCompletion')) {
        case 'navigateToNote':
          return openDailyNoteFor(date);
        case 'createNote':
          return createDailyNoteIfNotExists(date);
      }
    })
  );
}
