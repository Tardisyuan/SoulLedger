import ExpoModulesCore

/// Puts a number and the time it was fetched into the App Group's UserDefaults, where the App
/// Intents (plugins/appIntents.js, VoiceCache) read them. Keys: "voice.<key>" and "voice.<key>.at"
/// (milliseconds since 1970). The group id is the Info.plist's SoulLedgerVoiceAppGroup, which
/// plugins/withAppIntents.js writes next to the entitlement. Nothing here touches the network or a token.
public class SoulLedgerVoiceModule: Module {
  private static let prefix = "voice."

  private static func defaults() -> UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "SoulLedgerVoiceAppGroup") as? String else { return nil }
    return UserDefaults(suiteName: group)
  }

  public func definition() -> ModuleDefinition {
    Name("SoulLedgerVoice")

    Function("setNumber") { (key: String, value: Double, at: Double) in
      guard let defaults = Self.defaults() else { return }
      defaults.set(value, forKey: "\(Self.prefix)\(key)")
      defaults.set(at, forKey: "\(Self.prefix)\(key).at")
    }

    /// Sign-out: every number goes, so a signed-out phone speaks "open the app first".
    Function("clear") {
      guard let defaults = Self.defaults() else { return }
      for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.prefix) {
        defaults.removeObject(forKey: key)
      }
    }
  }
}
