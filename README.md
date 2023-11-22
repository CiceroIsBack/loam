# Loam

_This is an early stage project under rapid development._

Loam is a fork of the excellent [Foam](https://github.com/foambubble/foam) VS Code extension. The goal of Loam is to enable better compatibilty with Logseq. This way one can easily open their Logseq folder in VS Code and get a comparable note-taking experience.

To see the features of Foam, check out [their README](https://github.com/foambubble/foam/blob/master/readme.md).

### Dev Info
Development is happening on the `dev` branch. The `master` branch is reserved for stable & tested releases.

To start developing, clone the repo, then run `yarn`. In VS Code, hit `F5` to start debug mode. A new VS Code window with the extension installed should open itself up automatically.
### Info

To enable automatic outlining and indenting, use the `Markdown All in One` extension.

Why the name "Loam"? Loam is a combination of "Logseq" + "Foam". Also, loam in the real world is rich soul that is good for growing plants. My hope is that Loam will be a good foundation for your knowledge garden, and help you grow your thoughts.

### Features to Implement

- [ ] support hierarchy in links (namespaces; has to change "/" to "\_\_")
- [ ] support for tags as links (incl in backlinks section)
- [ ] support for block ids
- [ ] support collapsed::true ??
- [ ] support TODO / DONE
- [ ] fix page embeds (just make it use Logseq formatting; the functionality is already there)
  - [ ] also support block embeds?
