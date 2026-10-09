/**
 * The iOS 27 scene-lifecycle plugin (plugins/withSceneLifecycle.js) rewrites the SDK 57
 * AppDelegate template. Without it both apps quit at launch on iOS 27 (seen 2026-10-09).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adoptScenes } = require("../../plugins/adoptScenes");

// The SDK 57 prebuild template's AppDelegate (the part the plugin touches).
const TEMPLATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe("withSceneLifecycle", () => {
  it("makes AppDelegate the factory provider and leaves the window to the scene delegate", () => {
    const out: string = adoptScenes(TEMPLATE);
    expect(out).toContain("class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
    expect(out).not.toContain("startReactNative");
    expect(out).not.toContain("UIWindow(frame:");
    // The factory itself is still created here: the scene delegate reads it.
    expect(out).toContain("reactNativeFactory = factory");
  });

  it("is idempotent", () => {
    const once: string = adoptScenes(TEMPLATE);
    expect(adoptScenes(once)).toBe(once);
  });

  it("fails loudly when the template changes shape", () => {
    expect(() => adoptScenes(TEMPLATE.replace("UIWindow(frame: UIScreen.main.bounds)", "UIWindow()"))).toThrow(/no longer matches/);
  });
});
