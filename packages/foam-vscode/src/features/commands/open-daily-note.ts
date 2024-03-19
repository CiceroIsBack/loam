import { ExtensionContext, commands } from 'vscode';
import { getLoamVsCodeConfig } from '../../services/config';
import { openDailyNoteFor } from '../../dated-notes';

export default async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('loam-vscode.open-daily-note', () =>
      openDailyNoteFor(new Date())
    )
  );

  if (getLoamVsCodeConfig('openDailyNote.onStartup', false)) {
    commands.executeCommand('loam-vscode.open-daily-note');
  }
}
