import ActivityKit
import ExpoModulesCore

/// One Live Activity at a time: `show` starts it, or updates the running one; a new title or tint (the language
/// or the civilization changed) ends it and starts another, because an activity's attributes cannot change.
/// No push token is requested: the activity is updated only while the app runs (mobile/src/liveProgress.ts).
public class SoulLedgerLiveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SoulLedgerLive")

    AsyncFunction("show") { (title: String, tint: String, state: String) async throws -> Bool in
      // The pod's floor is iOS 16.4, above ActivityKit's 16.2: no availability check.
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      let decoded = try JSONDecoder().decode(SoulLedgerLiveAttributes.ContentState.self, from: Data(state.utf8))
      let content = ActivityContent(state: decoded, staleDate: nil)
      let running = Activity<SoulLedgerLiveAttributes>.activities
      if let current = running.first, current.attributes.title == title, current.attributes.tint == tint {
        await current.update(content)
        return true
      }
      for activity in running { await activity.end(nil, dismissalPolicy: .immediate) }
      _ = try Activity.request(attributes: SoulLedgerLiveAttributes(title: title, tint: tint), content: content, pushType: nil)
      return true
    }

    AsyncFunction("end") { () async -> Void in
      for activity in Activity<SoulLedgerLiveAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
