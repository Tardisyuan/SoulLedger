// Full-page navigations as functions, so a test can see them.
// jsdom's `window.location` is non-configurable: a test cannot swap it for a
// spy, and assigning to it only logs "not implemented: navigation".
export const goTo = (path: string) => {
  window.location.href = path;
};
export const replaceWith = (path: string) => {
  window.location.replace(path);
};
