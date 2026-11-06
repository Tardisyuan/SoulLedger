Pod::Spec.new do |s|
  s.name           = 'SoulLedgerLive'
  s.version        = '0.0.0'
  s.summary        = 'Starts, updates and ends the soul app Live Activity'
  s.description    = 'Local Expo module. See mobile/src/liveProgress.ts; the views are the widget extension plugins/withLiveActivity.js adds.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = 'SoulLedger'
  s.homepage       = 'https://github.com/soulledger'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'ActivityKit'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
