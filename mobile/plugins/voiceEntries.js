/**
 * The one list of "open this page" entry points the system offers outside the app, for both apps:
 * Android launcher shortcuts (withAndroidShortcuts.js) and iOS App Intents / Siri (withAppIntents.js).
 * Each entry is a deep link (see src/links.ts of each app); none of them decides, approves or submits.
 *
 * `label` is a key in packages/core/messages, so a shortcut says what the tab says.
 * `phrases` are the Siri sentences. `${applicationName}` is required in every one (the metadata
 * extractor rejects a phrase without it); it is replaced by the app's display name, or by a name in
 * `alternativeNames` -- the Chinese name people actually say.
 *
 * `readouts` are the "say a number" intents (phase 2, scheme A): they open nothing and call nothing.
 * The app's JS writes the number into the App Group (src/voiceCache.ts) under `cache`; the intent
 * speaks `line` (%@ = the time it was fetched, %lld = the number), `zero` when the number is 0, and
 * `empty` when nothing has been fetched yet or the user signed out. Numbers only, never content.
 * `asks` take a spoken String and open the app on `scheme://path?q=<it>` (not sent). These strings
 * are plugin-local, for iOS system speech in en / zh-Hans: there is no egy here, so no Design wording is owed.
 */
const APPS = {
  officer: {
    scheme: "soulledger-officer",
    provider: "OfficerShortcuts",
    alternativeNames: ["灵魂簿官员"],
    readouts: [
      {
        id: "todoCount",
        cache: "todo",
        symbol: "number.circle",
        title: { en: "How many to do", "zh-Hans": "待办数量" },
        phrases: {
          en: ["How many to do in ${applicationName}", "${applicationName} to do count"],
          "zh-Hans": ["${applicationName}有几件待办", "用${applicationName}查待办数量"],
        },
        line: { en: "As of %@, %lld items are waiting for you.", "zh-Hans": "截至 %@,有 %lld 件待你处理。" },
        zero: { en: "As of %@, nothing is waiting for you.", "zh-Hans": "截至 %@,没有待你处理的事项。" },
        empty: { en: "I have no count yet. Open the app once, then ask again.", "zh-Hans": "还没有数据。请先打开 App 看一眼,再来问我。" },
      },
    ],
    asks: [],
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
    readouts: [
      {
        id: "cooldownDays",
        cache: "cooldown",
        symbol: "hourglass",
        title: { en: "Days of cooldown left", "zh-Hans": "冷却还剩几天" },
        phrases: {
          en: ["How long is my cooldown in ${applicationName}", "Check my cooldown in ${applicationName}"],
          "zh-Hans": ["${applicationName}冷却还剩几天", "用${applicationName}查冷却"],
        },
        line: { en: "As of %@, your cooldown has %lld days left.", "zh-Hans": "截至 %@,冷却还剩 %lld 天。" },
        zero: { en: "As of %@, you are not in a cooldown.", "zh-Hans": "截至 %@,当前没有冷却期。" },
        empty: { en: "I have no number yet. Open the app once, then ask again.", "zh-Hans": "还没有数据。请先打开 App 看一眼,再来问我。" },
      },
    ],
    asks: [
      {
        id: "ask",
        path: "ask",
        symbol: "text.bubble",
        title: { en: "Ask a question", "zh-Hans": "提问" },
        parameter: { en: "Question", "zh-Hans": "问题" },
        prompt: { en: "What would you like to ask?", "zh-Hans": "你想问什么?" },
        phrases: {
          en: ["Ask ${applicationName} a question", "Ask ${applicationName} for help"],
          "zh-Hans": ["向${applicationName}提问", "问${applicationName}一个问题"],
        },
      },
    ],
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
