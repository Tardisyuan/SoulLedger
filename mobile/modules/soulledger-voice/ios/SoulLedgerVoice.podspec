Pod::Spec.new do |s|
  s.name           = 'SoulLedgerVoice'
  s.version        = '0.0.0'
  s.summary        = 'Writes the numbers Siri may speak into the App Group'
  s.description    = 'Local Expo module shared by both SoulLedger apps. See mobile/src/voiceCache.ts.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = 'SoulLedger'
  s.homepage       = 'https://github.com/soulledger'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
