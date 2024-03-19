import { getNotesExtensions } from './settings';
import { withModifiedLoamConfiguration } from './test/test-utils-vscode';

describe('Default note settings', () => {
  it('should default to .md', async () => {
    const config = getNotesExtensions();
    expect(config.defaultExtension).toEqual('.md');
    expect(config.notesExtensions).toEqual(['.md']);
  });

  it('should always include the default note extension in the list of notes extensions', async () => {
    withModifiedLoamConfiguration(
      'files.defaultNoteExtension',
      'mdxx',
      async () => {
        const { notesExtensions } = getNotesExtensions();
        expect(notesExtensions).toEqual(['.mdxx']);

        withModifiedLoamConfiguration(
          'files.notesExtensions',
          'md markdown',
          async () => {
            const { notesExtensions } = getNotesExtensions();
            expect(notesExtensions).toEqual(
              expect.arrayContaining(['.mdxx', '.md', '.markdown'])
            );
          }
        );
      }
    );
  });
});
