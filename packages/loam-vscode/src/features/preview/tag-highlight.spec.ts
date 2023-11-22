import MarkdownIt from 'markdown-it';
import { LoamWorkspace } from '../../core/model/workspace';
import { default as markdownItLoamTags } from './tag-highlight';

describe('Stylable tag generation in preview', () => {
  const md = markdownItLoamTags(MarkdownIt(), new LoamWorkspace());

  it('transforms a string containing multiple tags to a stylable html element', () => {
    expect(md.render(`Lorem #ipsum dolor #sit`)).toMatch(
      `<p>Lorem <span class='loam-tag'>#ipsum</span> dolor <span class='loam-tag'>#sit</span></p>`
    );
  });

  it('transforms a string containing a tag with dash', () => {
    expect(md.render(`Lorem ipsum dolor #si-t`)).toMatch(
      `<p>Lorem ipsum dolor <span class='loam-tag'>#si-t</span></p>`
    );
  });
});
