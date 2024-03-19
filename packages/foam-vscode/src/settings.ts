import { workspace, GlobPattern } from 'vscode';
import { uniq } from 'lodash';
import { LogLevel } from './core/utils/log';
import { getLoamVsCodeConfig } from './services/config';

/**
 * Gets the notes extensions and default extension from the config.
 *
 * @returns {notesExtensions: string[], defaultExtension: string}
 */
export function getNotesExtensions() {
  const notesExtensionsFromSetting = getLoamVsCodeConfig(
    'files.notesExtensions',
    ''
  )
    .split(' ')
    .filter(ext => ext.trim() !== '')
    .map(ext => '.' + ext.trim());
  const defaultExtension =
    '.' +
    (getLoamVsCodeConfig('files.defaultNoteExtension', 'md') ?? 'md').trim();

  // we make sure that the default extension is always included in the list of extensions
  const notesExtensions = uniq(
    notesExtensionsFromSetting.concat(defaultExtension)
  );

  return { notesExtensions, defaultExtension };
}

/**
 * Gets the attachment extensions from the config.
 *
 * @returns string[]
 */
export function getAttachmentsExtensions() {
  return getLoamVsCodeConfig('files.attachmentExtensions', '')
    .split(' ')
    .map(ext => '.' + ext.trim());
}

export function getWikilinkDefinitionSetting():
  | 'withExtensions'
  | 'withoutExtensions'
  | 'off' {
  return workspace
    .getConfiguration('loam.edit')
    .get('linkReferenceDefinitions', 'withoutExtensions');
}

/** Retrieve the list of file ignoring globs. */
export function getIgnoredFilesSetting(): GlobPattern[] {
  return [
    '**/.loam/**',
    ...workspace.getConfiguration().get('loam.files.ignore', []),
    ...Object.keys(workspace.getConfiguration().get('files.exclude', {})),
  ];
}

/** Retrieves the maximum length for a Graph node title. */
export function getTitleMaxLength(): number {
  return workspace.getConfiguration('loam.graph').get('titleMaxLength');
}

/** Retrieve the graph's style object */
export function getGraphStyle(): object {
  return workspace.getConfiguration('loam.graph').get('style');
}

export function getLoamLoggerLevel(): LogLevel {
  return workspace.getConfiguration('loam.logging').get('level') ?? 'info';
}

/** Retrieve the orphans configuration */
export function getOrphansConfig(): GroupedResourcesConfig {
  const orphansConfig = workspace.getConfiguration('loam.orphans');
  const exclude: string[] = orphansConfig.get('exclude');
  return { exclude };
}

/** Retrieve the placeholders configuration */
export function getPlaceholdersConfig(): GroupedResourcesConfig {
  const placeholderCfg = workspace.getConfiguration('loam.placeholders');
  const exclude: string[] = placeholderCfg.get('exclude');
  return { exclude };
}

export interface GroupedResourcesConfig {
  exclude: string[];
}
