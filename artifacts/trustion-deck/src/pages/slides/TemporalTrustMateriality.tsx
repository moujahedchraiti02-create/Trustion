export default function TemporalTrustMateriality() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION F</div>
      <div className="bp-side-label">SECT. 06</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">Temporal trust + materiality</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 05 - OPERATIONAL GUARDRAILS</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">DRIFT: GNSS ↔ SERVER</span>
            <span className="block">ALERTS: SEVERITY-BANDED</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-[1.05fr_0.95fr] gap-[4vw]">
          <div className="bp-panel relative p-[2vw]">
            <div className="bp-panel-label">TEMPORAL TRUST CLASSIFICATION</div>
            <div className="mt-[3.5vh] border-l-[0.25vw] border-accent pl-[1.5vw]">
              <div className="text-[1.55vw] text-white">TRUSTED_GNSS</div>
              <div className="mt-[0.8vh] text-[1.25vw] text-[rgba(224,242,254,0.74)]">less than 5 minutes of timestamp drift</div>
            </div>
            <div className="mt-[3.4vh] border-l-[0.25vw] border-[rgba(125,211,252,0.58)] pl-[1.5vw]">
              <div className="text-[1.55vw] text-white">DRIFT_WARNING</div>
              <div className="mt-[0.8vh] text-[1.25vw] text-[rgba(224,242,254,0.74)]">5 minutes to 24 hours</div>
            </div>
            <div className="mt-[3.4vh] border-l-[0.25vw] border-[rgba(125,211,252,0.36)] pl-[1.5vw]">
              <div className="text-[1.55vw] text-white">BACKFILL</div>
              <div className="mt-[0.8vh] text-[1.25vw] text-[rgba(224,242,254,0.74)]">more than 24 hours</div>
            </div>
          </div>
          <div className="bp-panel p-[2vw]">
            <div className="bp-panel-label">MATERIALITY GUARD</div>
            <div className="mt-[4vh] border border-[rgba(125,211,252,0.38)] p-[1.4vw]">
              <div className="text-[1.55vw] text-white">WATCH</div>
            </div>
            <div className="mt-[2.3vh] border border-[rgba(125,211,252,0.58)] p-[1.4vw]">
              <div className="text-[1.55vw] text-white">LEGAL_WARNING</div>
            </div>
            <div className="mt-[2.3vh] border border-accent bg-[rgba(125,211,252,0.08)] p-[1.4vw]">
              <div className="text-[1.55vw] text-white">THRESHOLD_EXCEEDED</div>
            </div>
            <div className="mt-[3vh] text-[1.25vw] leading-[1.45] text-[rgba(224,242,254,0.72)]">
              Materiality Guard bands alerts as WATCH, LEGAL_WARNING, or THRESHOLD_EXCEEDED
            </div>
          </div>
        </section>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 06/08</span>
      </div>
    </div>
  );
}