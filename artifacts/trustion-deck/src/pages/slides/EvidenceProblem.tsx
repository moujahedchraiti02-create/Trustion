export default function EvidenceProblem() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION B</div>
      <div className="bp-side-label">SECT. 02</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">The evidence problem</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 01 - TRUST GAP</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">SYSTEM STATE: UNVERIFIED</span>
            <span className="block">INPUT CLASS: TELEMETRY</span>
          </div>
        </header>
        <section className="mt-[6vh] grid grid-cols-[1.1fr_0.9fr] gap-[5vw]">
          <div className="flex flex-col gap-[3.3vh]">
            <div className="bp-bullet">Vessel telemetry is operational data until its origin and timing can be trusted</div>
            <div className="bp-bullet">Compliance evidence needs a durable record of fuel, load, position, and emissions</div>
            <div className="bp-bullet">Auditors need to verify what happened without rewriting the underlying record</div>
          </div>
          <div className="bp-panel relative min-h-[43vh] p-[2vw]">
            <div className="bp-panel-label">DIAGRAM A.1 / FROM SIGNAL TO RECORD</div>
            <div className="absolute left-[5vw] right-[5vw] top-[22vh] border-t border-dashed border-accent" />
            <div className="bp-diagram-node left-[2.5vw] top-[18vh] h-[8vh] w-[7vw]">RAW SIGNAL</div>
            <div className="bp-diagram-node left-[calc(50%-3.5vw)] top-[18vh] h-[8vh] w-[7vw]">TRUST?</div>
            <div className="bp-diagram-node right-[2.5vw] top-[18vh] h-[8vh] w-[7vw]">EVIDENCE</div>
            <div className="absolute bottom-[5vh] left-[2vw] right-[2vw] border-t border-[rgba(125,211,252,0.3)] pt-[1.8vh] text-[1.25vw] leading-[1.45] text-[rgba(224,242,254,0.72)]">
              Provenance, temporal trust, and immutability turn a data point into a defensible record.
            </div>
          </div>
        </section>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 02/08</span>
      </div>
    </div>
  );
}