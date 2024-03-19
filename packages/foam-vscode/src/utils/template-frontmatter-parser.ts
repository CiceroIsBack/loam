import matter from 'gray-matter';

export function extractLoamTemplateFrontmatterMetadata(
  contents: string
): [Map<string, string>, string] {
  // Need to pass in empty options object, in order to bust a cache
  // See https://github.com/jonschlinkert/gray-matter/issues/124
  const parsed = matter(contents, {});
  let metadata = new Map<string, string>();

  if (parsed.language !== 'yaml') {
    // We might allow this in the future, once it has been tested adequately.
    // But for now we'll be safe and prevent people from using anything else.
    return [metadata, contents];
  }

  const frontmatter = parsed.data;
  const frontmatterKeys = Object.keys(frontmatter);
  const loamMetadata = frontmatter['loam_template'];

  if (typeof loamMetadata !== 'object') {
    return [metadata, contents];
  }

  const containsLoam = loamMetadata !== undefined;
  const onlyLoam = containsLoam && frontmatterKeys.length === 1;
  metadata = new Map<string, string>(
    Object.entries((loamMetadata as object) || {})
  );

  let newContents = contents;
  if (containsLoam) {
    if (onlyLoam) {
      // We'll remove the entire frontmatter block
      newContents = parsed.content;

      // If there is another frontmatter block, we need to remove
      // the leading space left behind.
      const anotherFrontmatter = matter(newContents.trimStart()).matter !== '';
      if (anotherFrontmatter) {
        newContents = newContents.trimStart();
      }
    } else {
      // We'll remove only the Loam bits
      newContents = removeLoamMetadata(contents);
    }
  }

  return [metadata, newContents];
}

export function removeLoamMetadata(contents: string) {
  return contents.replace(
    /^\s*loam_template:.*?\n(?:\s*(?:filepath|name|description):.*\n)+/gm,
    ''
  );
}
