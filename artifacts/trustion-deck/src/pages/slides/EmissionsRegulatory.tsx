export default function EmissionsRegulatory() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION E</div>
      <div className="bp-side-label">SECT. 05</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">Emissions + regulatory intelligence</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 04 - POLICY-AWARE COMPUTATION</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">SCOPES: WTW / TTW</span>
            <span className="block">PROFILES: VERSIONED</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-[0.9fr_1.1fr] gap-[4vw]">
          <div className="bp-panel p-[2vw]">
            <div className="bp-panel-label">GAS INVENTORY / OUTPUTS</div>
            <div className="mt-[4vh] grid grid-cols-2 gap-[1vw]">
              <div className="border border-[rgba(125,211,252,0.4)] p-[1.3vw] text-[1.45vw] text-white">CO₂</div>
              <div className="border border-[rgba(125,211,252,0.4)] p-[1.3vw] text-[1.45vw] text-white">CH₄</div>
              <div className="border border-[rgba(125,211,252,0.4)] p-[1.3vw] text-[1.45vw] text-white">N₂O</div>
              <div className="border border-accent bg-[rgba(125,211,252,0.08)] p-[1.3vw] text-[1.45vw] text-white">CO₂e</div>
            </div>
            <div className="mt-[4vh] border-t border-[rgba(125,211,252,0.3)] pt-[2vh] text-[1.25vw] leading-[1.45] text-[rgba(224,242,254,0.75)]">
              Calculate CO₂, CH₄, N₂O, and CO₂e across Well-to-Wake and Tank-to-Wake scopes
            </div>
          </div>
          <div className="flex flex-col gap-[2.2vh]">
            <div className="bp-bullet">Keep FuelEU, IMO DCS, MARPOL, and CII parameters in versioned regulatory profiles</div>
            <div className="bp-bullet">Decouple policy parameters from application code so rules can evolve with the regime</div>
            <div className="mt-[2vh] border-t border-[rgba(125,211,252,0.3)] pt-[2vh] text-[1.25vw] leading-[1.45] text-[rgba(224,242,254,0.72)]">
              A policy-aware evidence layer keeps the calculation transparent as requirements change.
            </div>
          </div>
        </section>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 05/08</span>
      </div>
    </div>
  );
}