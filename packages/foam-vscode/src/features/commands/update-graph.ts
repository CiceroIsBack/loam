import { commands, ExtensionContext } from 'vscode';
import { Loam } from '../../core/model/loam';

export const UPDATE_GRAPH_COMMAND_NAME = 'loam-vscode.update-graph';

export default async function activate(
  context: ExtensionContext,
  loamPromise: Promise<Loam>
) {
  context.subscriptions.push(
    commands.registerCommand(UPDATE_GRAPH_COMMAND_NAME, async () => {
      const loam = await loamPromise;
      return loam.graph.update();
    })
  );
}
