import {
  extractLoamTemplateFrontmatterMetadata,
  removeLoamMetadata,
} from './template-frontmatter-parser';

describe('extractLoamTemplateFrontmatterMetadata', () => {
  test('Returns an empty object if there is not frontmatter', () => {
    const input = `# $FOAM_TITLE`;
    const expectedMetadata = new Map<string, string>();
    const expected = [expectedMetadata, input];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns an empty object if `loam_template` is not used', () => {
    const input = `---
foo: bar
---

# $FOAM_TITLE
`;

    const expectedMetadata = new Map<string, string>();
    const expected = [expectedMetadata, input];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns an empty object if loam_template is not a YAML mapping', () => {
    const input = `---json
{
  "foo": "bar",
  "loam_template": 4
}
---

# $FOAM_TITLE
`;

    const expectedMetadata = new Map<string, string>();
    const expected = [expectedMetadata, input];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns an empty object if frontmatter is not YAML', () => {
    const input = `---json
{
  "foo": "bar",
  "loam_template": {
    "filepath": "journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md"
  }
}
---

# $FOAM_TITLE
`;

    const expectedMetadata = new Map<string, string>();
    const expected = [expectedMetadata, input];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns the `loam_template` metadata when it is used in its own frontmatter block', () => {
    const input = `---
loam_template:
  name: My Note Template
  description: This is my note template
  filepath: journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md
---

# $FOAM_TITLE
`;

    const output = `
# $FOAM_TITLE
`;

    const expectedMetadata = new Map<string, string>();
    expectedMetadata.set('name', 'My Note Template');
    expectedMetadata.set('description', 'This is my note template');
    expectedMetadata.set(
      'filepath',
      'journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md'
    );
    const expected = [expectedMetadata, output];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns the `loam_template` metadata when it is used in its own frontmatter block (and there is another frontmatter block after)', () => {
    const input = `---
loam_template:
  filepath: journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md
  description: This is my note template
  name: My Note Template
---

---
foo: bar
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE
`;

    const output = `---
foo: bar
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE
`;

    const expectedMetadata = new Map<string, string>();
    expectedMetadata.set('name', 'My Note Template');
    expectedMetadata.set('description', 'This is my note template');
    expectedMetadata.set(
      'filepath',
      'journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md'
    );
    const expected = [expectedMetadata, output];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });

  test('Returns the `loam_template` metadata when it is used in a shared frontmatter block', () => {
    const input = `---
foo: bar
loam_template:
  name: My Note Template
  filepath: journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md
  description: This is my note template
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE`;

    const output = `---
foo: bar
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE`;

    const expectedMetadata = new Map<string, string>();
    expectedMetadata.set('name', 'My Note Template');
    expectedMetadata.set('description', 'This is my note template');
    expectedMetadata.set(
      'filepath',
      'journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md'
    );
    const expected = [expectedMetadata, output];
    const result = extractLoamTemplateFrontmatterMetadata(input);
    expect(result).toEqual(expected);
  });
});

describe('removeLoamMetadata', () => {
  test('Removes Loam specific frontmatter without messing up non-Loam frontmatter', () => {
    const input = `---
foo: bar
loam_template: &loam_template # A YAML comment
  description: This is my note template
  filepath: journal/$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE_$FOAM_TITLE.md # A YAML comment
  name: My Note Template
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE`;

    const expected = `---
foo: bar
# A YAML comment
metadata: &info
  title: The Gentlemen
  year: 2019
more_metadata: *info
---

# $FOAM_TITLE`;

    const result = removeLoamMetadata(input);
    expect(result).toEqual(expected);
  });
});
