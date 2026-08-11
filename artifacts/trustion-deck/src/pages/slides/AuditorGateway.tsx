export default function AuditorGateway() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION G</div>
      <div className="bp-side-label">SECT. 07</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">Auditor Gateway</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 06 - INDEPENDENT REVIEW</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">ACCESS: READ-ONLY</span>
            <span className="block">DECISIONS: APPEND-ONLY</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-[1.05fr_0.95fr] gap-[5vw]">
          <div className="flex flex-col gap-[3.2vh]">
            <div className="bp-bullet">Provide read-only evidence packages for independent review</div>
            <div className="bp-bullet">Separate auditor decisions from raw ledger data</div>
            <div className="bp-bullet">Submit verifier decisions through an append-only path</div>
            <div className="bp-bullet">Preserve the evidence record while recording the audit outcome</div>
          </div>
          <div className="bp-panel relative min-h-[46vh] p-[2vw]">
            <div className="bp-panel-label">EVIDENCE PACKAGE / VERIFIER FLOW</div>
            <div className="bp-diagram-line left-[5vw] right-[5vw] top-[21vh] h-[0.1vw]" />
            <div className="bp-diagram-node left-[2.4vw] top-[17vh] h-[9vh] w-[8vw]">LEDGER</div>
            <div className="bp-diagram-node left-[calc(50%-4vw)] top-[17vh] h-[9vh] w-[8vw]">PACKAGE</div>
            <div className="bp-diagram-node right-[2.4vw] top-[17vh] h-[9vh] w-[8vw]">AUDITOR</div>
            <div className="absolute bottom-[6vh] left-[2vw] right-[2vw] border border-accent p-[1.4vw]">
              <div className="text-[1.05vw] tracking-[0.1vw] text-accent">DECISION RECORD</div>
              <div className="mt-[1.4vh] text-[1.4vw] text-white">EVIDENCE PRESERVED / OUTCOME RECORDED</div>
            </div>
          </div>
        </section>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 07/08</span>
      </div>
    </div>
  );
}