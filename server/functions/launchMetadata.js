import { secrets } from '../runtime.js';
import { makeLaunchMetadataHandler } from '../shared/launchMetadata.js';

export default function(req, ctx) {
  return makeLaunchMetadataHandler({
    authenticate: () => ctx.auth.me(),
    getSecret: name => secrets.get(name),
  })(req);
}
