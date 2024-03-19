/*global markdownit:readonly*/

import * as vscode from 'vscode';
import { Loam } from '../../core/model/loam';
import { default as markdownItLoamTags } from './tag-highlight';
import { default as markdownItWikilinkNavigation } from './wikilink-navigation';
import { default as markdownItRemoveLinkReferences } from './remove-wikilink-references';
import { default as markdownItWikilinkEmbed } from './wikilink-embed';

export default async function activate(
  context: vscode.ExtensionContext,
  loamPromise: Promise<Loam>
) {
  const loam = await loamPromise;

  return {
    extendMarkdownIt: (md: markdownit) => {
      return [
        markdownItWikilinkEmbed,
        markdownItLoamTags,
        markdownItWikilinkNavigation,
        markdownItRemoveLinkReferences,
      ].reduce(
        (acc, extension) =>
          extension(acc, loam.workspace, loam.services.parser),
        md
      );
    },
  };
}
