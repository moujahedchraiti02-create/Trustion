export default function TelemetryEvidence() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION C</div>
      <div className="bp-side-label">SECT. 03</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">From telemetry to evidence</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 02 - INGESTION PATH</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">PIPELINE: APPEND-ONLY</span>
            <span className="block">MODE: FIELD TO CLOUD</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-2 gap-[1.5vw]">
          <div className="bp-process-card">
            <div className="bp-process-number">01 / INGEST</div>
            <div className="bp-process-title">Vessel events</div>
            <div className="bp-process-copy">Ingest vessel events with fuel consumption, engine load, GNSS position, and emissions inputs</div>
          </div>
          <div className="bp-process-card">
            <div className="bp-process-number">02 / CLASSIFY</div>
            <div className="bp-process-title">Temporal trust</div>
            <div className="bp-process-copy">Classify temporal trust from GNSS time versus server arrival time</div>
          </div>
          <div className="bp-process-card">
            <div className="bp-process-number">03 / CHAIN</div>
            <div className="bp-process-title">Evidence trail</div>
            <div className="bp-process-copy">Chain each event to its predecessor and expose an evidence trail for review</div>
          </div>
          <div className="bp-process-card">
            <div className="bp-process-number">04 / PRESERVE</div>
            <div className="bp-process-title">Append-only</div>
            <div className="bp-process-copy">Keep ledger events append-only at the application layer</div>
          </div>
        </section>
        <div className="mt-[4vh] flex items-center gap-[1vw] text-[1.05vw] tracking-[0.12vw] text-accent">
          <span className="h-[0.1vh] w-[4vw] bg-accent" />
          INPUT → TRUST CLASS → HASH CHAIN → REVIEWABLE RECORD
        </div>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 03/08</span>
      </div>
    </div>
  );
}