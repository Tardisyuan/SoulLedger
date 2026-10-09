/** The pure parts of withAppIntents.js (Swift source, .strings files, Info.plist, entitlements); dependency-free so jest can load them. */

const LANGS = ["en", "zh-Hans"];
const TOKEN = "${applicationName}";
/** Info.plist key the native module and the intents read the App Group id from; keep in step with modules/soulledger-voice. */
const GROUP_KEY = "SoulLedgerVoiceAppGroup";
/** The longest question a spoken ask hands to the app (the drawer's own limit, mobile/src/links.ts ASK_MAX_LENGTH). */
const ASK_MAX = 1000;

const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const structOf = (entry) => `Open${pascal(entry.id)}Intent`;
const readoutStructOf = (readout) => `Speak${pascal(readout.id)}Intent`;
const askStructOf = (ask) => `${pascal(ask.id)}Intent`;
const quoted = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const voiceKey = (entry, part) => `voice.${entry.id}.${part}`;

function lookup(messages, key) {
  const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages);
  if (typeof value !== "string" || value === "") throw new Error(`withAppIntents: no message "${key}".`);
  return value;
}

/** "Open To do" / "打开待办": the intent's title, from the tab's own word. `messages` is { en, "zh-Hans" }. Readouts and asks carry their own `title`. */
function titleOf(entry, lang, messages) {
  if (entry.title) return entry.title[lang];
  const label = lookup(messages[lang], entry.label);
  return lang === "en" ? `Open ${label}` : `打开${label}`;
}

/** Every phrase carries the app name token exactly once (Xcode's extractor rejects one that does not); languages pair up. */
function checkEntries(entries) {
  for (const entry of entries) {
    for (const lang of LANGS) {
      const phrases = entry.phrases?.[lang];
      if (!phrases || phrases.length === 0) throw new Error(`withAppIntents: "${entry.id}" has no ${lang} phrase.`);
      for (const phrase of phrases) {
        if (phrase.split(TOKEN).length !== 2) throw new Error(`withAppIntents: phrase "${phrase}" must contain ${TOKEN} exactly once.`);
      }
    }
    if (entry.phrases.en.length !== entry.phrases["zh-Hans"].length) throw new Error(`withAppIntents: "${entry.id}" needs as many zh-Hans phrases as en ones.`);
  }
}

/** Readouts and asks are checked for the strings they speak or show, in both languages. */
function checkSpoken({ readouts = [], asks = [] }) {
  for (const r of readouts) {
    for (const part of ["title", "line", "zero", "empty"]) {
      for (const lang of LANGS) if (!r[part]?.[lang]) throw new Error(`withAppIntents: readout "${r.id}" has no ${lang} ${part}.`);
    }
    for (const part of ["line", "zero"]) {
      for (const lang of LANGS) {
        if (r[part][lang].split("%@").length !== 2) throw new Error(`withAppIntents: readout "${r.id}" ${part} (${lang}) needs %@ exactly once.`);
      }
    }
    for (const lang of LANGS) {
      if (r.line[lang].split("%lld").length !== 2) throw new Error(`withAppIntents: readout "${r.id}" line (${lang}) needs %lld exactly once.`);
      // String(format:) is positional: the time is passed first, the number second, in every language.
      if (r.line[lang].indexOf("%@") > r.line[lang].indexOf("%lld")) throw new Error(`withAppIntents: readout "${r.id}" line (${lang}) must put %@ before %lld.`);
      if (r.empty[lang].includes("%")) throw new Error(`withAppIntents: readout "${r.id}" empty line (${lang}) takes no number or time.`);
    }
    if (!r.cache) throw new Error(`withAppIntents: readout "${r.id}" has no cache key.`);
  }
  for (const a of asks) {
    for (const part of ["title", "parameter", "prompt"]) {
      for (const lang of LANGS) if (!a[part]?.[lang]) throw new Error(`withAppIntents: ask "${a.id}" has no ${lang} ${part}.`);
    }
    if (!/^[a-z]+$/.test(a.path)) throw new Error(`withAppIntents: ask "${a.id}" path must be plain letters.`);
  }
}

const readoutSwift = (r) => `@available(iOS 16.0, *)
struct ${readoutStructOf(r)}: AppIntent {
  static let title: LocalizedStringResource = ${quoted(r.title.en)}
  // Siri unlocks the phone before it speaks this. What it speaks is a number and a time, nothing else.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let line = VoiceCache.sentence(
      key: ${quoted(r.cache)},
      line: NSLocalizedString(${quoted(voiceKey(r, "line"))}, comment: ""),
      zero: NSLocalizedString(${quoted(voiceKey(r, "zero"))}, comment: ""),
      empty: NSLocalizedString(${quoted(voiceKey(r, "empty"))}, comment: "")
    )
    return .result(dialog: "\\(line)")
  }
}`;

const askSwift = (scheme, a) => `@available(iOS 16.0, *)
struct ${askStructOf(a)}: AppIntent {
  static let title: LocalizedStringResource = ${quoted(a.title.en)}
  static let openAppWhenRun: Bool = true

  @Parameter(title: ${quoted(a.parameter.en)}, requestValueDialog: ${quoted(a.prompt.en)})
  var question: String

  // The app gets the question in the box and nothing more: it is the person who presses send.
  @MainActor
  func perform() async throws -> some IntentResult {
    let text = String(question.trimmingCharacters(in: .whitespacesAndNewlines).prefix(${ASK_MAX}))
    if !text.isEmpty,
       let encoded = text.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
       let url = URL(string: ${quoted(`${scheme}://${a.path}?q=`)} + encoded) {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}`;

/** The App Group cache, read-only; what soulledger-voice's setNumber wrote (keys "voice.<key>" and "voice.<key>.at", at in ms). */
const CACHE_SWIFT = `enum VoiceCache {
  static func read(_ key: String) -> (value: Int, at: Date)? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "${GROUP_KEY}") as? String,
          let defaults = UserDefaults(suiteName: group),
          let value = defaults.object(forKey: "voice.\\(key)") as? Double,
          let at = defaults.object(forKey: "voice.\\(key).at") as? Double else { return nil }
    return (Int(value), Date(timeIntervalSince1970: at / 1000))
  }

  /** "HH:mm" today, with the date when the number is older than today. */
  static func stamp(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateStyle = Calendar.current.isDateInToday(date) ? .none : .short
    formatter.timeStyle = .short
    return formatter.string(from: date)
  }

  static func sentence(key: String, line: String, zero: String, empty: String) -> String {
    guard let (value, at) = read(key) else { return empty }
    return String(format: value == 0 ? zero : line, stamp(at), value)
  }
}`;

/**
 * ShortcutIntents.swift. Each open-intent opens its deep link in the app (`openAppWhenRun`), so the JS
 * side routes it exactly as it routes a tapped launcher shortcut. Readout intents speak a cached number
 * (see voiceEntries.js); ask intents open 问一问 with a question in the box. Phrases here are the English
 * ones; other languages come from AppShortcuts.strings, keyed by these same texts.
 */
function swiftSource({ scheme, provider, entries, readouts = [], asks = [] }, messages) {
  checkEntries([...entries, ...readouts, ...asks]);
  checkSpoken({ readouts, asks });
  const intents = [
    ...entries.map(
      (e) => `@available(iOS 16.0, *)
struct ${structOf(e)}: AppIntent {
  static let title: LocalizedStringResource = ${quoted(titleOf(e, "en", messages))}
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    if let url = URL(string: ${quoted(`${scheme}://${e.path}`)}) {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}`
    ),
    ...readouts.map(readoutSwift),
    ...asks.map((a) => askSwift(scheme, a)),
  ].join("\n\n");
  const shortcut = (struct, e) => {
    const phrases = e.phrases.en.map((p) => quoted(p).replace(TOKEN, "\\(.applicationName)")).join(", ");
    return `    AppShortcut(
      intent: ${struct}(),
      phrases: [${phrases}],
      shortTitle: ${quoted(titleOf(e, "en", messages))},
      systemImageName: ${quoted(e.symbol)}
    )`;
  };
  const shortcuts = [
    ...entries.map((e) => shortcut(structOf(e), e)),
    ...readouts.map((r) => shortcut(readoutStructOf(r), r)),
    ...asks.map((a) => shortcut(askStructOf(a), a)),
  ].join("\n");
  return `// Generated by mobile/plugins/withAppIntents.js -- do not edit; edit voiceEntries.js.
// Opens a page, speaks a cached number, or puts a question in the box; nothing here decides anything.
import AppIntents
import UIKit

${readouts.length ? CACHE_SWIFT + "\n\n" : ""}${intents}

@available(iOS 16.0, *)
struct ${provider}: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
${shortcuts}
  }
}
`;
}

const allEntries = ({ entries, readouts = [], asks = [] }) => [...entries, ...readouts, ...asks];

/** <lang>.lproj/AppShortcuts.strings: the English phrase (as in the Swift) -> that language's phrase. */
function appShortcutsStrings(def, lang) {
  const list = allEntries(def);
  checkEntries(list);
  const lines = [];
  for (const e of list) e.phrases.en.forEach((phrase, i) => lines.push(`${quoted(phrase)} = ${quoted(e.phrases[lang][i])};`));
  return lines.join("\n") + "\n";
}

/**
 * <lang>.lproj/Localizable.strings: the intents' titles (the English title is the key), the ask
 * parameter's name and prompt (English text is the key), and the readouts' sentences (`voice.<id>.line|zero|empty`).
 */
function localizableStrings(def, lang, messages) {
  const { readouts = [], asks = [] } = def;
  const lines = allEntries(def).map((e) => `${quoted(titleOf(e, "en", messages))} = ${quoted(titleOf(e, lang, messages))};`);
  for (const r of readouts) for (const part of ["line", "zero", "empty"]) lines.push(`${quoted(voiceKey(r, part))} = ${quoted(r[part][lang])};`);
  for (const a of asks) {
    lines.push(`${quoted(a.parameter.en)} = ${quoted(a.parameter[lang])};`);
    lines.push(`${quoted(a.prompt.en)} = ${quoted(a.prompt[lang])};`);
  }
  return lines.join("\n") + "\n";
}

/** The App Group both the app and its intents use: derived from the bundle id, so each app has its own. */
function appGroupOf(bundleId) {
  if (typeof bundleId !== "string" || !/^[A-Za-z0-9.-]+$/.test(bundleId)) throw new Error(`withAppIntents: ios.bundleIdentifier "${bundleId}" is not usable for an App Group.`);
  return `group.${bundleId}`;
}

/** Info.plist: the languages the strings exist in, the names Siri also accepts for ${applicationName}, and the App Group id. */
function applyInfoPlist(plist, { alternativeNames }, group) {
  plist.CFBundleLocalizations = [...new Set([...(plist.CFBundleLocalizations ?? []), ...LANGS])];
  plist.INAlternativeAppNames = alternativeNames.map((name) => ({ INAlternativeAppName: name }));
  if (group) plist[GROUP_KEY] = group;
  return plist;
}

/** The entitlements: the App Group, added to whatever groups are there. */
function applyEntitlements(entitlements, group) {
  const key = "com.apple.security.application-groups";
  entitlements[key] = [...new Set([...(entitlements[key] ?? []), group])];
  return entitlements;
}

module.exports = {
  ASK_MAX,
  GROUP_KEY,
  LANGS,
  TOKEN,
  appGroupOf,
  appShortcutsStrings,
  applyEntitlements,
  applyInfoPlist,
  askStructOf,
  checkEntries,
  checkSpoken,
  localizableStrings,
  lookup,
  readoutStructOf,
  structOf,
  swiftSource,
  titleOf,
};
