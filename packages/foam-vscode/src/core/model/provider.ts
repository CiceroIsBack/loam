import { IDisposable } from '../common/lifecycle';
import { Resource, ResourceLink } from './note';
import { URI } from './uri';
import { LoamWorkspace } from './workspace';

export interface ResourceProvider extends IDisposable {
  supports: (uri: URI) => boolean;
  readAsMarkdown: (uri: URI) => Promise<string | null>;
  fetch: (uri: URI) => Promise<Resource | null>;
  resolveLink: (
    workspace: LoamWorkspace,
    resource: Resource,
    link: ResourceLink
  ) => URI;
}
