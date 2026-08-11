export default function CryptographicIntegrity() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION D</div>
      <div className="bp-side-label">SECT. 04</div>
      <main className="bp-content">
        <header className="flex items-end justify-between border-b border-[rgba(125,211,252,0.3)] pb-[2vh]">
          <div>
            <h2 className="bp-title">Cryptographic integrity</h2>
            <div className="bp-kicker mt-[1vh]">FIG. 03 - SIGNED LEDGER</div>
          </div>
          <div className="bp-meta text-right">
            <span className="block">HASH: SHA-256</span>
            <span className="block">SIGNATURE: ED25519</span>
          </div>
        </header>
        <section className="mt-[5vh] grid grid-cols-[1.05fr_0.95fr] gap-[4vw]">
          <div className="flex flex-col gap-[3vh]">
            <div className="bp-bullet">SHA-256 content and chain hashing links records into a tamper-evident sequence</div>
            <div className="bp-bullet">Merkle proofs support verifiable inclusion paths</div>
            <div className="bp-bullet">Ed25519 signatures bind ingested event data to a signing identity</div>
            <div className="bp-bullet">Ledger detail surfaces signature status and the signer public-key prefix</div>
          </div>
          <div className="bp-panel relative min-h-[47vh] p-[2vw]">
            <div className="bp-panel-label">LEDGER DETAIL / BLOCK_000022</div>
            <div className="absolute left-[4vw] right-[4vw] top-[22vh] border-t border-accent" />
            <div className="bp-diagram-node left-[3vw] top-[17vh] h-[9vh] w-[8vw]">EVENT N</div>
            <div className="bp-diagram-node left-[calc(50%-4vw)] top-[17vh] h-[9vh] w-[8vw]">HASH N</div>
            <div className="bp-diagram-node right-[3vw] top-[17vh] h-[9vh] w-[8vw]">CHAIN N+1</div>
            <div className="absolute bottom-[7vh] left-[2vw] right-[2vw] border border-accent p-[1.3vw]">
              <div className="flex items-center justify-between">
                <span className="text-[1.25vw] text-[rgba(224,242,254,0.74)]">SIGNATURE STATUS</span>
                <span className="bp-chip">VERIFIED</span>
              </div>
              <div className="mt-[1.7vh] font-mono text-[1.1vw] text-accent">c3ed1862b5c3 · PUBLIC KEY PREFIX</div>
            </div>
          </div>
        </section>
      </main>
      <div className="bp-footer">
        <span>DRAWN BY: S³V SYSTEMS</span><span>DATE: 2026</span><span>SHEET: 04/08</span>
      </div>
    </div>
  );
}