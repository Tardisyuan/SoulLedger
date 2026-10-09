/**
 * The one list of "open this page" entry points the system offers outside the app, for both apps:
 * Android launcher shortcuts (withAndroidShortcuts.js) and iOS App Intents / Siri (withAppIntents.js).
 * Each entry is a deep link (see src/links.ts of each app); none of them decides, approves or submits.
 *
 * `label` is a key in packages/core/messages, so a shortcut says what the tab says.
 * `phrases` are the Siri sentences. `${applicationName}` is required in every one (the metadata
 * extractor rejects a phrase without it); it is replaced by the app's display name, or by a name in
 * `alternativeNames` -- the Chinese name people actually say.
 */
const APPS = {
  officer: {
    scheme: "soulledger-officer",
    provider: "OfficerShortcuts",
    alternativeNames: ["灵魂簿官员"],
    entries: [
      {
        id: "todo",
        path: "todo",
        label: "officer_app.tabs.todo",
        symbol: "checklist",
        phrases: {
          en: ["Open ${applicationName} to do", "Open my to do in ${applicationName}"],
          "zh-Hans": ["用${applicationName}打开待办", "打开${applicationName}的待办"],
        },
      },
      {
        id: "queue",
        path: "queue",
        label: "officer_app.tabs.queue",
        symbol: "building.columns",
        phrases: {
          en: ["Open ${applicationName} judgments", "Open judgments in ${applicationName}"],
          "zh-Hans": ["用${applicationName}打开审判", "打开${applicationName}的审判"],
        },
      },
    ],
  },
  soul: {
    scheme: "soulledger",
    provider: "SoulShortcuts",
    alternativeNames: ["灵魂簿"],
    entries: [
      {
        id: "life",
        path: "life",
        label: "soul_app.tabs.life",
        symbol: "leaf",
        phrases: {
          en: ["Open ${applicationName} this life", "Open this life in ${applicationName}"],
          "zh-Hans": ["打开${applicationName}的本世", "用${applicationName}打开本世"],
        },
      },
      {
        id: "assist",
        path: "assist",
        label: "soul_app.assist.title",
        symbol: "questionmark.bubble",
        phrases: {
          en: ["Open Ask in ${applicationName}", "Ask a question in ${applicationName}"],
          "zh-Hans": ["打开${applicationName}的问一问", "用${applicationName}问一问"],
        },
      },
    ],
  },
};

function appOf(name) {
  const app = APPS[name];
  if (!app) throw new Error(`voiceEntries: unknown app "${name}" (expected ${Object.keys(APPS).join(" or ")}).`);
  return app;
}

module.exports = { APPS, appOf };
