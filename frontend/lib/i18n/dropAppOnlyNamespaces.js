/**
 * Turbopack loader for `packages/core/messages/*.json` in the web build (next.config.js).
 *
 * The three bundles are shared: the soul app and the officer app import them whole, and the
 * backend keeps Python copies of some namespaces that tests hold against them. These four are
 * read by no web code (`messageKeysAreReferenced.test.ts` checks that), so the web build drops
 * them instead of shipping them in the first-load zh-Hans pack. Jest still loads the full files.
 */
const WEB_UNREAD = ["official_notify", "soul_push", "soul_mail", "swipe"];

function dropAppOnlyNamespaces(source) {
  const bundle = JSON.parse(source);
  for (const ns of WEB_UNREAD) delete bundle[ns];
  return `export default ${JSON.stringify(bundle)};`;
}

module.exports = dropAppOnlyNamespaces;
module.exports.WEB_UNREAD = WEB_UNREAD;
