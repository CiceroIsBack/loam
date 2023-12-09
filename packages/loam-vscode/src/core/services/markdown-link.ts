import { ResourceLink } from '../model/note';

export abstract class MarkdownLink {
  private static wikilinkRegex = new RegExp(
    /\[\[([^#|]+)?#?([^|]+)?\|?(.*)?\]\]/
  );
  private static directLinkRegex = new RegExp(
    /\[(.*)\]\(<?([^#>]*)?#?([^\]>]+)?>?\)/
  );
  private static tagLinkRegex = new RegExp(/#(\S+)/);

  public static analyzeLink(link: ResourceLink) {
    try {
      if (link.type === 'wikilink') {
        const [, target, section, alias] = this.wikilinkRegex.exec(
          link.rawText
        );
        return {
          target: target?.replace(/\\/g, '') ?? '',
          section: section ?? '',
          alias: alias ?? '',
        };
      }
      if (link.type === 'link') {
        const [, alias, target, section] = this.directLinkRegex.exec(
          link.rawText
        );
        return {
          target: target ?? '',
          section: section ?? '',
          alias: alias ?? '',
        };
      }
      if (link.type === 'taglink') {
        const [, target] = this.tagLinkRegex.exec(link.rawText);
        return {
          target: target ?? '',
          section: '',
          alias: '',
        };
      }
      throw new Error(`Link of type ${link.type} is not supported`);
    } catch (e) {
      throw new Error(`Couldn't parse link ${link.rawText} - ${e}`);
    }
  }

  public static createUpdateLinkEdit(
    link: ResourceLink,
    delta: { target?: string; section?: string; alias?: string }
  ) {
    const { target, section, alias } = MarkdownLink.analyzeLink(link);
    const newTarget = delta.target ?? target;
    const newSection = delta.section ?? section ?? '';
    const newAlias = delta.alias ?? alias ?? '';
    const sectionDivider = newSection ? '#' : '';
    const aliasDivider = newAlias ? '|' : '';
    const embed = link.isEmbed ? '!' : '';
    if (link.type === 'wikilink') {
      return {
        newText: `${embed}[[${newTarget}${sectionDivider}${newSection}${aliasDivider}${newAlias}]]`,
        range: link.range,
      };
    }
    if (link.type === 'taglink') {
      return {
        newText: `${embed}#${newTarget}`,
        range: link.range,
      };
    }
    if (link.type === 'link') {
      return {
        newText: `${embed}[${newAlias}](${newTarget}${sectionDivider}${newSection})`,
        range: link.range,
      };
    }
    throw new Error(
      `Unexpected state: link of type ${link.type} is not supported`
    );
  }
}
