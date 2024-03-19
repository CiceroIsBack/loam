/*global markdownit:readonly*/

import { workspace, ExtensionContext, window, commands } from 'vscode';
import { MarkdownResourceProvider } from './core/services/markdown-provider';
import { bootstrap } from './core/model/loam';
import { Logger } from './core/utils/log';
import * as vscode from 'vscode';
import { features } from './features';
import { VsCodeOutputLogger, exposeLogger } from './services/logging';
import {
  getAttachmentsExtensions,
  getIgnoredFilesSetting,
  getNotesExtensions,
} from './settings';
import { AttachmentResourceProvider } from './core/services/attachment-provider';
import { VsCodeWatcher } from './services/watcher';
import { createMarkdownParser } from './core/services/markdown-parser';
import VsCodeBasedParserCache from './services/cache';
import { createMatcherAndDataStore } from './services/editor';
import { getLoamVsCodeConfig } from './services/config';

export async function activate(context: ExtensionContext) {
  const logger = new VsCodeOutputLogger();
  Logger.setDefaultLogger(logger);
  exposeLogger(context, logger);

  try {
    Logger.info('Starting Loam');

    if (workspace.workspaceFolders === undefined) {
      Logger.info('No workspace open. Loam will not start');
      return;
    }

    // Prepare Loam
    const excludes = getIgnoredFilesSetting().map(g => g.toString());
    const { matcher, dataStore, excludePatterns } =
      await createMatcherAndDataStore(excludes);

    Logger.info('Loading from directories:');
    for (const folder of workspace.workspaceFolders) {
      Logger.info('- ' + folder.uri.fsPath);
      Logger.info('  Include: **/*');
      Logger.info('  Exclude: ' + excludePatterns.get(folder.name).join(','));
    }

    const watcher = new VsCodeWatcher(
      workspace.createFileSystemWatcher('**/*')
    );
    const parserCache = new VsCodeBasedParserCache(context);
    const parser = createMarkdownParser([], parserCache);

    const { notesExtensions, defaultExtension } = getNotesExtensions();

    const markdownProvider = new MarkdownResourceProvider(
      dataStore,
      parser,
      notesExtensions
    );

    const attachmentExtConfig = getAttachmentsExtensions();
    const attachmentProvider = new AttachmentResourceProvider(
      attachmentExtConfig
    );

    const loamPromise = bootstrap(
      matcher,
      watcher,
      dataStore,
      parser,
      [markdownProvider, attachmentProvider],
      defaultExtension
    );

    // Load the features
    const featuresPromises = features.map(feature =>
      feature(context, loamPromise)
    );

    const loam = await loamPromise;
    Logger.info(`Loaded ${loam.workspace.list().length} resources`);

    context.subscriptions.push(
      loam,
      watcher,
      markdownProvider,
      attachmentProvider,
      commands.registerCommand('loam-vscode.clear-cache', () =>
        parserCache.clear()
      ),
      workspace.onDidChangeConfiguration(e => {
        if (
          [
            'loam.files.ignore',
            'loam.files.attachmentExtensions',
            'loam.files.noteExtensions',
            'loam.files.defaultNoteExtension',
          ].some(setting => e.affectsConfiguration(setting))
        ) {
          window.showInformationMessage(
            'Loam: Reload the window to use the updated settings'
          );
        }
      })
    );

    const feats = (await Promise.all(featuresPromises)).filter(r => r != null);

    let config = vscode.workspace.getConfiguration('files');
    config.update(
      'exclude',
      { 'logseq/*': true },
      vscode.ConfigurationTarget.Workspace
    );

    return {
      extendMarkdownIt: (md: markdownit) => {
        return feats.reduce((acc: markdownit, r: any) => {
          return r.extendMarkdownIt ? r.extendMarkdownIt(acc) : acc;
        }, md);
      },
      loam,
    };
  } catch (e) {
    Logger.error('An error occurred while bootstrapping Loam', e);
    window.showErrorMessage(
      `An error occurred while bootstrapping Loam. ${e.stack}`
    );
  }
}
