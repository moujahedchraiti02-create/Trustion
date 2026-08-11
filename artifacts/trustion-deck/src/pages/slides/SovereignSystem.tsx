export default function SovereignSystem() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION H</div>
      <div className="bp-side-label">SECT. 08</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">Built as a sovereign evidence system</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 07 - IMPLEMENTATION STACK</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">STATUS: VERIFIED</span>
            <span className="block">REV: 01</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-[1.1fr_0.9fr] gap-[4vw]">
          <div className="flex flex-col gap-[2.6vh]">
            <div className="bp-bullet">React + Vite operations console for fleet, ledger, emissions, alerts, and auditor workflows</div>
            <div className="bp-bullet">Express 5 API with OpenAPI-generated client and validation layers</div>
            <div className="bp-bullet">PostgreSQL + Drizzle persistence for vessels, ledger entries, emissions, profiles, alerts, and decisions</div>
            <div className="bp-bullet">Verified implementation includes real Ed25519 signing, persistent signing identity support, and a passing production build</div>
          </div>
          <div className="bp-panel relative min-h-[47vh] p-[2vw]">
            <div className="bp-panel-label">SYSTEM LAYERS / ACTIVE</div>
            <div className="absolute left-[5vw] top-[11vh] h-[7vh] w-[19vw] border border-accent p-[1vw] text-[1.25vw] text-white">OPERATIONS CONSOLE</div>
            <div className="absolute left-[5vw] top-[22vh] h-[7vh] w-[19vw] border border-[rgba(125,211,252,0.7)] p-[1vw] text-[1.25vw] text-white">OPENAPI / EXPRESS API</div>
            <div className="absolute left-[5vw] top-[33vh] h-[7vh] w-[19vw] border border-[rgba(125,211,252,0.5)] p-[1vw] text-[1.25vw] text-white">POSTGRESQL / DRIZZLE</div>
            <div className="absolute left-[5vw] top-[44vh] h-[0.1vw] w-[19vw] bg-accent" />
            <div className="absolute right-[2vw] top-[11vh] text-right text-[1vw] leading-[2.8] text-accent">
              <span className="block">FLEET</span>
              <span className="block">EVIDENCE</span>
              <span className="block">AUDIT</span>
            </div>
          </div>
        </section>
        <div className="mt-[4vh] flex items-center gap-[1vw] text-[1.05vw] tracking-[0.12vw] text-accent">
          <span className="h-[0.1vh] w-[4vw] bg-accent" />
          S³V TRUSTION / FORENSIC MARITIME EVIDENCE
        </div>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 08/08</span>
      </div>
    </div>
  );
}