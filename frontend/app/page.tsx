export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-16">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            SoulLedger
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Cross-civilization soul management system. Manage souls across Chinese Diyu,
            European Heaven & Hell, and Egyptian Duat — from a single platform.
          </p>
        </header>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <CivilizationCard
            title="Chinese Diyu"
            subtitle="中国地府"
            description="Ten Courts of Yama, Mengpo Soup, Six Realms of Reincarnation"
            color="from-red-600 to-amber-700"
          />
          <CivilizationCard
            title="European Heaven & Hell"
            subtitle="欧洲天堂地狱"
            description="Christian Tribunal, Purgatory, Dante's Circles, Lethe River"
            color="from-blue-600 to-indigo-800"
          />
          <CivilizationCard
            title="Egyptian Duat"
            subtitle="埃及冥界"
            description="Osiris Judgment, Heart Weighing against Ma'at Feather, Aaru"
            color="from-amber-500 to-yellow-700"
          />
        </div>

        <div className="mt-16 text-center">
          <p className="text-slate-500 text-sm">
            SoulLedger v0.1 — Built with Django + DRF + Next.js
          </p>
        </div>
      </div>
    </main>
  );
}

function CivilizationCard({
  title,
  subtitle,
  description,
  color,
}: {
  title: string;
  subtitle: string;
  description: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl bg-gradient-to-br ${color} p-px`}>
      <div className="bg-slate-900 rounded-xl p-6 h-full">
        <p className="text-2xl font-bold mb-1">{title}</p>
        <p className="text-sm text-slate-400 mb-4">{subtitle}</p>
        <p className="text-slate-300 text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
