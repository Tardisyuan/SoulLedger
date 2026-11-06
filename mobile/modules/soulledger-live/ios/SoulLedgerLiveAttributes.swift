import ActivityKit
import Foundation

/// The Live Activity's data. ActivityKit pairs the app's request with the widget's view by this type, so the
/// widget extension compiles THIS FILE too: plugins/withLiveActivity.js copies it next to the widget's view.
/// Keep the field names in step with `nativeState` in mobile/src/liveProgress.ts (the JSON the app sends).
/// Every string is already in the soul's language; nothing here translates or formats.
public struct SoulLedgerLiveAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var tag: String
    public var headline: String
    public var count: String
    public var compact: String
    public var place: String
    public var island: String
    public var first: String
    public var current: String
    public var last: String
    public var progress: Double
    public var ended: Bool
  }

  /// 「灵魂簿 · 实时进度」, in the soul's language when the activity started.
  public var title: String
  /// The civilization's glow (#RRGGBB): the progress and the mark.
  public var tint: String

  public init(title: String, tint: String) {
    self.title = title
    self.tint = tint
  }
}
