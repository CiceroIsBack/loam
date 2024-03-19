/*global markdownit:readonly*/

import markdownItRegex from 'markdown-it-regex';
import { isNone } from '../../utils';
import { LoamWorkspace } from '../../core/model/workspace';
import { Logger } from '../../core/utils/log';

export const markdownItLoamTags = (
  md: markdownit,
  workspace: LoamWorkspace
) => {
  return md.use(markdownItRegex, {
    name: 'loam-tags',
    regex: /(?<=^|\s)(#[0-9]*[\p{L}/_-][\p{L}\p{N}/_-]*)/u,
    replace: (tag: string) => {
      try {
        const resource = workspace.find(tag);
        if (isNone(resource)) {
          return getLoamTag(tag);
        }
      } catch (e) {
        Logger.error(
          `Error while creating link for ${tag} in Preview panel`,
          e
        );
        return getLoamTag(tag);
      }
    },
  });
};

const getLoamTag = (content: string) =>
  `<span class='loam-tag'>${content}</span>`;

export default markdownItLoamTags;
